import {crmDb} from '@/lib/crm-db';
import {ensureSheetSchema} from '@/lib/lead-schema';
import {actor, ApiError, body, endpoint, reply} from '@/lib/secure-api';
import {serviceAccountConfigured} from '@/lib/sheet-fetch.server';
import {sheetSourceKey} from '@/lib/sheet-keys';
import {readSheetDuplicateCleanup, runnerFromLeadDb} from '@/lib/sheet-duplicate-cleanup';
import {parseSheetRef, sheetSourceInputSchema, sheetsSyncIntervalMs} from '@/lib/sheet-sync-config';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function parsed(value: unknown) {
  if (typeof value !== 'string') return value ?? null;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function enabledFlag(value: unknown) {
  return value === 1 || value === true || value === '1';
}

function countOf(value: unknown, fallback = 0) {
  if (value === null || value === undefined || value === '') return fallback;
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

export async function GET() {
  return endpoint(async () => {
    await actor(undefined, ['admin']);
    await ensureSheetSchema();
    const rows = await crmDb()
      .prepare(
        `SELECT id, sheet_id, gid, label, campaign, mapping, headers, enabled, last_run, last_result,
                last_run_at, rows_read, \`created\`, existing, skipped, error_message
         FROM crm_sheet_sources ORDER BY created_at ASC, id ASC`
      )
      .all();
    return reply({
      sources: rows.results.map(row => {
        const lastResult = parsed(row.last_result) as {
          rowsRead?: unknown;
          inserted?: unknown;
          duplicates?: unknown;
          skippedRows?: unknown;
          error?: unknown;
        } | null;
        const savedError = row.error_message ? String(row.error_message) : '';
        return {
        id: String(row.id || ''),
        sheetId: String(row.sheet_id || ''),
        gid: String(row.gid || ''),
        label: String(row.label || ''),
        campaign: String(row.campaign || ''),
        mapping: parsed(row.mapping) || {},
        headers: parsed(row.headers) || [],
        enabled: enabledFlag(row.enabled),
        lastRun: row.last_run ? String(row.last_run) : '',
        lastResult,
        lastRunAt: row.last_run_at ? String(row.last_run_at) : (row.last_run ? String(row.last_run) : ''),
        rowsRead: countOf(row.rows_read, countOf(lastResult?.rowsRead, 0)),
        created: countOf(row.created, countOf(lastResult?.inserted, 0)),
        existing: countOf(row.existing, countOf(lastResult?.duplicates, 0)),
        skipped: countOf(row.skipped, countOf(lastResult?.skippedRows, 0)),
        errorMessage: savedError || String(lastResult?.error || ''),
      };
      }),
      intervalMs: sheetsSyncIntervalMs(),
      cronReady: (process.env.CRON_SECRET || '').trim().length >= 32,
      serviceAccount: serviceAccountConfigured(),
      duplicateCleanup: await readSheetDuplicateCleanup(runnerFromLeadDb(crmDb())),
    });
  });
}

export async function POST(req: Request) {
  return endpoint(async () => {
    const user = await actor(req, ['admin']);
    const input = sheetSourceInputSchema.parse(await body(req, 40000));
    const ref = parseSheetRef(input.sheetUrl);
    if (!ref) throw new ApiError(400, 'رابط الجدول أو معرفه غير صالح');
    const gid = (input.gid || ref.gid || '').trim();
    if (gid && !/^\d{1,20}$/.test(gid)) throw new ApiError(400, 'رقم الورقة غير صالح');
    const now = new Date().toISOString();
    const id = input.id || crypto.randomUUID();
    const duplicate = await crmDb()
      .prepare(`SELECT id FROM crm_sheet_sources WHERE sheet_id = ? AND IFNULL(gid, '') = ? AND id <> ? LIMIT 1`)
      .bind(ref.sheetId, gid, id)
      .first<{id: string}>();
    if (duplicate?.id) throw new ApiError(409, 'هذا الجدول مضاف مسبقاً');
    const existing = input.id
      ? await crmDb().prepare('SELECT id FROM crm_sheet_sources WHERE id = ?').bind(id).first<{id: string}>()
      : null;
    if (input.id && !existing?.id) throw new ApiError(404, 'المصدر غير موجود');
    await ensureSheetSchema();
    const payload = [
      ref.sheetId,
      gid,
      input.label.trim(),
      input.campaign.trim(),
      JSON.stringify(input.mapping),
      JSON.stringify(input.headers),
      input.enabled ? 1 : 0,
      now,
      sheetSourceKey(ref.sheetId, gid),
    ];
    try {
      if (existing?.id) {
        await crmDb()
          .prepare(
            `UPDATE crm_sheet_sources
             SET sheet_id = ?, gid = ?, label = ?, campaign = ?, mapping = ?, headers = ?, enabled = ?, updated_at = ?, sheet_key = ?
             WHERE id = ?`
          )
          .bind(...payload, id)
          .run();
      } else {
        await crmDb()
          .prepare(
            `INSERT INTO crm_sheet_sources (
              sheet_id, gid, label, campaign, mapping, headers, enabled, updated_at, sheet_key, id, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
          )
          .bind(...payload, id, now)
          .run();
      }
    } catch (error) {
      if (/duplicate|UNIQUE|ER_DUP_ENTRY/i.test(error instanceof Error ? error.message : String(error))) {
        throw new ApiError(409, 'هذا الجدول مضاف مسبقاً');
      }
      throw error;
    }
    try {
      await crmDb()
        .prepare('INSERT INTO crm_audit (id, actor_id, action, target_id, details, created_at) VALUES (?, ?, ?, ?, ?, ?)')
        .bind(crypto.randomUUID(), user.userId, 'sheets.source', id, JSON.stringify({enabled: input.enabled, sheetId: ref.sheetId}), now)
        .run();
    } catch (error) {
      console.error('sheet source audit was not written', error instanceof Error ? error.name : 'error');
    }
    return reply({ok: true, id});
  });
}

export async function DELETE(req: Request) {
  return endpoint(async () => {
    const user = await actor(req, ['admin']);
    const id = new URL(req.url).searchParams.get('id') || '';
    if (!/^[a-zA-Z0-9_-]{1,40}$/.test(id)) throw new ApiError(400, 'معرف المصدر غير صالح');
    await ensureSheetSchema();
    await crmDb().prepare('DELETE FROM crm_sheet_sources WHERE id = ?').bind(id).run();
    try {
      await crmDb()
        .prepare('INSERT INTO crm_audit (id, actor_id, action, target_id, details, created_at) VALUES (?, ?, ?, ?, ?, ?)')
        .bind(crypto.randomUUID(), user.userId, 'sheets.source.delete', id, '{}', new Date().toISOString())
        .run();
    } catch (error) {
      console.error('sheet source delete audit was not written', error instanceof Error ? error.name : 'error');
    }
    return reply({ok: true});
  });
}
