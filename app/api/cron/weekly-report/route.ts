import {ApiError, endpoint, reply} from '@/lib/secure-api';
import {cronAuthorized} from '@/lib/cron-auth';
import {sendWeeklyReport} from '@/lib/weekly-report-job.server';

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
    const url = new URL(req.url);
    const preview = url.searchParams.get('preview') === '1';
    const force = url.searchParams.get('force') === '1';
    const result = await sendWeeklyReport({preview, force});
    if (preview) {
      return new Response(result.html || '', {
        status: result.ok ? 200 : 503,
        headers: {'content-type': 'text/html; charset=utf-8', 'cache-control': 'private, no-store'},
      });
    }
    const {html: _html, ...body} = result;
    return reply(body, result.ok ? 200 : 503);
  });
}

export async function GET(req: Request) {
  return run(req);
}

export async function POST(req: Request) {
  return run(req);
}
