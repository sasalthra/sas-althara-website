import type {Pool, PoolConnection, RowDataPacket} from 'mysql2/promise';
import {crmPool} from './crm-db';
import {ensureLeadSchema} from './lead-schema';
import {parseOffer, type ParsedOffer} from './telegram-parse';
import {normalizeChatId, packMessageIds, propertyIdFor, sourceKeyFor, unpackMessageIds} from './telegram-ids';
import {downloadTelegramPhoto, type StoredImage} from './telegram-media';

export const PUBLISHED_STATUS = 'published';

export type IncomingOffer = {
  chatId: string;
  messageIds: string[];
  mediaGroupId: string | null;
  sourceKey: string;
  text: string;
  images: StoredImage[];
  edited: boolean;
  imageNote?: string;
};

type ExistingRow = {
  id: string;
  description: string | null;
  image_meta: unknown;
  telegram_message_ids: unknown;
  telegram_media_group_id: string | null;
  telegram_source_key: string | null;
};

const locks = new Map<string, Promise<unknown>>();

function withLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const previous = locks.get(key) ?? Promise.resolve();
  const run = previous.catch(() => undefined).then(fn);
  locks.set(key, run);
  return run.finally(() => {
    if (locks.get(key) === run) locks.delete(key);
  });
}

function isDuplicate(error: unknown) {
  const code = typeof error === 'object' && error && 'code' in error ? String((error as {code: unknown}).code) : '';
  const message = error instanceof Error ? error.message : String(error);
  return code === 'ER_DUP_ENTRY' || /duplicate|UNIQUE constraint failed/i.test(message);
}

function parseMeta(value: unknown): StoredImage[] {
  let parsed: unknown = value;
  if (typeof value === 'string') {
    try {
      parsed = JSON.parse(value);
    } catch {
      return [];
    }
  }
  if (!Array.isArray(parsed)) return [];
  return parsed.flatMap(item => {
    if (!item || typeof item !== 'object') return [];
    const row = item as Record<string, unknown>;
    const imagePath = typeof row.path === 'string' ? row.path : '';
    if (!imagePath.startsWith('/media/')) return [];
    return [{
      path: imagePath,
      messageId: row.messageId == null ? '' : String(row.messageId),
      fileUniqueId: typeof row.fileUniqueId === 'string' ? row.fileUniqueId : '',
    }];
  });
}

function mergeImages(existing: StoredImage[], incoming: StoredImage[], edited: boolean) {
  const incomingMessages = new Set(incoming.map(item => item.messageId).filter(Boolean));
  const base = edited ? existing.filter(item => !incomingMessages.has(item.messageId)) : existing.slice();
  for (const item of incoming) {
    const sameFile = base.findIndex(current => item.fileUniqueId && current.fileUniqueId === item.fileUniqueId);
    if (sameFile >= 0) base[sameFile] = item;
    else if (!base.some(current => current.path === item.path)) base.push(item);
  }
  return base.slice(0, 30);
}

function chooseText(previous: string, incoming: string, edited: boolean) {
  if (edited) return incoming.trim() ? incoming : previous;
  if (!previous.trim()) return incoming;
  if (!incoming.trim()) return previous;
  return incoming.trim().length >= previous.trim().length ? incoming : previous;
}

function preferGroup(current: string | null, incoming: string | null) {
  if (current && !current.startsWith('x')) return current;
  if (incoming && !incoming.startsWith('x')) return incoming;
  return current || incoming;
}

function nullable(value: string | number | null | undefined) {
  if (value == null) return null;
  if (typeof value === 'string' && value.trim() === '') return null;
  return value;
}

