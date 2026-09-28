import {timingSafeEqual} from 'node:crypto';

const API = 'https://api.telegram.org';

export function webhookAuthorized(header: string | null): boolean {
  const secret = process.env.TELEGRAM_WEBHOOK_SECRET ?? '';
  if (!secret || header == null) return false;
  const left = Buffer.from(header);
  const right = Buffer.from(secret);
  if (left.length !== right.length || left.length === 0) return false;
  return timingSafeEqual(left, right);
}

export function publicSiteOrigin(req?: Request): string | null {
  const raw = (process.env.NEXTAUTH_URL || process.env.SITE_URL || '').trim();
  if (raw) {
    try {
      const url = new URL(raw);
      if (url.protocol === 'https:' || url.hostname === 'localhost') return url.origin;
    } catch {
      return null;
    }
  }
  if (!req) return null;
  const host = (req.headers.get('x-forwarded-host') || req.headers.get('host') || '').split(',')[0]?.trim() ?? '';
  if (!host || /[\s/]/.test(host)) return null;
  const proto = (req.headers.get('x-forwarded-proto') || 'https').split(',')[0]?.trim();
  if (proto !== 'https' && proto !== 'http') return null;
  return `${proto}://${host}`;
}

export function safeTelegramError(error: unknown, fallback: string) {
  const message = error instanceof Error ? error.message : '';
  if (!message || /api\.telegram\.org\/bot/i.test(message) || /\d{6,}:[A-Za-z0-9_-]{10,}/.test(message)) return fallback;
  return message.slice(0, 300);
}

export async function telegramMethod(method: string, body: Record<string, unknown> = {}) {
  const bot = process.env.TELEGRAM_BOT_TOKEN?.trim();
  if (!bot) throw new Error('ضع TELEGRAM_BOT_TOKEN في متغيرات Hostinger');
  if (!/^[A-Za-z0-9_]+$/.test(method)) throw new Error('طلب تيليجرام غير معروف');
  let response: Response;
  try {
    response = await fetch(`${API}/bot${bot}/${method}`, {
      method: 'POST',
      headers: {'content-type': 'application/json'},
      body: JSON.stringify(body),
      cache: 'no-store',
      signal: AbortSignal.timeout(20000),
    });
  } catch {
    throw new Error('تعذر الاتصال بتيليجرام');
  }
  let payload: {ok?: boolean; description?: string; result?: unknown};
  try {
    payload = await response.json() as {ok?: boolean; description?: string; result?: unknown};
  } catch {
    throw new Error('رد تيليجرام غير مفهوم');
  }
  if (!payload.ok) throw new Error(safeTelegramError(new Error(payload.description || ''), 'رفض تيليجرام الطلب'));
  return payload.result;
}

export async function registerWebhook(req: Request) {
  const secret = process.env.TELEGRAM_WEBHOOK_SECRET?.trim() ?? '';
  if (!process.env.TELEGRAM_BOT_TOKEN?.trim()) throw new Error('ضع TELEGRAM_BOT_TOKEN في متغيرات Hostinger');
  if (!/^[A-Za-z0-9_-]{8,256}$/.test(secret)) {
    throw new Error('TELEGRAM_WEBHOOK_SECRET يجب أن يكون 8 أحرف على الأقل من الإنجليزية والأرقام و _ و -');
  }
  const origin = publicSiteOrigin(req);
  if (!origin || !origin.startsWith('https://')) {
    throw new Error('ضع NEXTAUTH_URL على رابط الموقع https بدون شرطة في النهاية، مثل https://sasalthra.sa');
  }
  const url = `${origin}/api/telegram/webhook`;
  await telegramMethod('setWebhook', {
    url,
    secret_token: secret,
    allowed_updates: ['channel_post', 'edited_channel_post'],
    drop_pending_updates: false,
  });
  return {ok: true as const, url};
}

export async function readLimitedJson(req: Request, limit: number) {
  const reader = req.body?.getReader();
  if (!reader) throw new Error('بيانات غير صالحة');
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const {done, value} = await reader.read();
    if (done) break;
    size += value.length;
    if (size > limit) {
      await reader.cancel();
      throw new Error('الطلب أكبر من المسموح');
    }
    chunks.push(value);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
  } catch {
    throw new Error('بيانات غير صالحة');
  }
}
