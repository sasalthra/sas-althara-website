/**
 * Lead phone numbers are stored as Saudi local mobiles `05XXXXXXXX` when the
 * digits are a Saudi mobile. Anything else keeps its cleaned digits so the
 * lead is not dropped. Staff phones in crm_users stay on the separate +966
 * normalizer in lib/lead-import.ts.
 *
 * `leads.phone` is VARCHAR(22). Values longer than that are shortened to the
 * column width so MySQL can store them.
 */

const STORE_MAX = 22;

export function phoneDigits(value: string | null | undefined): string {
  let text = String(value ?? '');
  text = text.normalize('NFKC');
  text = text.replace(/[٠-٩]/g, (ch) => String(ch.charCodeAt(0) - 0x0660));
  text = text.replace(/[۰-۹]/g, (ch) => String(ch.charCodeAt(0) - 0x06f0));
  text = text.replace(/[\u0640\u200B-\u200F\u202A-\u202E\u2060-\u206F]/g, '').trim();
  if (/^[+-]?\d+(?:\.\d+)?e[+-]?\d+$/i.test(text)) {
    const numeric = Number(text);
    if (Number.isFinite(numeric)) text = String(Math.round(numeric));
  }
  return text.replace(/\D/g, '');
}

/** Saudi mobile → `05XXXXXXXX`. Other numbers → cleaned digits, or '' when none. */
export function normalizeLeadPhone(value: string | null | undefined): string {
  const digits = phoneDigits(value);
  if (!digits) return '';
  let local = digits;
  if (local.startsWith('00966')) local = local.slice(5);
  else if (local.startsWith('966')) local = local.slice(3);
  if (/^5\d{8}$/.test(local)) local = `0${local}`;
  if (/^05\d{8}$/.test(local)) return local;
  return digits.slice(0, STORE_MAX);
}

export function isSaudiMobile(value: string | null | undefined): boolean {
  return /^05\d{8}$/.test(normalizeLeadPhone(value));
}

export function displayLeadPhone(value: string | null | undefined): string {
  const raw = String(value ?? '');
  const normalized = normalizeLeadPhone(raw);
  return normalized || raw.trim();
}

/** Forms a lead may already be stored under, before or after normalization. */
export function phoneLookupVariants(value: string | null | undefined): string[] {
  const normalized = normalizeLeadPhone(value);
  if (!normalized) return [];
  const variants = new Set<string>([normalized]);
  const digits = phoneDigits(value);
  if (digits && digits.length <= STORE_MAX) variants.add(digits);
  if (/^05\d{8}$/.test(normalized)) {
    const national = normalized.slice(1);
    variants.add(national);
    variants.add(`966${national}`);
    variants.add(`+966${national}`);
    variants.add(`00966${national}`);
  }
  return [...variants];
}

/**
 * True when a search box typed in any common Saudi spelling of the stored
 * number, including Arabic-Indic digits, +966, 00966, spaces and dashes.
 * A partial digit run also matches, so typing part of the mobile still finds it.
 */
export function leadPhoneMatchesQuery(
  stored: string | null | undefined,
  query: string | null | undefined
): boolean {
  const queryDigits = phoneDigits(query);
  if (!queryDigits) return false;
  const storedNorm = normalizeLeadPhone(stored);
  const queryNorm = normalizeLeadPhone(query);
  const storedDigits = phoneDigits(stored);
  if (
    storedNorm &&
    queryNorm &&
    (storedNorm === queryNorm || storedNorm.includes(queryNorm) || queryNorm.includes(storedNorm))
  ) {
    return true;
  }
  if (storedDigits && (storedDigits.includes(queryDigits) || queryDigits.includes(storedDigits))) {
    return true;
  }
  const storedLocal = storedNorm.replace(/^0+/, '');
  let queryLocal = queryDigits;
  if (queryLocal.startsWith('00966')) queryLocal = queryLocal.slice(5);
  else if (queryLocal.startsWith('966')) queryLocal = queryLocal.slice(3);
  queryLocal = queryLocal.replace(/^0+/, '');
  return Boolean(
    storedLocal &&
      queryLocal &&
      (storedLocal.includes(queryLocal) || queryLocal.includes(storedLocal))
  );
}

export type PhoneMigrationRow = {id: string; phone: string};

export type PhoneMigrationPlan = {
  updates: {id: string; phone: string}[];
  duplicateNotes: {id: string; phone: string; count: number}[];
};

/** Pure plan: rewrite stored phones and list every lead that shares one number. */
export function planLeadPhoneMigration(rows: PhoneMigrationRow[]): PhoneMigrationPlan {
  const updates: {id: string; phone: string}[] = [];
  const groups = new Map<string, string[]>();
  for (const row of rows) {
    if (!row.id) continue;
    const normalized = normalizeLeadPhone(row.phone);
    if (normalized && normalized !== row.phone) updates.push({id: row.id, phone: normalized});
    if (!normalized) continue;
    const list = groups.get(normalized) || [];
    list.push(row.id);
    groups.set(normalized, list);
  }
  const duplicateNotes: {id: string; phone: string; count: number}[] = [];
  for (const [phone, ids] of groups) {
    if (ids.length < 2) continue;
    for (const id of ids) duplicateNotes.push({id, phone, count: ids.length});
  }
  return {updates, duplicateNotes};
}