export async function recordTelegramEvent(row: {
  chatId: string;
  messageId: string;
  mediaGroupId: string | null;
  propertyId: string | null;
  action: string;
  note: string | null;
}) {
  try {
    await ensureLeadSchema();
    await crmPool().execute(
      `INSERT INTO telegram_sync_log (id, chat_id, message_id, media_group_id, property_id, action, note, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        crypto.randomUUID(),
        row.chatId || null,
        row.messageId || null,
        row.mediaGroupId,
        row.propertyId,
        row.action,
        row.note ? row.note.slice(0, 500) : null,
        new Date().toISOString(),
      ]
    );
  } catch (error) {
    console.error('telegram sync log was not written', error);
  }
}

async function findExisting(connection: PoolConnection, offer: IncomingOffer): Promise<ExistingRow | null> {
  const likes = offer.messageIds.filter(id => /^\d+$/.test(id)).slice(0, 12);
  const likeSql = likes.map(() => 'telegram_message_ids LIKE ?').join(' OR ');
  const sql = `SELECT id, description, image_meta, telegram_message_ids, telegram_media_group_id, telegram_source_key
    FROM site_properties
    WHERE telegram_source_key = ?
       OR (telegram_chat_id = ? AND ? <> '' AND telegram_media_group_id = ?)
       ${likeSql ? `OR (telegram_chat_id = ? AND (${likeSql}))` : ''}
    LIMIT 1 FOR UPDATE`;
  const params: (string | null)[] = [
    offer.sourceKey,
    offer.chatId,
    offer.mediaGroupId && !offer.mediaGroupId.startsWith('x') ? offer.mediaGroupId : '',
    offer.mediaGroupId && !offer.mediaGroupId.startsWith('x') ? offer.mediaGroupId : '',
  ];
  if (likeSql) {
    params.push(offer.chatId, ...likes.map(id => `%,${id},%`));
  }
  const [rows] = await connection.execute<RowDataPacket[]>(sql, params);
  return (rows[0] as ExistingRow | undefined) ?? null;
}

function bindParsed(parsed: ParsedOffer, images: StoredImage[], extra: {
  id: string;
  chatId: string;
  messageIds: string[];
  mediaGroupId: string | null;
  sourceKey: string;
  createdAt: string;
  updatedAt: string;
}) {
  return [
    extra.id,
    parsed.title,
    nullable(parsed.price),
    nullable(parsed.area),
    nullable(parsed.beds),
    nullable(parsed.baths),
    nullable(parsed.city),
    nullable(parsed.address),
    nullable(parsed.type),
    nullable(parsed.purpose),
    nullable(parsed.streetWidth),
    nullable(parsed.facade),
    nullable(parsed.age),
    parsed.description,
    JSON.stringify(images.map(item => item.path)),
    JSON.stringify(images),
    PUBLISHED_STATUS,
    extra.chatId,
    extra.messageIds[0] ?? null,
    extra.mediaGroupId,
    packMessageIds(extra.messageIds),
    extra.sourceKey,
    extra.createdAt,
    extra.updatedAt,
  ];
}

async function publishOnce(offer: IncomingOffer, pool: Pool): Promise<{id: string; action: 'created' | 'updated'}> {
  await ensureLeadSchema();
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const existing = await findExisting(connection, offer);
    const now = new Date().toISOString();
    if (!existing) {
      const id = propertyIdFor(offer.chatId, offer.messageIds[0] || '0', offer.mediaGroupId);
      const parsed = parseOffer(offer.text);
      await connection.execute(
        `INSERT INTO site_properties (
          id, title, price, area, beds, baths, city, address, type, purpose, street_width, facade, age,
          description, images, image_meta, status, telegram_chat_id, telegram_message_id, telegram_media_group_id,
          telegram_message_ids, telegram_source_key, created_at, updated_at
        ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        bindParsed(parsed, offer.images, {
          id,
          chatId: offer.chatId,
          messageIds: offer.messageIds,
          mediaGroupId: preferGroup(null, offer.mediaGroupId),
          sourceKey: offer.sourceKey,
          createdAt: now,
          updatedAt: now,
        })
      );
      await connection.commit();
      return {id, action: 'created'};
    }
    const text = chooseText(existing.description ?? '', offer.text, offer.edited);
    const parsed = parseOffer(text);
    const images = mergeImages(parseMeta(existing.image_meta), offer.images, offer.edited);
    const messageIds = [...new Set([...unpackMessageIds(existing.telegram_message_ids), ...offer.messageIds])];
    const mediaGroupId = preferGroup(existing.telegram_media_group_id, offer.mediaGroupId);
    await connection.execute(
      `UPDATE site_properties SET
        title=?, price=?, area=?, beds=?, baths=?, city=?, address=?, type=?, purpose=?, street_width=?, facade=?, age=?,
        description=?, images=?, image_meta=?, status=?, telegram_message_id=?, telegram_media_group_id=?,
        telegram_message_ids=?, updated_at=?
       WHERE id=?`,
      [
        parsed.title,
        nullable(parsed.price),
        nullable(parsed.area),
        nullable(parsed.beds),
        nullable(parsed.baths),
        nullable(parsed.city),
        nullable(parsed.address),
        nullable(parsed.type),
        nullable(parsed.purpose),
        nullable(parsed.streetWidth),
        nullable(parsed.facade),
        nullable(parsed.age),
        parsed.description,
        JSON.stringify(images.map(item => item.path)),
        JSON.stringify(images),
        PUBLISHED_STATUS,
        messageIds[0] ?? null,
        mediaGroupId,
        packMessageIds(messageIds),
        now,
        existing.id,
      ]
    );
    await connection.commit();
    return {id: existing.id, action: 'updated'};
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

export async function publishTelegramOffer(offer: IncomingOffer) {
  if (!offer.chatId || !offer.sourceKey || !offer.messageIds.length) {
    throw new Error('معرّف رسالة تيليجرام غير مكتمل');
  }
  const pool = crmPool();
  const run = () => withLock(offer.sourceKey, async () => {
    try {
      return await publishOnce(offer, pool);
    } catch (error) {
      if (!isDuplicate(error)) throw error;
      return publishOnce(offer, pool);
    }
  });
  const saved = await run();
  await recordTelegramEvent({
    chatId: offer.chatId,
    messageId: offer.messageIds[0] || '',
    mediaGroupId: offer.mediaGroupId,
    propertyId: saved.id,
    action: saved.action,
    note: offer.imageNote || null,
  });
  return saved;
}

export async function recentTelegramSync(limit = 40) {
  await ensureLeadSchema();
  const size = Number.isInteger(limit) ? Math.min(Math.max(limit, 1), 80) : 40;
  const [rows] = await crmPool().execute<RowDataPacket[]>(
    `SELECT l.id, l.action, l.note, l.property_id, l.created_at, l.chat_id, l.message_id, l.media_group_id, p.title
     FROM telegram_sync_log l
     LEFT JOIN site_properties p ON p.id = l.property_id
     ORDER BY l.created_at DESC, l.id DESC
     LIMIT ${size}`
  );
  return rows.map(row => ({
    id: String(row.id ?? ''),
    action: String(row.action ?? ''),
    note: row.note == null ? null : String(row.note),
    propertyId: row.property_id == null ? null : String(row.property_id),
    title: row.title == null ? null : String(row.title),
    createdAt: row.created_at == null ? null : String(row.created_at),
    chatId: row.chat_id == null ? null : String(row.chat_id),
    messageId: row.message_id == null ? null : String(row.message_id),
    mediaGroupId: row.media_group_id == null ? null : String(row.media_group_id),
  }));
}

type TgPhoto = {file_id?: string; file_unique_id?: string; file_size?: number; width?: number; height?: number};
type TgMessage = {
  message_id?: number | string;
  media_group_id?: string | number;
  chat?: {id?: number | string};
  text?: unknown;
  caption?: unknown;
  photo?: TgPhoto[];
  document?: {file_id?: string; file_unique_id?: string; mime_type?: string; file_name?: string};
};

function numericId(value: unknown) {
  if (typeof value === 'string' && /^-?\d+$/.test(value.trim())) return value.trim();
  if (typeof value === 'number' && Number.isSafeInteger(value)) return String(value);
  return '';
}

function plainText(value: unknown) {
  return typeof value === 'string' ? value : '';
}

function messageOf(update: Record<string, unknown>, edited: boolean): {message: TgMessage; edited: boolean} | null {
  const key = edited ? 'edited_channel_post' : 'channel_post';
  const value = update[key];
  if (!value || typeof value !== 'object') return null;
  return {message: value as TgMessage, edited};
}

function largestPhoto(photos: TgPhoto[]) {
  return [...photos].sort((left, right) => {
    const leftSize = left.file_size ?? (left.width ?? 0) * (left.height ?? 0);
    const rightSize = right.file_size ?? (right.width ?? 0) * (right.height ?? 0);
    return rightSize - leftSize;
  })[0];
}

export async function handleTelegramUpdate(update: unknown) {
  if (!update || typeof update !== 'object') return {ok: true as const, ignored: true};
  const record = update as Record<string, unknown>;
  const wrapped = messageOf(record, false) || messageOf(record, true);
  if (!wrapped) return {ok: true as const, ignored: true};
  const {message, edited} = wrapped;
  const chatId = normalizeChatId(numericId(message.chat?.id));
  const messageId = numericId(message.message_id).replace(/^-/, '');
  if (!chatId || !messageId) return {ok: true as const, ignored: true};
  const allowed = (process.env.TELEGRAM_CHANNEL_ID || '').trim();
  if (allowed && normalizeChatId(allowed) !== chatId) return {ok: true as const, ignored: true};
  const mediaGroupId = message.media_group_id == null || message.media_group_id === '' ? null : String(message.media_group_id);
  const text = plainText(message.text).trim() ? plainText(message.text) : plainText(message.caption);
  const notes: string[] = [];
  const images: StoredImage[] = [];
  const photo = Array.isArray(message.photo) ? largestPhoto(message.photo.filter(item => item?.file_id && item.file_unique_id)) : undefined;
  const document = message.document?.mime_type?.startsWith('image/') ? message.document : undefined;
  const file = photo
    ? {fileId: photo.file_id as string, fileUniqueId: photo.file_unique_id as string, fileName: 'photo.jpg'}
    : document?.file_id && document.file_unique_id
      ? {fileId: document.file_id, fileUniqueId: document.file_unique_id, fileName: document.file_name, mime: document.mime_type}
      : null;
  if (file) {
    try {
      images.push(await downloadTelegramPhoto({...file, messageId}));
    } catch (error) {
      notes.push(error instanceof Error ? error.message : 'تعذر حفظ الصورة');
    }
  }
  if (!text.trim() && !images.length) {
    await recordTelegramEvent({
      chatId,
      messageId,
      mediaGroupId,
      propertyId: null,
      action: 'skipped',
      note: notes[0] || 'رسالة بلا نص ولا صورة',
    });
    return {ok: true as const, ignored: true};
  }
  const saved = await publishTelegramOffer({
    chatId,
    messageIds: [messageId],
    mediaGroupId,
    sourceKey: sourceKeyFor(chatId, messageId, mediaGroupId),
    text,
    images,
    edited,
    imageNote: notes[0],
  });
  return {ok: true as const, action: saved.action, propertyId: saved.id};
}
