import {z} from 'zod';

import {crmDb, crmTransaction} from '@/lib/crm-db';
import {
  applyImportedStageRepair,
  previewImportedStageRepair,
  skippedImportedStageRepair,
} from '@/lib/imported-stage-repair';
import {actor, body, endpoint, reply} from '@/lib/secure-api';
import {
  acquireSheetSyncLock,
  enqueueSheetTurn,
  releaseSheetSyncLock,
  runnerFromLeadDb,
} from '@/lib/sheet-duplicate-cleanup';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const repairSchema = z
  .object({
    confirm: z.boolean().optional(),
  })
  .strict();

export async function POST(req: Request) {
  return endpoint(async () => {
    await actor(req, ['admin']);
    const input = repairSchema.parse(await body(req, 2000));
    if (!input.confirm) {
      return reply(await previewImportedStageRepair(crmDb()));
    }
    const result = await enqueueSheetTurn(async () => {
      const gate = runnerFromLeadDb(crmDb());
      const token = await acquireSheetSyncLock(gate);
      if (!token) return skippedImportedStageRepair();
      try {
        return await crmTransaction(db => applyImportedStageRepair(db));
      } finally {
        await releaseSheetSyncLock(gate, token);
      }
    });
    const message = result.skipped ? result.reason : `تم تصحيح مرحلة ${result.updated} عميل`;
    return reply({...result, message});
  });
}
