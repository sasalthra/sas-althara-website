/**
 * Client-safe assistant provider helpers. This module must not read secrets.
 */

import {stageLabel} from './lead-stages';

export const DEFAULT_MODEL = 'gpt-4o-mini';

export type ProviderName = 'openai' | 'anthropic';

export type ProviderFailure = 'auth' | 'quota' | 'network' | 'model_not_found' | 'other';

/** OpenAI-style ids use hyphens. A snake_case label such as sas_althra_ai is not a model. */
export function isPlausibleModel(name: string): boolean {
  if (!name || name.length > 100) return false;
  if (/^sk[-_]/i.test(name)) return false;
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,99}$/.test(name)) return false;
  if (name.includes('_') && !name.includes('-')) return false;
  if (!name.includes('-') && !/^o[0-9]{1,2}$/.test(name)) return false;
  return true;
}

export function envStatusLine(model: string): string {
  const shown = model.replace(/[\r\n]/g, '').slice(0, 100);
  return `المزود مضبوط من إعدادات الخادم (env) — الطراز: ${shown}`;
}

export function providerFailureNotice(failure: ProviderFailure): string {
  switch (failure) {
    case 'auth':
      return 'مفتاح المزود غير صالح. يظهر أدناه ملخص الخادم.';
    case 'quota':
      return 'تجاوز المزود حصة الاستخدام أو نفد الرصيد. يظهر أدناه ملخص الخادم.';
    case 'network':
      return 'تعذر الاتصال بالمزود بسبب مشكلة في الشبكة. يظهر أدناه ملخص الخادم.';
    default:
      return 'تعذر الحصول على إجابة من المزود. يظهر أدناه ملخص الخادم.';
  }
}

function rowsOf(facts: unknown): Record<string, unknown>[] {
  if (!Array.isArray(facts)) return [];
  return facts.filter((row): row is Record<string, unknown> => Boolean(row) && typeof row === 'object');
}

function cell(value: unknown, fallback = '—'): string {
  if (typeof value === 'string' && value.trim()) return value.trim();
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return fallback;
}

function countOf(value: unknown): number {
  const number = typeof value === 'number' ? value : typeof value === 'string' && value.trim() ? Number(value) : NaN;
  return Number.isFinite(number) ? number : 0;
}

/** Fixed server summary used when the provider cannot answer. Names and phones are ignored. */
export function plainToolSummary(tool: 'leads_summary' | 'my_attendance', facts: unknown): string {
  const rows = rowsOf(facts);
  if (tool === 'my_attendance') {
    const lines = rows.map(row => `- ${cell(row.work_day)}: حضور ${cell(row.check_in)}، انصراف ${cell(row.check_out)}، تأخير ${countOf(row.late_minutes)} دقيقة`);
    return ['ملخص الخادم لسجل الحضور:', ...(lines.length ? lines : ['- لا توجد سجلات'])].join('\n');
  }
  const lines = rows.map(row => `- ${stageLabel(cell(row.stage, 'غير محدد'))}: ${countOf(row.count)}`);
  const total = rows.reduce((sum, row) => sum + countOf(row.count), 0);
  return ['ملخص الخادم لمراحل العملاء (دون أسماء أو جوالات):', ...(lines.length ? lines : ['- لا توجد سجلات']), `المجموع: ${total}`].join('\n');
}
