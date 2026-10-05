import {z} from 'zod';

import {canBulkDelete} from '@/lib/bulk-lead-access';
import {deleteLeadsBulk} from '@/lib/bulk-leads';
import {crmTransaction} from '@/lib/crm-db';
import {actor, body, endpoint, reply} from '@/lib/secure-api';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const schema = z.object({
  ids: z.array(z.string().uuid()).min(1).max(500),
}).strict();

export async function POST(req: Request) {
  return endpoint(async () => {
    const user = await actor(req, ['admin']);
    if (!canBulkDelete(user.role)) {
      return reply({error: 'لا تملك الصلاحية'}, 403);
    }
    const input = schema.parse(await body(req, 200000));
    const result = await crmTransaction(db => deleteLeadsBulk(db, {
      actorId: user.userId,
      ids: input.ids,
    }));
    return reply(result);
  });
}
