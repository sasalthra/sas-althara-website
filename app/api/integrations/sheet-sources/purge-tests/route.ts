import {z} from 'zod';

import {crmDb, crmTransaction} from '@/lib/crm-db';
import {actor, body, endpoint, reply} from '@/lib/secure-api';
import {
  acquireSheetSyncLock,
  enqueueSheetTurn,
  releaseSheetSyncLock,
  runnerFromLeadDb,
} from '@/lib/sheet-duplicate-cleanup';
import {
  DEFAULT_SHEET_TEST_KEEP_PHONES,
  executeSheetTestLeadPurge,
  previewSheetTestLeadPurge,
  skippedSheetTestPurge,
  type SheetTestPurgeOutcome,
} from '@/lib/sheet-test-purge';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const purgeSchema = z
  .object({
    phones: z.array(z.string().max(40)).max(3).optional(),
    confirm: z.boolean().optional(),
  })
  .strict();

function withMessage(result: SheetTestPurgeOutcome, committed: boolean) {
  const message = result.skipped || result.aborted ? result.reason : committed ? `تم حذف ${result.deleted} عميل` : '';
  return {...result, message};
}

export async function POST(req: Request) {
  return endpoint(async () => {
    await actor(req, ['admin']);
    const input = purgeSchema.parse(await body(req, 4000));
    const phones = input.phones ?? [...DEFAULT_SHEET_TEST_KEEP_PHONES];
    if (!input.confirm) {
      const preview = await previewSheetTestLeadPurge(runnerFromLeadDb(crmDb()), phones);
      return reply(withMessage(preview, false));
    }
    const result = await enqueueSheetTurn(async () => {
      const gate = runnerFromLeadDb(crmDb());
      const token = await acquireSheetSyncLock(gate);
      if (!token) return skippedSheetTestPurge();
      try {
        return await crmTransaction(db => executeSheetTestLeadPurge(runnerFromLeadDb(db), phones));
      } finally {
        await releaseSheetSyncLock(gate, token);
      }
    });
    return reply(withMessage(result, true));
  });
}
