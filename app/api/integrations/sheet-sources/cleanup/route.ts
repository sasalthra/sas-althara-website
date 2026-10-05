import {crmDb} from '@/lib/crm-db';
import {actor, endpoint, reply} from '@/lib/secure-api';
import {cleanupSheetSyncDuplicates, enqueueSheetTurn, runnerFromLeadDb} from '@/lib/sheet-duplicate-cleanup';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  return endpoint(async () => {
    await actor(req, ['admin']);
    const result = await enqueueSheetTurn(() => cleanupSheetSyncDuplicates(runnerFromLeadDb(crmDb())));
    const message = result.skipped
      ? result.reason || 'المزامنة تعمل بالفعل'
      : `تم حذف ${result.deleted} عميل مكرر من المزامنة`;
    return reply({
      ok: result.ok,
      skipped: result.skipped,
      reason: result.reason,
      deleted: result.deleted,
      rowsMarked: result.rowsMarked,
      totalDeleted: result.totalDeleted,
      ranAt: result.ranAt,
      message,
    });
  });
}
