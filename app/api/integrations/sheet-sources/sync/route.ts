import {actor, endpoint, reply} from '@/lib/secure-api';
import {syncAllSheets} from '@/lib/sheet-sync-job.server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  return endpoint(async () => {
    await actor(req, ['admin']);
    return reply(await syncAllSheets());
  });
}
