import 'server-only';
import {crmDb} from './crm-db';
import {notifyNewLeads, notifyReregistrationBatch} from './assignment-notify';
import {cronAuthorized} from './cron-auth';
import {readSheetGrid} from './sheet-fetch.server';
import {importSheetGrid, type SheetCreatedLead, type SheetImportResult, type SheetReregistration, type StoredSheetSource} from './sheet-sync';
import {sheetsSyncIntervalMs, type SheetMapping} from './sheet-sync-config';
import {ApiError} from './secure-api';

export type SheetSyncReport = {
  ok: boolean;
  skipped: boolean;
  reason: string;
  inserted: number;
  duplicates: number;
  invalid: number;
  unchanged: number;
  errors: string[];
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
  errors: reason ? [reason] : [],
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

async function saveSourceResult(sourceId: string, result: SheetImportResult | {error: string}) {
  const summary =
    'inserted' in result
      ? {
          inserted: result.inserted,
          duplicates: result.duplicates,
          invalid: result.invalid,
          unchanged: result.unchanged,
          error: result.error || '',
          errors: result.errors.slice(0, 30),
        }
      : {inserted: 0, duplicates: 0, invalid: 0, unchanged: 0, error: result.error, errors: [result.error]};
  await crmDb()
    .prepare('UPDATE crm_sheet_sources SET last_run = ?, last_result = ? WHERE id = ?')
    .bind(new Date().toISOString(), JSON.stringify(summary), sourceId)
    .run();
}

async function doSync(): Promise<SheetSyncReport> {
  if (!process.env.DB_HOST || !process.env.DB_USER || !process.env.DB_NAME) {
    return EMPTY_REPORT('قاعدة البيانات غير مضبوطة');
  }
  let token = '';
  try {
    token = await acquireLock();
  } catch (error) {
    console.error('sheet sync lock failed', error instanceof Error ? error.name : 'error');
    return EMPTY_REPORT('تعذر حجز قفل المزامنة');
  }
  if (!token) return {...EMPTY_REPORT('المزامنة تعمل بالفعل'), ok: true};
  const created: SheetCreatedLead[] = [];
  const reregistrations: SheetReregistration[] = [];
  const report = EMPTY_REPORT();
  report.ok = true;
  report.skipped = false;
  report.reason = '';
  report.errors = [];
  try {
    const owner = await ownerId();
    if (!owner) {
      report.ok = false;
      report.errors.push('لا يوجد مدير نشط لحفظ العملاء');
      return report;
    }
    const sources = (await loadSources()).filter(source => source.enabled && source.id && source.sheetId);
    for (const source of sources) {
      try {
        const grid = await readSheetGrid(source.sheetId, source.gid);
        const result = await importSheetGrid(crmDb(), source, grid, owner);
        await saveSourceResult(source.id, result);
        report.inserted += result.inserted;
        report.duplicates += result.duplicates;
        report.invalid += result.invalid;
        report.unchanged += result.unchanged;
        created.push(...result.created);
        reregistrations.push(...result.reregistrations);
        if (result.error) {
          report.ok = false;
          report.errors.push(result.error);
        } else if (result.errors.length) report.errors.push(...result.errors.slice(0, 5));
      } catch (error) {
        const message = error instanceof ApiError ? error.message : 'تعذر قراءة هذا المصدر';
        console.error('sheet source sync failed', error instanceof Error ? error.name : 'error');
        report.ok = false;
        report.errors.push(message);
        try {
          await saveSourceResult(source.id, {error: message});
        } catch (saveError) {
          console.error('sheet source result was not saved', saveError instanceof Error ? saveError.name : 'error');
        }
      }
    }
    try {
      await notifyNewLeads(created);
    } catch (error) {
      console.error('new lead email failed', error instanceof Error ? error.name : 'error');
      report.errors.push('تعذر إرسال بريد العملاء الجدد');
    }
    try {
      await notifyReregistrationBatch(reregistrations);
    } catch (error) {
      console.error('reregistration email failed', error instanceof Error ? error.name : 'error');
      report.errors.push('تعذر إرسال بريد إعادة التسجيل');
    }
    return report;
  } catch (error) {
    console.error('sheet sync failed', error instanceof Error ? error.name : 'error');
    report.ok = false;
    if (!report.errors.length) report.errors.push('تعذر إكمال المزامنة');
    return report;
  } finally {
    await releaseLock(token);
  }
}

export function syncAllSheets(): Promise<SheetSyncReport> {
  if (inflight) return Promise.resolve({...EMPTY_REPORT('المزامنة تعمل بالفعل'), ok: true});
  inflight = doSync().finally(() => {
    inflight = null;
  });
  return inflight;
}

export function startSheetSyncInterval() {
  const globalState = globalThis as typeof globalThis & {__sasSheetSync?: boolean};
  if (globalState.__sasSheetSync) return;
  const interval = sheetsSyncIntervalMs();
  if (!interval) return;
  globalState.__sasSheetSync = true;
  const tick = () => {
    void syncAllSheets().catch(error => {
      console.error('sheet sync interval failed', error instanceof Error ? error.name : 'error');
    });
  };
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
