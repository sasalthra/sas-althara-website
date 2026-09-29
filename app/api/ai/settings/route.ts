import {z} from 'zod';
import {crmDb, crmTransaction} from '@/lib/crm-db';
import {actor, body, endpoint, reply, ApiError} from '@/lib/secure-api';
import {seal} from '@/lib/secrets.server';
import {readEnvAi} from '@/lib/ai-env.server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const schema = z.object({
  provider: z.enum(['openai', 'anthropic']),
  model: z.string().trim().regex(/^[a-zA-Z0-9._:-]{1,100}$/),
  apiKey: z.string().trim().min(10).max(512),
}).strict();

function sealKey(apiKey: string, provider: string) {
  try {
    return seal(apiKey, provider);
  } catch (error) {
    const message = error instanceof Error ? error.message : '';
    if (/encryption|configured/i.test(message)) {
      throw new ApiError(503, 'تعذر حفظ المفتاح لأن APP_ENCRYPTION_KEY غير مُعد أو غير صالح على الخادم. اضبط مفتاح التشفير ثم أعد الحفظ.');
    }
    throw error;
  }
}

export async function GET() {
  return endpoint(async () => {
    await actor(undefined, ['admin']);
    const env = readEnvAi();
    if (env) {
      return reply({
        configured: true,
        source: 'env',
        provider: env.provider,
        model: env.model,
        formEnabled: false,
      });
    }
    const row = await crmDb()
      .prepare("SELECT provider,model,updated_at FROM ai_settings WHERE id='primary'")
      .first<{provider: string; model: string; updated_at: string}>();
    if (!row) return reply({configured: false, source: 'database', formEnabled: true});
    return reply({
      configured: true,
      source: 'database',
      provider: row.provider,
      model: row.model,
      updatedAt: row.updated_at,
      formEnabled: true,
    });
  });
}

export async function POST(req: Request) {
  return endpoint(async () => {
    const user = await actor(req, ['admin']);
    if (readEnvAi()) {
      throw new ApiError(409, 'المزود مضبوط من إعدادات الخادم ولا يُحفظ من النموذج');
    }
    const saved = schema.parse(await body(req, 4000));
    const encrypted = sealKey(saved.apiKey, saved.provider);
    const now = new Date().toISOString();
    await crmTransaction(async db => {
      await db.prepare("INSERT INTO ai_settings (id,provider,model,encrypted_key,updated_at) VALUES ('primary',?,?,?,?) ON DUPLICATE KEY UPDATE provider=VALUES(provider),model=VALUES(model),encrypted_key=VALUES(encrypted_key),updated_at=VALUES(updated_at)")
        .bind(saved.provider, saved.model, encrypted, now)
        .run();
      await db.prepare('INSERT INTO crm_audit (id,actor_id,action,target_id,details,created_at) VALUES (?,?,?,?,?,?)')
        .bind(crypto.randomUUID(), user.userId, 'ai.settings', 'primary', JSON.stringify({provider: saved.provider}), now)
        .run();
    });
    return reply({ok: true});
  });
}
