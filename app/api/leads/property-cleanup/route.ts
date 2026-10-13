import {z} from 'zod';

import {crmDb, crmTransaction} from '@/lib/crm-db';
import {confirmPropertyCleanup, loadCleanupDirectory, previewPropertyCleanup} from '@/lib/property-cleanup';
import {DEFAULT_PROPERTY_CLEANUP_LABELS} from '@/lib/property-cleanup-shared';
import {actor, ApiError, body, endpoint, reply} from '@/lib/secure-api';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MANAGERS = ['admin', 'supervisor'] as const;

const labelSchema = z.string().trim().min(2).max(80);
const schema = z.object({
  confirm: z.boolean().optional(),
  employeeId: z.string().trim().min(1).max(191),
  labels: z.array(labelSchema).min(1).max(4).optional(),
  ids: z.array(z.string().uuid()).max(5000).optional(),
}).strict();

export async function GET() {
  return endpoint(async () => {
    await actor(undefined, [...MANAGERS]);
    const employees = await loadCleanupDirectory(crmDb());
    return reply({
      employees: employees.map(employee => ({
        id: employee.id,
        name: employee.name,
        username: employee.username,
        role: employee.role,
        active: employee.active,
      })),
      defaultLabels: [...DEFAULT_PROPERTY_CLEANUP_LABELS],
    });
  });
}

export async function POST(req: Request) {
  return endpoint(async () => {
    const user = await actor(req, [...MANAGERS]);
    const input = schema.parse(await body(req, 400000));
    if (/[\u0000-\u001f\u007f]/.test(input.employeeId)) throw new ApiError(400, 'الموظف غير صالح');
    if (!input.confirm) {
      return reply(await previewPropertyCleanup(crmDb(), {
        employeeId: input.employeeId,
        labels: input.labels,
      }));
    }
    if (!input.ids?.length) throw new ApiError(400, 'أكد الحذف على العملاء المعروضين فقط');
    const result = await crmTransaction(db => confirmPropertyCleanup(db, {
      actorId: user.userId,
      employeeId: input.employeeId,
      labels: input.labels,
      ids: input.ids || [],
    }));
    return reply(result);
  });
}
