import {actor, endpoint, reply, ApiError} from '@/lib/secure-api';
import {ImportError, importTelegramRequest} from '@/lib/telegram-import';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  return endpoint(async () => {
    await actor(req, ['admin']);
    try {
      return reply(await importTelegramRequest(req));
    } catch (error) {
      if (error instanceof ImportError || error instanceof ApiError) {
        throw error instanceof ApiError ? error : new ApiError(400, error.message);
      }
      console.error('telegram import failed', error);
      throw new ApiError(503, 'تعذر استيراد الملف. لم يكتمل الحفظ؛ أعد المحاولة.');
    }
  });
}
