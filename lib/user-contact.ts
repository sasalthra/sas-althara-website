import {normalizeEmail} from './assignment-email';
import {normalizePhone} from './lead-import';

export type ContactField<T> = {ok: true; value: T} | {ok: false; error: string};

/** Empty is allowed. A present address must be a real email, stored lowercase. */
export function parseUserEmail(value: string | null | undefined): ContactField<string> {
  const raw = (value ?? '').trim();
  if (!raw) return {ok: true, value: ''};
  const email = normalizeEmail(raw);
  if (!email || email.length > 190) return {ok: false, error: 'صيغة البريد الإلكتروني غير صالحة'};
  return {ok: true, value: email};
}

/**
 * Empty is allowed. Saudi mobiles (05, 5, 9665, +9665, 009665) become +9665xxxxxxxx.
 * Other international numbers that already parse stay in +E.164 form.
 */
export function parseUserPhone(value: string | null | undefined): ContactField<string> {
  const raw = (value ?? '').trim();
  if (!raw) return {ok: true, value: ''};
  const phone = normalizePhone(raw);
  if (!phone || phone.length > 30) return {ok: false, error: 'رقم الجوال غير صالح. استخدم رقماً سعودياً مثل 05xxxxxxxx'};
  return {ok: true, value: phone};
}
