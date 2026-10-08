import {actor, endpoint, reply, ApiError} from '@/lib/secure-api';
import {regroupTelegramOffers} from '@/lib/telegram-regroup';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  return endpoint(async () => {
    await actor(req, ['admin']);
    let apply = false;
    try {
      const body = await req.json() as {apply?: unknown};
      apply = body?.apply === true;
    } catch {
      apply = false;
    }
    try {
      return reply(await regroupTelegramOffers(apply));
    } catch (error) {
      console.error('telegram regroup failed', error);
      throw new ApiError(503, 'تعذر إكمال إعادة التجميع. أعد المحاولة؛ ما اكتمل لا يُكرَّر.');
    }
  });
}
