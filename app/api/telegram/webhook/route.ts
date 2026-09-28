import {readLimitedJson, webhookAuthorized} from '@/lib/telegram-bot';
import {handleTelegramUpdate} from '@/lib/telegram-sync';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  if (!webhookAuthorized(req.headers.get('x-telegram-bot-api-secret-token'))) {
    return Response.json({error: 'unauthorized'}, {status: 401, headers: {'cache-control': 'no-store'}});
  }
  let update: unknown;
  try {
    update = await readLimitedJson(req, 1_000_000);
  } catch {
    return Response.json({error: 'bad request'}, {status: 400, headers: {'cache-control': 'no-store'}});
  }
  try {
    const result = await handleTelegramUpdate(update);
    return Response.json(result, {headers: {'cache-control': 'no-store'}});
  } catch (error) {
    console.error('telegram webhook failed', error);
    return Response.json({error: 'temporary failure'}, {status: 503, headers: {'cache-control': 'no-store'}});
  }
}
