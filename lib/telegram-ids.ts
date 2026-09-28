/** Bot API channel ids look like -100 plus the id Telegram Desktop exports. */
export function normalizeChatId(id: string): string {
  const value = id.trim();
  if (!value) return '';
  if (/^-100\d+$/.test(value)) return value;
  if (/^\d+$/.test(value)) return `-100${value}`;
  return value;
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

export function packMessageIds(ids: string[]): string {
  const clean = [...new Set(ids.filter(id => /^\d+$/.test(id)))];
  return clean.length ? `,${clean.join(',')},` : '';
}

export function unpackMessageIds(value: unknown): string[] {
  if (value == null) return [];
  return String(value).split(',').filter(id => /^\d+$/.test(id));
}
