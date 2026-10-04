import 'server-only';
import {crmDb} from './crm-db';
import {seedTiktokSheetSourceIfEmpty} from './lead-schema';
import {notifyNewLeads, notifyReregistrationBatch, notifySheetBackfillSummaries, type SheetBackfillNotice} from './assignment-notify';
import {cronAuthorized} from './cron-auth';
import {readSheetGrid} from './sheet-fetch.server';
import {importSheetGrid, type SheetCreatedLead, type SheetImportResult, type SheetReregistration, type StoredSheetSource} from './sheet-sync';
import {publicSyncError, sheetsSyncIntervalMs, type SheetMapping} from './sheet-sync-config';
import {ApiError} from './secure-api';

export type SheetSyncStep = {step: string; ok: boolean; detail: string};

export type SheetSyncReport = {
  ok: boolean;
  skipped: boolean;
  reason: string;
  inserted: number;
  duplicates: number;
  invalid: number;
  unchanged: number;
  rowsRead: number;
  created: number;
  existing: number;
  skippedRows: number;
  errorMessage: string;
  errors: string[];
  steps: SheetSyncStep[];
  seeded: boolean;
  at: string;
};

const EMPTY_REPORT = (reason = ''): SheetSyncReport => ({
  ok: !reason,
  skipped: Boolean(reason),
  reason,
  inserted: 0,
  duplicates: 0,
  invalid: 0,
  unchanged: 0,
  rowsRead: 0,
  created: 0,
  existing: 0,
  skippedRows: 0,
  errorMessage: reason,
  errors: reason ? [reason] : [],
  steps: [],
  seeded: false,
  at: new Date().toISOString(),
});

let inflight: Promise<SheetSyncReport> | null = null;

