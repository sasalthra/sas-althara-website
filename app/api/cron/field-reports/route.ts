import {ApiError, endpoint, reply} from '@/lib/secure-api';
import {cronAuthorized} from '@/lib/cron-auth';
import {checkOverdueFieldReports} from '@/lib/field-report-job.server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function assertCron(req: Request) {
  const allowed = cronAuthorized({
    authorization: req.headers.get('authorization'),
    cronSecret: req.headers.get('x-cron-secret'),
  });
  if (allowed) return;
  const secret = (process.env.CRON_SECRET || '').trim();
  if (secret.length < 32) throw new ApiError(503, 'مفتاح الجدولة غير مضبوط');
  throw new ApiError(401, 'غير مصرح');
}

async function run(req: Request) {
  return endpoint(async () => {
    assertCron(req);
    return reply(await checkOverdueFieldReports());
  });
}

export async function GET(req: Request) {
  return run(req);
}

export async function POST(req: Request) {
  return run(req);
}
