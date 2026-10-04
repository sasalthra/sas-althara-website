import {diagnoseSheetDatabase} from '@/lib/sheet-diagnostics.server';
import {actor, endpoint, reply} from '@/lib/secure-api';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  return endpoint(async () => {
    await actor(req, ['admin']);
    return reply(await diagnoseSheetDatabase());
  });
}
