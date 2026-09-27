import {z} from 'zod';

import {crmDb, crmTransaction} from '@/lib/crm-db';
import {
  countEmployeeClients,
  loadEmployee,
  purgeAssignedClients,
} from '@/lib/delete-employee-clients';
import {SALES_ASSIGNMENT_SCOPE} from '@/lib/employee-client-purge';
import {actor, ApiError, body, endpoint, reply} from '@/lib/secure-api';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const userIdSchema = z.string().uuid();
const purgeSchema = z.object({
  userId: userIdSchema,
  confirmation: z.string().trim().min(1).max(120),
}).strict();

export async function GET(req: Request) {
  return endpoint(async () => {
    await actor(undefined, ['admin']);
    const userId = new URL(req.url).searchParams.get('userId') ?? '';
    const parsed = userIdSchema.safeParse(userId);
    if (!parsed.success) throw new ApiError(400, 'اختر موظفاً');
    const db = crmDb();
    const employee = await loadEmployee(db, parsed.data);
    if (!employee) throw new ApiError(404, 'الموظف غير موجود');
    const counts = await countEmployeeClients(db, parsed.data);
    return reply({employee, scope: SALES_ASSIGNMENT_SCOPE, ...counts});
  });
}

export async function POST(req: Request) {
  return endpoint(async () => {
    const user = await actor(req, ['admin']);
    const input = purgeSchema.parse(await body(req));
    const result = await crmTransaction(db => purgeAssignedClients(db, {
      actorId: user.userId,
      employeeId: input.userId,
      confirmation: input.confirmation,
    }));
    return reply(result);
  });
}
