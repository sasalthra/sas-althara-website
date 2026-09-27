import {normalizeEmail} from './assignment-email';
import {normalizePhone} from './lead-import';

export type ContactField<T> = {ok: true; value: T} | {ok: false; error: string};

/** Matches `crm_users.name` VARCHAR(100). Login username is a different column. */
export const USER_NAME_MAX = 100;

/**
 * Display name shown across the CRM. Required, trimmed, 2–100 characters.
 * Does not accept the login username and must not be stored in its place.
 */
export function parseUserName(value: string | null | undefined): ContactField<string> {
  const name = (value ?? '').trim();
  if (!name) return {ok: false, error: 'الاسم مطلوب'};
  if (name.length < 2) return {ok: false, error: 'الاسم قصير جدًا'};
  if (name.length > USER_NAME_MAX) return {ok: false, error: 'الاسم طويل جدًا'};
  return {ok: true, value: name};
}

/** Field assignee id copied into activity JSON, when the event recorded one. */
export function fieldAssigneeId(details: unknown) {
  if (!details || typeof details !== 'object' || Array.isArray(details)) return '';
  const id = (details as {fieldAssignedTo?: unknown}).fieldAssignedTo;
  return typeof id === 'string' ? id.trim() : '';
}

/**
 * Activity rows keep a name snapshot in JSON. Display reads the current
 * crm_users name when that person still exists, and leaves the snapshot
 * when they do not.
 */
export function withLiveActivityNames(
  details: unknown,
  live: {actorName?: string | null; fieldName?: string | null}
) {
  if (!details || typeof details !== 'object' || Array.isArray(details)) return details;
  const next = {...(details as Record<string, unknown>)};
  const fieldName = live.fieldName?.trim();
  if (fieldName && fieldAssigneeId(next)) next.fieldAssignedName = fieldName;
  const actorName = live.actorName?.trim();
  if (actorName && typeof next.dispatchedByName === 'string') next.dispatchedByName = actorName;
  return next;
}

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
