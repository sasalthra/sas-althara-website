import {z} from 'zod';
import {crmDb, crmTransaction} from '@/lib/crm-db';
import {actor, body, endpoint, reply} from '@/lib/secure-api';
import {loadAssignments, loadAssistantSnapshot, loadReportAlignment} from '@/lib/admin-assistant-data';
import {
  ASSISTANT_ROLES,
  OVERDUE_RULE,
  answerDeterministic,
  modelFacts,
  redactPhones,
} from '@/lib/admin-assistant';
import {riyadhDayKey} from '@/lib/lead-dates';
import {displayLeadPhone} from '@/lib/phone';
import {completeFromAggregates, ProviderCallError} from '@/lib/ai-complete';
import {credentialsFromRow, readEnvAi} from '@/lib/ai-env.server';
import {providerFailureNotice} from '@/lib/ai-public';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const roles = [...ASSISTANT_ROLES];
const questionSchema = z.object({
  question: z.string().trim().min(2).max(2000),
}).strict();

function localAlerts(snapshot: Awaited<ReturnType<typeof loadAssistantSnapshot>>) {
  return snapshot.alerts.map(alert => ({
    id: alert.id,
    name: alert.name,
    phone: displayLeadPhone(alert.phone),
    stage: alert.stage,
    stageLabel: alert.stageLabel,
    salesName: alert.salesName,
    days: alert.days,
    line: `العميل ${alert.name} دون متابعة منذ ${alert.days} أيام`,
  }));
}

export async function GET() {
  return endpoint(async () => {
    const user = await actor(undefined, roles);
    const snapshot = await loadAssistantSnapshot(crmDb(), new Date(), user);
    const env = readEnvAi();
    let configured = Boolean(env);
    if (!env) {
      const config = await crmDb()
        .prepare("SELECT provider FROM ai_settings WHERE id='primary'")
        .first<{provider: string}>();
      configured = Boolean(config && ['openai', 'anthropic'].includes(config.provider));
    }
    return reply({
      kpis: snapshot.kpis,
      alerts: localAlerts(snapshot),
      alertsTotal: snapshot.alertsTotal,
      overdueRule: OVERDUE_RULE,
      configured,
      providerSource: env ? 'env' : 'database',
      ...(env && user.role === 'admin' ? {model: env.model} : {}),
    });
  });
}

async function withinLimit(userId: string) {
  const hour = new Date().toISOString().slice(0, 13);
  let allowed = true;
  await crmTransaction(async tx => {
    await tx.prepare('INSERT INTO ai_usage (user_id,hour_key,requests) VALUES (?,?,1) ON DUPLICATE KEY UPDATE requests=requests+1')
      .bind(userId, hour)
      .run();
    const usage = await tx.prepare('SELECT requests FROM ai_usage WHERE user_id=? AND hour_key=?')
      .bind(userId, hour)
      .first<{requests: number}>();
    if (!usage || usage.requests > 20) allowed = false;
  });
  return allowed;
}

function localReply(local: string, notice?: string, reason?: string) {
  return reply({
    answer: notice ? `${notice}\n\n${local}` : local,
    source: 'local',
    ...(reason ? {reason} : {}),
    ...(notice ? {notice} : {}),
  });
}

export async function POST(req: Request) {
  return endpoint(async () => {
    const user = await actor(req, roles);
    const input = questionSchema.parse(await body(req, 8000));
    const db = crmDb();
    const snapshot = await loadAssistantSnapshot(db, new Date(), user);
    const executeTool = async (name: string, args: Record<string, unknown>) => {
      const text = (key: string) => typeof args[key] === 'string' ? String(args[key]) : '';
      const today = riyadhDayKey(new Date());
      if (name === 'assignments') return loadAssignments(db, text('from') || today, text('to') || today, text('employee'));
      if (name !== 'lead_counts' && name !== 'overdue_clients') return {unavailable: true, error: 'أداة غير معروفة'};
      const aligned = await loadReportAlignment(db, new Date(), user, {from: text('from'), to: text('to'), employee: text('employee'), source: text('source'), stage: text('stage')});
      if (!aligned) return {unavailable: true};
      if (name === 'overdue_clients') return {unavailable: false, overdue: aligned.overdue, byEmployee: aligned.employees.filter(row => row.overdue > 0).map(row => ({name: row.name, overdue: row.overdue})), rule: OVERDUE_RULE};
      const group = text('groupBy') || 'total';
      if (group === 'stage') return {unavailable: false, total: aligned.total, stages: aligned.stages, period: {from: aligned.from, to: aligned.to}};
      if (group === 'source') return {unavailable: false, total: aligned.total, sources: aligned.sources, period: {from: aligned.from, to: aligned.to}};
      if (group === 'employee') return {unavailable: false, total: aligned.total, employees: aligned.employees, period: {from: aligned.from, to: aligned.to}};
      return {unavailable: false, total: aligned.total, signed: aligned.signed, overdue: aligned.overdue, scheduled: aligned.scheduled, period: {from: aligned.from, to: aligned.to}};
    };
    const local = redactPhones(answerDeterministic(input.question, snapshot));
    const env = readEnvAi();
    const config = env ? null : await db
      .prepare("SELECT provider, model, encrypted_key FROM ai_settings WHERE id='primary'")
      .first<{provider: string; model: string; encrypted_key: string}>();
    let credentials;
    try {
      credentials = credentialsFromRow(config);
    } catch {
      console.error('admin assistant could not read the stored provider key');
      return localReply(local, providerFailureNotice('other'), 'provider');
    }
    if (!credentials) return reply({answer: local, source: 'local'});
    try {
      const allowed = await withinLimit(user.userId);
      if (!allowed) return reply({answer: local, source: 'local', reason: 'limit'});
      await db.prepare('INSERT INTO crm_audit (id,actor_id,action,target_id,details,created_at) VALUES (?,?,?,?,?,?)')
        .bind(crypto.randomUUID(), user.userId, 'ai.read', 'assistant', JSON.stringify({provider: credentials.provider, source: credentials.source}), new Date().toISOString())
        .run();
      const answer = await completeFromAggregates({
        provider: credentials.provider,
        model: credentials.model,
        apiKey: credentials.apiKey,
        question: input.question,
        facts: modelFacts(snapshot),
        executeTool,
      });
      return reply({answer, source: 'model'});
    } catch (error) {
      const failure = error instanceof ProviderCallError ? error.failure : 'other';
      console.error(`admin assistant provider call failed: ${failure}`);
      const notice = providerFailureNotice(failure === 'model_not_found' ? 'other' : failure);
      return localReply(local, notice, failure === 'auth' || failure === 'quota' || failure === 'network' ? failure : 'provider');
    }
  });
}
