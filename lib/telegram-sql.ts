import {asBinary} from './sql-collation';

/** Exact byte match. Both sides are CAST AS BINARY so mixed collations cannot raise 1267. */
export function exactEq(left: string, right: string) {
  return `${asBinary(left)} = ${asBinary(right)}`;
}

export {asBinary};

export function propertyLookupSql(likeCount: number) {
  const likes = Array.from({length: likeCount}, () => `${asBinary('telegram_message_ids')} LIKE ${asBinary('?')}`).join(' OR ');
  const byKey = `(${exactEq('telegram_source_hash', '?')} OR ${exactEq('telegram_source_key', '?')})`;
  const byGroup = `(${exactEq('telegram_chat_id', '?')} AND ${asBinary('?')} <> ${asBinary("''")} AND ${exactEq('telegram_media_group_id', '?')})`;
  const byMessages = likes ? `OR (${exactEq('telegram_chat_id', '?')} AND (${likes}))` : '';
  return `SELECT id, description, image_meta, telegram_message_ids, telegram_media_group_id, telegram_source_key
    FROM site_properties
    WHERE ${byKey}
       OR ${byGroup}
       ${byMessages}
    LIMIT 1 FOR UPDATE`;
}

export function recentSyncSql(limit: number) {
  const size = Number.isInteger(limit) ? Math.min(Math.max(limit, 1), 80) : 40;
  return `SELECT l.id, l.action, l.note, l.property_id, l.created_at, l.chat_id, l.message_id, l.media_group_id, p.title
     FROM telegram_sync_log l
     LEFT JOIN site_properties p ON ${exactEq('p.id', 'l.property_id')}
     ORDER BY l.created_at DESC, l.id DESC
     LIMIT ${size}`;
}

export function seenChatsSql(limit: number) {
  const size = Number.isInteger(limit) ? Math.min(Math.max(limit, 1), 40) : 20;
  return `SELECT chat_id, title, chat_type, last_message_id, last_seen_at
     FROM telegram_seen_chats
     ORDER BY last_seen_at DESC, chat_id DESC
     LIMIT ${size}`;
}

export function seenChatLookupSql() {
  return `SELECT title, chat_type FROM telegram_seen_chats WHERE ${exactEq('chat_id', '?')} LIMIT 1`;
}

export function seenChatUpdateSql() {
  return `UPDATE telegram_seen_chats
     SET title = ?, chat_type = ?, last_message_id = ?, last_seen_at = ?
     WHERE ${exactEq('chat_id', '?')}`;
}

export function propertyIdWhere() {
  return exactEq('id', '?');
}

/** Offer republish matches the canonical id or its source hash, not a fragment row that happens to share a message id. */
export function propertyByOfferSql() {
  return `SELECT id, description, image_meta, telegram_message_ids, telegram_media_group_id, telegram_source_key
    FROM site_properties
    WHERE ${exactEq('telegram_source_hash', '?')} OR ${exactEq('id', '?')}
    LIMIT 1 FOR UPDATE`;
}

export function messageLookupSql() {
  return `SELECT id, message_date FROM telegram_messages WHERE ${exactEq('chat_id', '?')} AND ${exactEq('message_id', '?')} LIMIT 1`;
}

export function messagesByChatSql() {
  return `SELECT chat_id, message_id, message_date, media_group_id, kind, body, file_id, file_unique_id
     FROM telegram_messages
     WHERE ${exactEq('chat_id', '?')}`;
}

export function redirectLookupSql() {
  return `SELECT target_id FROM telegram_redirects WHERE ${exactEq('id', '?')} LIMIT 1`;
}

export function deletePropertySql() {
  return `DELETE FROM site_properties WHERE ${exactEq('id', '?')}`;
}

/** Admin-facing sync-log failure. Code and errno only — no SQL, host, or password. */
export function telegramDbError(error: unknown): string {
  const err = error && typeof error === 'object' ? error as {code?: unknown; errno?: unknown} : {};
  const code = typeof err.code === 'string' && /^[A-Z][A-Z0-9_]{1,63}$/.test(err.code) ? err.code : '';
  const errno = typeof err.errno === 'number' && Number.isInteger(err.errno) ? String(err.errno) : '';
  const token = [code, errno].filter(Boolean).join('/');
  return token
    ? `تعذر قراءة سجل المزامنة (رمز ${token}). تأكد من اتصال MySQL.`
    : 'تعذر قراءة سجل المزامنة. تأكد من اتصال MySQL.';
}
