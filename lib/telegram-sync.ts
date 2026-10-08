import type {Pool, PoolConnection, RowDataPacket} from 'mysql2/promise';
import {crmPool} from './crm-db';
import {ensureLeadSchema, ensureTelegramTables} from './lead-schema';
import {parseOffer, type ParsedOffer} from './telegram-parse';
import {packMessageIds, propertyIdFor, sourceKeyFor, sourceKeyHash, unpackMessageIds} from './telegram-ids';
import {downloadTelegramPhoto, type StoredImage} from './telegram-media';
import {propertyIdWhere, propertyLookupSql, recentSyncSql, seenChatLookupSql, seenChatsSql, seenChatUpdateSql} from './telegram-sql';
import {chatAllowed, collapseAlbum, parseTelegramUpdate} from './telegram-updates';

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
    await ensureTelegramTables();
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
  const groupId = offer.mediaGroupId && !offer.mediaGroupId.startsWith('x') ? offer.mediaGroupId : '';
  const params: (string | null)[] = [
    sourceKeyHash(offer.sourceKey),
    offer.sourceKey,
    offer.chatId,
    groupId,
    groupId,
  ];
  if (likes.length) params.push(offer.chatId, ...likes.map(id => `%,${id},%`));
  const [rows] = await connection.execute<RowDataPacket[]>(propertyLookupSql(likes.length), params);
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
    sourceKeyHash(extra.sourceKey),
    extra.createdAt,
    extra.updatedAt,
  ];
}

async function publishOnce(offer: IncomingOffer, pool: Pool): Promise<{id: string; action: 'created' | 'updated'}> {
  await ensureLeadSchema();
  await ensureTelegramTables();
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
          telegram_message_ids, telegram_source_key, telegram_source_hash, created_at, updated_at
        ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
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
    const sourceKey = offer.mediaGroupId && !offer.mediaGroupId.startsWith('x')
      ? offer.sourceKey
      : (existing.telegram_source_key || offer.sourceKey);
    await connection.execute(
      `UPDATE site_properties SET
        title=?, price=?, area=?, beds=?, baths=?, city=?, address=?, type=?, purpose=?, street_width=?, facade=?, age=?,
        description=?, images=?, image_meta=?, status=?, telegram_message_id=?, telegram_media_group_id=?,
        telegram_message_ids=?, telegram_source_key=?, telegram_source_hash=?, updated_at=?
       WHERE ${propertyIdWhere()}`,
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
        sourceKey,
        sourceKeyHash(sourceKey),
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

export type SeenTelegramChat = {
  chatId: string;
  title: string | null;
  chatType: string | null;
  lastMessageId: string | null;
  lastSeenAt: string | null;
};

export async function rememberTelegramChat(chat: {chatId: string; title: string; chatType: string; messageId: string}) {
  if (!chat.chatId) return;
  try {
    await ensureTelegramTables();
    const now = new Date().toISOString();
    const incomingTitle = chat.title.trim().slice(0, 255);
    const incomingType = chat.chatType.trim().slice(0, 32);
    const [found] = await crmPool().execute<RowDataPacket[]>(seenChatLookupSql(), [chat.chatId]);
    const current = found[0] as {title?: unknown; chat_type?: unknown} | undefined;
    if (!current) {
      await crmPool().execute(
        `INSERT INTO telegram_seen_chats (chat_id, title, chat_type, last_message_id, last_seen_at)
         VALUES (?, ?, ?, ?, ?)`,
        [chat.chatId, incomingTitle || null, incomingType || null, chat.messageId || null, now]
      );
      return;
    }
    const title = incomingTitle || (current.title == null ? null : String(current.title));
    const chatType = incomingType || (current.chat_type == null ? null : String(current.chat_type));
    await crmPool().execute(seenChatUpdateSql(), [title, chatType, chat.messageId || null, now, chat.chatId]);
  } catch (error) {
    if (!isDuplicate(error)) {
      console.error('telegram chat was not recorded', error);
      return;
    }
    try {
      const now = new Date().toISOString();
      await crmPool().execute(seenChatUpdateSql(), [
        chat.title.trim().slice(0, 255) || null,
        chat.chatType.trim().slice(0, 32) || null,
        chat.messageId || null,
        now,
        chat.chatId,
      ]);
    } catch (updateError) {
      console.error('telegram chat was not recorded', updateError);
    }
  }
}

export async function listTelegramChats(limit = 20): Promise<SeenTelegramChat[]> {
  await ensureLeadSchema();
  await ensureTelegramTables();
  const [rows] = await crmPool().execute<RowDataPacket[]>(seenChatsSql(limit));
  return rows.map(row => ({
    chatId: String(row.chat_id ?? ''),
    title: row.title == null || String(row.title).trim() === '' ? null : String(row.title),
    chatType: row.chat_type == null || String(row.chat_type).trim() === '' ? null : String(row.chat_type),
    lastMessageId: row.last_message_id == null ? null : String(row.last_message_id),
    lastSeenAt: row.last_seen_at == null ? null : String(row.last_seen_at),
  })).filter(row => row.chatId);
}

export async function recentTelegramSync(limit = 40) {
  await ensureLeadSchema();
  await ensureTelegramTables();
  const [rows] = await crmPool().execute<RowDataPacket[]>(recentSyncSql(limit));
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

export async function handleTelegramUpdate(update: unknown) {
  const parsed = parseTelegramUpdate(update);
  if (!parsed) return {ok: true as const, ignored: true};
  await rememberTelegramChat({
    chatId: parsed.chatId,
    title: parsed.chatTitle,
    chatType: parsed.chatType,
    messageId: parsed.messageId,
  });
  if (!parsed.accepted || parsed.service) return {ok: true as const, ignored: true};
  if (!chatAllowed(parsed.chatId)) return {ok: true as const, ignored: true};
  const album = collapseAlbum([parsed]);
  const chatId = album.chatId;
  const messageId = album.messageIds[0] || '';
  const mediaGroupId = album.mediaGroupId;
  const text = album.text;
  const notes: string[] = [];
  const images: StoredImage[] = [];
  for (const file of album.photos) {
    try {
      images.push(await downloadTelegramPhoto({...file, messageId: parsed.messageId}));
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
    messageIds: album.messageIds,
    mediaGroupId,
    sourceKey: sourceKeyFor(chatId, messageId, mediaGroupId),
    text,
    images,
    edited: album.edited,
    imageNote: notes[0],
  });
  return {ok: true as const, action: saved.action, propertyId: saved.id};
}
