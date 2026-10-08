import {normalizeChatId} from './telegram-ids';

export type TelegramFile = {
  fileId: string;
  fileUniqueId: string;
  fileName?: string;
  mime?: string;
};

export type ParsedTelegramUpdate = {
  chatId: string;
  chatTitle: string;
  chatType: string;
  messageId: string;
  mediaGroupId: string | null;
  text: string;
  edited: boolean;
  /** Channel, group, or supergroup. Private chats are recorded but not published. */
  accepted: boolean;
  service: boolean;
  photo: TelegramFile | null;
  /** text, photo, sticker, or anything else (service, empty, deleted). */
  kind: 'text' | 'photo' | 'sticker' | 'other';
  /** Original Telegram unix seconds. Edits keep this value so offer gaps stay stable. */
  date: number | null;
  files: TelegramFile[];
};

const SERVICE_KEYS = [
  'new_chat_members',
  'left_chat_member',
  'new_chat_title',
  'new_chat_photo',
  'delete_chat_photo',
  'group_chat_created',
  'supergroup_chat_created',
  'channel_chat_created',
  'migrate_to_chat_id',
  'migrate_from_chat_id',
  'pinned_message',
  'forum_topic_created',
  'forum_topic_closed',
  'video_chat_started',
  'video_chat_ended',
];

type TgPhoto = {file_id?: string; file_unique_id?: string; file_size?: number; width?: number; height?: number};
type TgMessage = {
  message_id?: number | string;
  media_group_id?: string | number;
  chat?: {id?: number | string; title?: string; type?: string; username?: string};
  text?: unknown;
  caption?: unknown;
  date?: number | string;
  photo?: TgPhoto[];
  sticker?: {file_id?: string; file_unique_id?: string};
  document?: {file_id?: string; file_unique_id?: string; mime_type?: string; file_name?: string};
} & Record<string, unknown>;

function numericId(value: unknown) {
  if (typeof value === 'string' && /^-?\d+$/.test(value.trim())) return value.trim();
  if (typeof value === 'number' && Number.isSafeInteger(value)) return String(value);
  return '';
}

function plainText(value: unknown) {
  return typeof value === 'string' ? value : '';
}

function largestPhoto(photos: TgPhoto[]) {
  return [...photos].sort((left, right) => {
    const leftSize = left.file_size ?? (left.width ?? 0) * (left.height ?? 0);
    const rightSize = right.file_size ?? (right.width ?? 0) * (right.height ?? 0);
    return rightSize - leftSize;
  })[0];
}

function unixDate(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return Math.trunc(value);
  if (typeof value === 'string' && /^-?\d+$/.test(value.trim())) return Number(value.trim());
  return null;
}

function stickerOf(message: TgMessage): TelegramFile | null {
  const sticker = message.sticker;
  if (!sticker?.file_id || !sticker.file_unique_id) return null;
  return {fileId: sticker.file_id, fileUniqueId: sticker.file_unique_id, fileName: 'sticker.webp'};
}

function photoOf(message: TgMessage): TelegramFile | null {
  const photo = Array.isArray(message.photo) ? largestPhoto(message.photo.filter(item => item?.file_id && item.file_unique_id)) : undefined;
  if (photo?.file_id && photo.file_unique_id) {
    return {fileId: photo.file_id, fileUniqueId: photo.file_unique_id, fileName: 'photo.jpg'};
  }
  const document = message.document?.mime_type?.startsWith('image/') ? message.document : undefined;
  if (document?.file_id && document.file_unique_id) {
    return {fileId: document.file_id, fileUniqueId: document.file_unique_id, fileName: document.file_name, mime: document.mime_type};
  }
  return null;
}

function accepts(kind: 'channel' | 'group', type: string, chatId: string) {
  if (kind === 'channel') {
    if (type === 'group' || type === 'supergroup' || type === 'private') return false;
    return type === 'channel' || type === '' || chatId.startsWith('-');
  }
  if (type === 'group' || type === 'supergroup') return true;
  if (type === 'private' || type === 'channel') return false;
  return chatId.startsWith('-');
}

function wrappedMessage(update: Record<string, unknown>): {message: TgMessage; edited: boolean; kind: 'channel' | 'group'} | null {
  const keys: [string, boolean, 'channel' | 'group'][] = [
    ['channel_post', false, 'channel'],
    ['edited_channel_post', true, 'channel'],
    ['message', false, 'group'],
    ['edited_message', true, 'group'],
  ];
  for (const [key, edited, kind] of keys) {
    const value = update[key];
    if (value && typeof value === 'object') return {message: value as TgMessage, edited, kind};
  }
  return null;
}

