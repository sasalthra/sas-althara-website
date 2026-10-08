export type ExportMessage = {
  id?: number | string;
  type?: string;
  date?: string;
  date_unixtime?: string | number;
  text?: unknown;
  caption?: unknown;
  photo?: unknown;
  file?: unknown;
  mime_type?: string;
  media_group_id?: string | number;
  grouped_id?: string | number;
};

export function exportText(value: unknown): string {
  if (typeof value === 'string') return value;
  if (!Array.isArray(value)) return '';
  return value.map(part => {
    if (typeof part === 'string') return part;
    if (part && typeof part === 'object' && 'text' in part) return exportText((part as {text: unknown}).text);
    return '';
  }).join('');
}

export function messageText(message: ExportMessage): string {
  const text = exportText(message.text);
  if (text.trim()) return text;
  return exportText(message.caption);
}

export function messagePhotoPaths(message: ExportMessage): string[] {
  const paths: string[] = [];
  const push = (value: unknown) => {
    if (typeof value !== 'string') return;
    const trimmed = value.trim().replace(/\\/g, '/');
    if (!trimmed || trimmed.startsWith('(') || /not included|file not included/i.test(trimmed)) return;
    if (trimmed.includes('..')) return;
    if (/\.(jpe?g|png|webp|gif)$/i.test(trimmed) || trimmed.includes('photos/')) paths.push(trimmed);
  };
  push(message.photo);
  if (!message.mime_type || String(message.mime_type).startsWith('image/')) push(message.file);
  return paths;
}

function groupIdOf(message: ExportMessage): string {
  const value = message.media_group_id ?? message.grouped_id;
  if (value == null) return '';
  return String(value);
}

/** Albums share media_group_id, or (in Desktop JSON) the same timestamp and photos. */
export function groupExportMessages(messages: ExportMessage[]): ExportMessage[][] {
  const list = messages.filter(message => message && message.type !== 'service' && message.type !== 'unsupported');
  const groups: ExportMessage[][] = [];
  let index = 0;
  while (index < list.length) {
    const current = list[index];
    if (!current) break;
    const groupId = groupIdOf(current);
    if (groupId) {
      const bucket = [current];
      index += 1;
      while (index < list.length && groupIdOf(list[index] as ExportMessage) === groupId) {
        bucket.push(list[index] as ExportMessage);
        index += 1;
      }
      groups.push(bucket);
      continue;
    }
    const stamp = String(current.date_unixtime ?? current.date ?? '');
    if (stamp && messagePhotoPaths(current).length) {
      const bucket = [current];
      let next = index + 1;
      while (next < list.length) {
        const candidate = list[next];
        if (!candidate || groupIdOf(candidate)) break;
        if (String(candidate.date_unixtime ?? candidate.date ?? '') !== stamp) break;
        if (!messagePhotoPaths(candidate).length) break;
        bucket.push(candidate);
        next += 1;
      }
      if (bucket.length > 1) {
        groups.push(bucket);
        index = next;
        continue;
      }
    }
    groups.push([current]);
    index += 1;
  }
  return groups;
}

export function combinedText(messages: ExportMessage[]): string {
  if (messages.length === 1) return messageText(messages[0] as ExportMessage);
  return messages.map(messageText).filter(part => part.trim()).join('\n\n');
}

export type ExportChat = {
  id: string;
  type: string;
  name: string;
  messages: ExportMessage[];
};

const SUPPORTED_EXPORT_TYPES = new Set([
  '',
  'public_channel',
  'private_channel',
  'public_supergroup',
  'private_supergroup',
  'public_group',
  'private_group',
]);

/** Telegram Desktop single-chat export and the chats.list wrapper. Groups use private_supergroup / public_supergroup. */
export function supportedExportType(type: string) {
  return SUPPORTED_EXPORT_TYPES.has(type);
}

export function readExportChats(value: unknown): ExportChat[] {
  if (Array.isArray(value)) return [{id: '', type: '', name: '', messages: value as ExportMessage[]}];
  if (!value || typeof value !== 'object') return [];
  const record = value as Record<string, unknown>;
  if (Array.isArray(record.messages)) {
    return [{
      id: record.id == null ? '' : String(record.id),
      type: typeof record.type === 'string' ? record.type : '',
      name: typeof record.name === 'string' ? record.name : '',
      messages: record.messages as ExportMessage[],
    }];
  }
  const chats = record.chats;
  if (chats && typeof chats === 'object' && Array.isArray((chats as {list?: unknown}).list)) {
    return ((chats as {list: unknown[]}).list).flatMap(item => readExportChats(item));
  }
  return [];
}