function parseJson<T>(value: unknown, fallback: T): T {
  if (typeof value !== 'string' || !value.trim()) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

async function loadSources(): Promise<StoredSheetSource[]> {
  const rows = await crmDb()
    .prepare(
      `SELECT id, sheet_id, gid, label, campaign, mapping, headers, enabled
       FROM crm_sheet_sources ORDER BY created_at ASC, id ASC`
    )
    .all();
  return rows.results.map(row => ({
    id: String(row.id || ''),
    sheetId: String(row.sheet_id || ''),
    gid: String(row.gid || ''),
    label: String(row.label || ''),
    campaign: String(row.campaign || ''),
    mapping: parseJson<SheetMapping>(row.mapping, {}),
    headers: parseJson<string[]>(row.headers, []),
    enabled: row.enabled === 1 || row.enabled === true || row.enabled === '1',
  }));
}

async function ownerId() {
  if (process.env.WEBSITE_LEAD_OWNER_ID) return process.env.WEBSITE_LEAD_OWNER_ID;
  const admin = await crmDb()
    .prepare(`SELECT id FROM crm_users WHERE role = 'admin' AND active = 1 ORDER BY created_at ASC LIMIT 1`)
    .first<{id: string}>();
  return admin?.id || '';
}

async function acquireLock() {
  const token = crypto.randomUUID();
  const now = new Date().toISOString();
  const until = new Date(Date.now() + 4 * 60 * 1000).toISOString();
  const db = crmDb();
  await db.prepare('DELETE FROM crm_sheet_sync_lock WHERE id = ? AND locked_until < ?').bind('sheets', now).run();
  try {
    await db
      .prepare('INSERT INTO crm_sheet_sync_lock (id, locked_until, token) VALUES (?, ?, ?)')
      .bind('sheets', until, token)
      .run();
    return token;
  } catch (error) {
    if (/duplicate|UNIQUE|ER_DUP_ENTRY/i.test(error instanceof Error ? error.message : String(error))) return '';
    throw error;
  }
}

async function releaseLock(token: string) {
  if (!token) return;
  try {
    await crmDb().prepare('DELETE FROM crm_sheet_sync_lock WHERE id = ? AND token = ?').bind('sheets', token).run();
  } catch (error) {
    console.error('sheet sync lock was not released', error instanceof Error ? error.name : 'error');
  }
}

/** A source is on its initial backfill until any row key has been stored. */
async function sourceAlreadySynced(sourceId: string) {
  const row = await crmDb()
    .prepare('SELECT id FROM crm_sheet_rows WHERE source_id = ? LIMIT 1')
    .bind(sourceId)
    .first<{id: string}>();
  return Boolean(row?.id);
}

async function saveSourceResult(sourceId: string, result: SheetImportResult | {error: string; rowsRead?: number; skippedRows?: number}) {
  const now = new Date().toISOString();
  const inserted = 'inserted' in result ? result.inserted : 0;
  const duplicates = 'duplicates' in result ? result.duplicates : 0;
  const invalid = 'invalid' in result ? result.invalid : 0;
  const unchanged = 'unchanged' in result ? result.unchanged : 0;
  const rowsRead = 'rowsRead' in result ? result.rowsRead || 0 : 0;
  const skippedRows = 'skippedRows' in result ? result.skippedRows || 0 : 0;
  const error = result.error || '';
  const errors = 'errors' in result ? result.errors.slice(0, 30) : error ? [error] : [];
  const summary = {inserted, duplicates, invalid, unchanged, rowsRead, skippedRows, error, errors};
  const payload = JSON.stringify(summary);
  try {
    await crmDb()
      .prepare(
        `UPDATE crm_sheet_sources
         SET last_run = ?, last_result = ?, last_run_at = ?, rows_read = ?, \`created\` = ?, existing = ?, skipped = ?, error_message = ?
         WHERE id = ?`
      )
      .bind(now, payload, now, rowsRead, inserted, duplicates, skippedRows, error, sourceId)
      .run();
  } catch (errorValue) {
    if (!/unknown column|no such column|ER_BAD_FIELD_ERROR/i.test(publicSyncError(errorValue))) throw errorValue;
    await crmDb()
      .prepare('UPDATE crm_sheet_sources SET last_run = ?, last_result = ? WHERE id = ?')
      .bind(now, payload, sourceId)
      .run();
  }
}

function logSync(report: SheetSyncReport) {
  report.created = report.inserted;
  report.existing = report.duplicates;
  report.errorMessage = report.errorMessage || report.errors.find(Boolean) || '';
  report.at = new Date().toISOString();
  console.log(
    `[sheet-sync] ${JSON.stringify({
      ok: report.ok,
      skippedRun: report.skipped,
      reason: report.reason,
      rowsRead: report.rowsRead,
      created: report.created,
      existing: report.existing,
      skipped: report.skippedRows,
      error: report.errorMessage,
      at: report.at,
    })}`
  );
  return report;
}

async function doSync(): Promise<SheetSyncReport> {
  if (!process.env.DB_HOST || !process.env.DB_USER || !process.env.DB_NAME) {
    const report = EMPTY_REPORT('قاعدة البيانات غير مضبوطة');
    report.steps.push({step: 'قاعدة البيانات', ok: false, detail: report.reason});
    return logSync(report);
  }
  let seeded = false;
  try {
    seeded = await seedTiktokSheetSourceIfEmpty();
  } catch (error) {
    const message = publicSyncError(error);
    console.error('tiktok sheet seed failed', message);
    const report = EMPTY_REPORT(message);
    report.steps.push({step: 'المصادر', ok: false, detail: message});
    return logSync(report);
  }
  let token = '';
  try {
    token = await acquireLock();
  } catch (error) {
    const message = publicSyncError(error);
    console.error('sheet sync lock failed', message);
    const report = EMPTY_REPORT('تعذر حجز قفل المزامنة');
    report.errorMessage = message;
    report.steps.push({step: 'قفل المزامنة', ok: false, detail: message});
    return logSync(report);
  }
  if (!token) {
    const report = {...EMPTY_REPORT('المزامنة تعمل بالفعل'), ok: true};
    report.steps.push({step: 'قفل المزامنة', ok: true, detail: 'تشغيل آخر ما زال يعمل'});
    return logSync(report);
  }
  const created: SheetCreatedLead[] = [];
  const reregistrations: SheetReregistration[] = [];
  const backfills: SheetBackfillNotice[] = [];
  const report = EMPTY_REPORT();
  report.ok = true;
  report.skipped = false;
  report.reason = '';
  report.errors = [];
  report.errorMessage = '';
  report.seeded = seeded;
  if (seeded) report.steps.push({step: 'المصادر', ok: true, detail: 'أُضيفت ورقة تيك توك لأن القائمة كانت فارغة'});
  try {
    const owner = await ownerId();
    if (!owner) {
      const message = 'لا يوجد مدير نشط لحفظ العملاء';
      report.ok = false;
      report.errors.push(message);
      report.errorMessage = message;
      report.steps.push({step: 'المدير', ok: false, detail: message});
      const sources = (await loadSources()).filter(source => source.enabled && source.id);
      for (const source of sources) {
        try {
          await saveSourceResult(source.id, {error: message});
        } catch (saveError) {
          console.error('sheet source result was not saved', publicSyncError(saveError));
        }
      }
      return logSync(report);
    }
    report.steps.push({step: 'المدير', ok: true, detail: 'يوجد مدير نشط لحفظ العملاء'});
    const sources = (await loadSources()).filter(source => source.enabled && source.id && source.sheetId);
    if (!sources.length) {
      report.steps.push({step: 'المصادر', ok: false, detail: 'لا يوجد مصدر مفعّل. ورقة تيك توك تُزرع عند أول اتصال بقاعدة البيانات حتى لو وُجدت مصادر أخرى.'});
    }
    for (const source of sources) {
      const label = source.label || source.id;
      try {
        const backfill = !(await sourceAlreadySynced(source.id));
        const grid = await readSheetGrid(source.sheetId, source.gid);
        report.steps.push({
          step: `${label}: جلب CSV`,
          ok: true,
          detail: `الورقة ${source.gid || '0'} — ${Math.max(0, grid.length - 1)} صف بيانات`,
        });
        const result = await importSheetGrid(crmDb(), source, grid, owner);
        await saveSourceResult(source.id, result);
        report.inserted += result.inserted;
        report.duplicates += result.duplicates;
        report.invalid += result.invalid;
        report.unchanged += result.unchanged;
        report.rowsRead += result.rowsRead;
        report.skippedRows += result.skippedRows;
        report.steps.push({
          step: `${label}: الحفظ`,
          ok: !result.error,
          detail: `قُرئ ${result.rowsRead}، جديد ${result.inserted}، موجود ${result.duplicates}، متخطى ${result.skippedRows}${result.error ? `. ${result.error}` : ''}`,
        });
        if (backfill) {
          if (!result.error && result.inserted + result.duplicates + result.invalid > 0) {
            backfills.push({
              label: source.label,
              campaign: source.campaign,
              inserted: result.inserted,
              duplicates: result.duplicates,
            });
          }
        } else {
          created.push(...result.created);
          reregistrations.push(...result.reregistrations);
        }
        if (result.error) {
          report.ok = false;
          report.errors.push(result.error);
        } else if (result.errors.length) report.errors.push(...result.errors.slice(0, 5));
      } catch (error) {
        const message = error instanceof ApiError ? error.message : publicSyncError(error);
        console.error('sheet source sync failed', message);
        report.ok = false;
        report.errors.push(message);
        report.steps.push({step: `${label}: جلب CSV`, ok: false, detail: message});
        try {
          await saveSourceResult(source.id, {error: message});
        } catch (saveError) {
          console.error('sheet source result was not saved', publicSyncError(saveError));
        }
      }
    }
    try {
      await notifySheetBackfillSummaries(backfills);
    } catch (error) {
      console.error('sheet backfill summary failed', publicSyncError(error));
      report.errors.push('تعذر إرسال ملخص المزامنة الأولى');
    }
    try {
      await notifyNewLeads(created);
    } catch (error) {
      console.error('new lead email failed', publicSyncError(error));
      report.errors.push('تعذر إرسال بريد العملاء الجدد');
    }
    try {
      await notifyReregistrationBatch(reregistrations);
    } catch (error) {
      console.error('reregistration email failed', publicSyncError(error));
      report.errors.push('تعذر إرسال بريد إعادة التسجيل');
    }
    return logSync(report);
  } catch (error) {
    const message = publicSyncError(error);
    console.error('sheet sync failed', message);
    report.ok = false;
    if (!report.errors.length) report.errors.push(message || 'تعذر إكمال المزامنة');
    report.steps.push({step: 'المزامنة', ok: false, detail: message || 'تعذر إكمال المزامنة'});
    return logSync(report);
  } finally {
    await releaseLock(token);
  }
}

export function syncAllSheets(): Promise<SheetSyncReport> {
  if (!inflight) {
    inflight = doSync().finally(() => {
      inflight = null;
    });
  }
  return inflight;
}

export function startSheetSyncInterval() {
  const globalState = globalThis as typeof globalThis & {__sasSheetSync?: boolean; __sasSheetSyncAt?: number};
  const interval = sheetsSyncIntervalMs();
  if (!interval) return;
  const tick = () => {
    globalState.__sasSheetSyncAt = Date.now();
    void syncAllSheets().catch(error => {
      console.error('sheet sync interval failed', publicSyncError(error));
    });
  };
  if (globalState.__sasSheetSync) {
    if (Date.now() - (globalState.__sasSheetSyncAt || 0) >= interval) tick();
    return;
  }
  globalState.__sasSheetSync = true;
  globalState.__sasSheetSyncAt = Date.now();
  const starter = setTimeout(tick, 20_000);
  const timer = setInterval(tick, interval);
  starter.unref?.();
  timer.unref?.();
}

export function assertCron(req: Request) {
  const allowed = cronAuthorized({
    authorization: req.headers.get('authorization'),
    cronSecret: req.headers.get('x-cron-secret'),
  });
  if (allowed) return;
  const secret = (process.env.CRON_SECRET || '').trim();
  if (secret.length < 32) throw new ApiError(503, 'مفتاح الجدولة غير مضبوط');
  throw new ApiError(401, 'غير مصرح');
}
