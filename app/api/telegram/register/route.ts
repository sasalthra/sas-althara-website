import {actor, endpoint, reply, ApiError} from '@/lib/secure-api';
import {registerWebhook} from '@/lib/telegram-bot';
import {safeTelegramError} from '@/lib/telegram-bot';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  return endpoint(async () => {
    await actor(req, ['admin']);
    try {
      return reply(await registerWebhook(req));
    } catch (error) {
      throw new ApiError(400, safeTelegramError(error, 'تعذر تسجيل الويب هوك'));
    }
  });
}
