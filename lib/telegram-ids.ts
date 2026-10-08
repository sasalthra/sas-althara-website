import {createHash} from 'node:crypto';

/**
 * Bot API channel and supergroup ids look like -100 plus the bare id Telegram Desktop exports.
 * A basic group id is already negative and does not use the -100 prefix; it is kept as written.
 */
export function normalizeChatId(id: string): string {
  const value = id.trim();
  if (!value) return '';
  if (/^-100\d+$/.test(value)) return value;
  if (/^\d+$/.test(value)) return `-100${value}`;
  return value;
}

const BASIC_GROUP_TYPES = new Set(['private_group', 'public_group']);

/** Desktop export id. Supergroups and channels use -100. Basic groups use a single leading minus. */
export function exportChatId(id: string, type = ''): string {
  const value = id.trim();
  if (BASIC_GROUP_TYPES.has(type)) {
    if (/^-\d+$/.test(value) && !/^-100\d+$/.test(value)) return value;
    const digits = value.replace(/\D/g, '');
    return digits ? `-${digits}` : '';
  }
  return normalizeChatId(value);
}

/** SHA-256 hex. The unique key is this column, not the raw source string (MySQL 5.7 index limit and TEXT key error 1170). */
export function sourceKeyHash(sourceKey: string): string {
  return createHash('sha256').update(sourceKey, 'utf8').digest('hex');
}

export function sourceKeyFor(chatId: string, messageId: string, mediaGroupId: string | null): string {
  const chat = normalizeChatId(chatId);
  if (mediaGroupId) return `${chat}:g:${mediaGroupId}`;
  return `${chat}:m:${messageId}`;
}

export function propertyIdFor(chatId: string, messageId: string, mediaGroupId: string | null): string {
  const chat = normalizeChatId(chatId).replace(/[^0-9]/g, '') || '0';
  if (mediaGroupId) {
    const group = mediaGroupId.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 48);
    return `tg-${chat}-g-${group || messageId.replace(/[^0-9]/g, '')}`;
  }
  return `tg-${chat}-m-${messageId.replace(/[^0-9]/g, '')}`;
}

/** One listing for every message between two sticker separators. */
export function offerPropertyId(chatId: string, firstMessageId: string): string {
  const chat = normalizeChatId(chatId).replace(/[^0-9]/g, '') || '0';
  const message = firstMessageId.replace(/[^0-9]/g, '') || '0';
  return `tg-${chat}-o-${message}`;
}

export function offerSourceKey(chatId: string, firstMessageId: string): string {
  return `${normalizeChatId(chatId)}:o:${firstMessageId.replace(/[^0-9]/g, '')}`;
}

/** VARCHAR primary key. Chat id plus message id stays under 96 characters. */
export function messageRowId(chatId: string, messageId: string): string {
  return `${normalizeChatId(chatId)}:${messageId.replace(/[^0-9]/g, '')}`.slice(0, 96);
}

export function packMessageIds(ids: string[]): string {
  const clean = [...new Set(ids.filter(id => /^\d+$/.test(id)))];
  return clean.length ? `,${clean.join(',')},` : '';
}

export function unpackMessageIds(value: unknown): string[] {
  if (value == null) return [];
  return String(value).split(',').filter(id => /^\d+$/.test(id));
}
