import {z} from 'zod';

import {notifyImportAssignments} from '@/lib/assignment-notify';
import {assignLeadsBulk} from '@/lib/bulk-leads';
import {canBulkSelect} from '@/lib/bulk-lead-access';
import {crmTransaction} from '@/lib/crm-db';
import {actor, body, endpoint, reply} from '@/lib/secure-api';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const schema = z.object({
  ids: z.array(z.string().uuid()).min(1).max(500),
  assignedTo: z.string().uuid(),
}).strict();

export async function POST(req: Request) {
  return endpoint(async () => {
    const user = await actor(req, ['admin', 'supervisor']);
    if (!canBulkSelect(user.role)) {
      return reply({error: 'لا تملك الصلاحية'}, 403);
    }
    const input = schema.parse(await body(req, 200000));
    const result = await crmTransaction(db => assignLeadsBulk(db, {
      actorId: user.userId,
      ids: input.ids,
      assignedTo: input.assignedTo,
    }));
    if (result.clients.length) {
      await notifyImportAssignments(result.clients.map(client => ({
        assignedTo: result.assignedTo,
        client,
      })));
    }
    return reply({
      ok: true,
      assigned: result.assigned,
      employeeName: result.employeeName,
      message: result.message,
    });
  });
}
