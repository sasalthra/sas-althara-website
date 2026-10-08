import {actor, endpoint, reply} from '@/lib/secure-api';
import {publicSiteOrigin, safeTelegramError, telegramMethod} from '@/lib/telegram-bot';
import {lastTelegramSchemaError} from '@/lib/lead-schema';
import {telegramDbError} from '@/lib/telegram-sql';
import {listTelegramChats, recentTelegramSync} from '@/lib/telegram-sync';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type WebhookInfo = {
  url?: string;
  pending_update_count?: number;
  last_error_message?: string;
  last_error_date?: number;
  allowed_updates?: string[];
};

export async function GET(req: Request) {
  return endpoint(async () => {
    await actor(undefined, ['admin']);
    const tokenConfigured = Boolean(process.env.TELEGRAM_BOT_TOKEN?.trim());
    const secretConfigured = Boolean(process.env.TELEGRAM_WEBHOOK_SECRET?.trim());
    const channelId = (process.env.TELEGRAM_CHANNEL_ID || '').trim() || null;
    const siteUrl = publicSiteOrigin(req);
    let bot: {id: number | null; username: string} | null = null;
    let botError: string | null = null;
    let webhook: {url: string; pendingUpdateCount: number; lastErrorMessage: string | null; lastErrorDate: number | null; allowedUpdates: string[]} | null = null;
    let webhookError: string | null = null;
    if (tokenConfigured) {
      try {
        const me = await telegramMethod('getMe') as {id?: number; username?: string};
        bot = {id: typeof me.id === 'number' ? me.id : null, username: me.username || ''};
      } catch (error) {
        botError = safeTelegramError(error, 'تعذر قراءة حالة البوت');
      }
      try {
        const info = await telegramMethod('getWebhookInfo') as WebhookInfo;
        webhook = {
          url: info.url || '',
          pendingUpdateCount: info.pending_update_count ?? 0,
          lastErrorMessage: info.last_error_message || null,
          lastErrorDate: info.last_error_date ?? null,
          allowedUpdates: Array.isArray(info.allowed_updates) ? info.allowed_updates.map(String) : [],
        };
      } catch (error) {
        webhookError = safeTelegramError(error, 'تعذر قراءة الويب هوك');
      }
    }
    let recent: Awaited<ReturnType<typeof recentTelegramSync>> = [];
    let seenChats: Awaited<ReturnType<typeof listTelegramChats>> = [];
    let dbError: string | null = null;
    try {
      recent = await recentTelegramSync(40);
      seenChats = await listTelegramChats(30);
    } catch (error) {
      console.error('telegram status log failed', error);
      dbError = telegramDbError(lastTelegramSchemaError() ?? error);
    }
    return reply({
      tokenConfigured,
      secretConfigured,
      channelId,
      siteUrl,
      webhookPath: '/api/telegram/webhook',
      bot,
      botError,
      webhook,
      webhookError,
      recent,
      seenChats,
      lastChat: seenChats[0] ?? null,
      dbError,
    });
  });
}
