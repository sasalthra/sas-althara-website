import {endpoint, reply} from '@/lib/secure-api';
import {assertCron, syncAllSheets} from '@/lib/sheet-sync-job.server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

async function run(req: Request) {
  return endpoint(async () => {
    assertCron(req);
    // Always wait for the in-process run. Do not answer before the sync finishes.
    return reply(await syncAllSheets());
  });
}

export async function GET(req: Request) {
  return run(req);
}

export async function POST(req: Request) {
  return run(req);
}