/** One Bot API update: channel post or a group/supergroup message, including edits and albums. */
export function parseTelegramUpdate(update: unknown): ParsedTelegramUpdate | null {
  if (!update || typeof update !== 'object' || Array.isArray(update)) return null;
  const wrapped = wrappedMessage(update as Record<string, unknown>);
  if (!wrapped) return null;
  const {message, edited, kind} = wrapped;
  const rawId = numericId(message.chat?.id);
  const messageId = numericId(message.message_id).replace(/^-/, '');
  const type = typeof message.chat?.type === 'string' ? message.chat.type : '';
  // Group and channel ids from the Bot API are already negative. A positive id on
  // `message` is a private chat and must not gain the channel -100 prefix.
  const chatId = kind === 'group' && /^\d+$/.test(rawId) ? rawId : normalizeChatId(rawId);
  if (!chatId || !messageId) return null;
  const text = plainText(message.text).trim() ? plainText(message.text) : plainText(message.caption);
  const photo = photoOf(message);
  const sticker = stickerOf(message);
  const stickerMessage = Boolean(message.sticker && typeof message.sticker === 'object');
  const service = SERVICE_KEYS.some(key => message[key] != null) && !text.trim() && !photo && !stickerMessage;
  const mediaGroupId = message.media_group_id == null || message.media_group_id === '' ? null : String(message.media_group_id);
  const messageKind: ParsedTelegramUpdate['kind'] = stickerMessage
    ? 'sticker'
    : service
      ? 'other'
      : photo
        ? 'photo'
        : text.trim()
          ? 'text'
          : 'other';
  return {
    chatId,
    chatTitle: typeof message.chat?.title === 'string' ? message.chat.title.trim().slice(0, 255) : '',
    chatType: type,
    messageId,
    mediaGroupId,
    text,
    edited,
    accepted: accepts(kind, type, chatId),
    service,
    photo,
    kind: messageKind,
    date: unixDate(message.date),
    files: photo ? [photo] : sticker ? [sticker] : [],
  };
}

/** TELEGRAM_CHANNEL_ID, when set, is a channel, group, or supergroup chat id. */
export function chatAllowed(chatId: string, configured = process.env.TELEGRAM_CHANNEL_ID || ''): boolean {
  const allowed = configured.trim();
  if (!allowed) return true;
  return normalizeChatId(allowed) === chatId;
}

/** Album parts that share a chat and media_group_id become one group, even if other messages sit between them. */
export function groupIncomingMessages(messages: ParsedTelegramUpdate[]): ParsedTelegramUpdate[][] {
  const groups: ParsedTelegramUpdate[][] = [];
  const index = new Map<string, number>();
  for (const message of messages) {
    if (!message.mediaGroupId) {
      groups.push([message]);
      continue;
    }
    const key = `${message.chatId}\n${message.mediaGroupId}`;
    const at = index.get(key);
    if (at == null) {
      index.set(key, groups.length);
      groups.push([message]);
    } else {
      groups[at].push(message);
    }
  }
  return groups;
}

export function collapseAlbum(messages: ParsedTelegramUpdate[]) {
  const first = messages[0];
  if (!first) {
    return {
      chatId: '',
      chatTitle: '',
      chatType: '',
      messageIds: [] as string[],
      mediaGroupId: null as string | null,
      text: '',
      edited: false,
      accepted: false,
      photos: [] as TelegramFile[],
    };
  }
  const messageIds = [...new Set(messages.map(item => item.messageId).filter(Boolean))];
  let text = '';
  for (const item of messages) {
    if (item.text.trim().length >= text.trim().length) text = item.text;
  }
  const photos: TelegramFile[] = [];
  for (const item of messages) {
    if (!item.photo) continue;
    const same = photos.findIndex(photo => photo.fileUniqueId && photo.fileUniqueId === item.photo?.fileUniqueId);
    if (same >= 0) photos[same] = item.photo;
    else photos.push(item.photo);
  }
  const titled = messages.find(item => item.chatTitle);
  return {
    chatId: first.chatId,
    chatTitle: titled?.chatTitle || first.chatTitle,
    chatType: first.chatType,
    messageIds,
    mediaGroupId: messages.find(item => item.mediaGroupId)?.mediaGroupId ?? first.mediaGroupId,
    text,
    edited: messages.some(item => item.edited),
    accepted: messages.some(item => item.accepted),
    photos,
  };
}
