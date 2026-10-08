import type {Pool, PoolConnection, RowDataPacket} from 'mysql2/promise';
import {crmPool} from './crm-db';
import {ensureLeadSchema, ensureTelegramTables} from './lead-schema';
import {parseOffer, type ParsedOffer} from './telegram-parse';
import {messageRowId, offerPropertyId, offerSourceKey, packMessageIds, propertyIdFor, sourceKeyHash, unpackMessageIds} from './telegram-ids';
import {downloadTelegramPhoto, type StoredImage} from './telegram-media';
import {brandingFileIds, galleryPhotos, groupChatOffers, SEPARATOR_NOTE, type OfferMessage} from './telegram-offers';
import {messageLookupSql, messagesByChatSql, propertyByOfferSql, propertyIdWhere, propertyLookupSql, recentSyncSql, seenChatLookupSql, seenChatsSql, seenChatUpdateSql} from './telegram-sql';
import {chatAllowed, parseTelegramUpdate, type ParsedTelegramUpdate} from './telegram-updates';

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
  /** Canonical offer id. When set, a fragment row that merely shares a message id is not reused. */
  propertyId?: string;
  /** The gallery is already the full offer, in message order, with branding removed. */
  replaceImages?: boolean;
  /** file_unique_id order for replaceImages. A failed download keeps the previous file with the same id. */
  keepFileIds?: string[];
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

function replaceGallery(previous: StoredImage[], incoming: StoredImage[], keepIds: string[] | undefined) {
  const order = keepIds?.length ? keepIds : incoming.map(item => item.fileUniqueId).filter(Boolean);
  const byId = new Map<string, StoredImage>();
  for (const item of previous) {
    if (item.fileUniqueId && order.includes(item.fileUniqueId)) byId.set(item.fileUniqueId, item);
  }
  for (const item of incoming) {
    if (item.fileUniqueId) byId.set(item.fileUniqueId, item);
  }
  const gallery: StoredImage[] = [];
  for (const id of order) {
    const item = byId.get(id);
    if (!item || gallery.some(current => current.path === item.path)) continue;
    gallery.push(item);
  }
  for (const item of incoming) {
    if (!item.path.startsWith('/media/')) continue;
    if (gallery.some(current => current.path === item.path)) continue;
    gallery.push(item);
  }
  return gallery.slice(0, 30);
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
  if (offer.propertyId) {
    const [rows] = await connection.execute<RowDataPacket[]>(propertyByOfferSql(), [sourceKeyHash(offer.sourceKey), offer.propertyId]);
    return (rows[0] as ExistingRow | undefined) ?? null;
  }
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
    parsed.priceFrom ? 1 : 0,
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
      const id = offer.propertyId || propertyIdFor(offer.chatId, offer.messageIds[0] || '0', offer.mediaGroupId);
      const parsed = parseOffer(offer.text);
      await connection.execute(
        `INSERT INTO site_properties (
          id, title, price, price_from, area, beds, baths, city, address, type, purpose, street_width, facade, age,
          description, images, image_meta, status, telegram_chat_id, telegram_message_id, telegram_media_group_id,
          telegram_message_ids, telegram_source_key, telegram_source_hash, created_at, updated_at
        ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
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
    const text = offer.replaceImages
      ? (offer.text.trim() ? offer.text : (existing.description ?? ''))
      : chooseText(existing.description ?? '', offer.text, offer.edited);
    const parsed = parseOffer(text);
    const images = offer.replaceImages
      ? replaceGallery(parseMeta(existing.image_meta), offer.images, offer.keepFileIds)
      : mergeImages(parseMeta(existing.image_meta), offer.images, offer.edited);
    const messageIds = [...new Set(offer.replaceImages ? offer.messageIds : [...unpackMessageIds(existing.telegram_message_ids), ...offer.messageIds])];
    messageIds.sort((left, right) => Number(left) - Number(right));
    const mediaGroupId = preferGroup(existing.telegram_media_group_id, offer.mediaGroupId);
    const sourceKey = offer.propertyId
      ? offer.sourceKey
      : offer.mediaGroupId && !offer.mediaGroupId.startsWith('x')
        ? offer.sourceKey
        : (existing.telegram_source_key || offer.sourceKey);
    await connection.execute(
      `UPDATE site_properties SET
        title=?, price=?, price_from=?, area=?, beds=?, baths=?, city=?, address=?, type=?, purpose=?, street_width=?, facade=?, age=?,
        description=?, images=?, image_meta=?, status=?, telegram_message_id=?, telegram_media_group_id=?,
        telegram_message_ids=?, telegram_source_key=?, telegram_source_hash=?, updated_at=?
       WHERE ${propertyIdWhere()}`,
      [
        parsed.title,
        nullable(parsed.price),
        parsed.priceFrom ? 1 : 0,
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
  const countNote = `مدمج: ${offer.messageIds.length} رسائل، ${offer.images.length} صور`;
  await recordTelegramEvent({
    chatId: offer.chatId,
    messageId: offer.messageIds[0] || '',
    mediaGroupId: offer.mediaGroupId,
    propertyId: saved.id,
    action: saved.action,
    note: offer.imageNote ? `${countNote} — ${offer.imageNote}` : countNote,
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

function asOfferMessage(parsed: ParsedTelegramUpdate): OfferMessage {
  return {
    chatId: parsed.chatId,
    messageId: parsed.messageId,
    date: parsed.date,
    mediaGroupId: parsed.mediaGroupId,
    kind: parsed.kind,
    text: parsed.text,
    files: parsed.files,
    edited: parsed.edited,
  };
}

export async function upsertTelegramMessage(message: OfferMessage, raw: unknown) {
  await ensureTelegramTables();
  const file = message.files.find(item => item.fileUniqueId) || message.files[0];
  const rawBody = JSON.stringify(raw ?? null).slice(0, 500_000);
  const now = new Date().toISOString();
  const incomingDate = message.date == null ? null : String(message.date);
  const pool = crmPool();
  const [found] = await pool.execute<RowDataPacket[]>(messageLookupSql(), [message.chatId, message.messageId]);
  const current = found[0] as {id?: unknown; message_date?: unknown} | undefined;
  const rowId = current?.id == null || String(current.id).trim() === '' ? messageRowId(message.chatId, message.messageId) : String(current.id);
  const keptDate = current?.message_date == null || String(current.message_date).trim() === '' ? incomingDate : String(current.message_date);
  const params = [
    message.mediaGroupId,
    message.kind,
    message.text.slice(0, 20000),
    file?.fileId?.slice(0, 191) || null,
    file?.fileUniqueId?.slice(0, 128) || null,
    rawBody,
    keptDate,
  ];
  if (current) {
    await pool.execute(
      `UPDATE telegram_messages
         SET media_group_id=?, kind=?, body=?, file_id=?, file_unique_id=?, raw_body=?, message_date=?
       WHERE ${propertyIdWhere()}`,
      [...params, rowId]
    );
    return;
  }
  try {
    await pool.execute(
      `INSERT INTO telegram_messages (
         id, chat_id, message_id, message_date, media_group_id, kind, body, file_id, file_unique_id, raw_body, created_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        messageRowId(message.chatId, message.messageId),
        message.chatId,
        message.messageId,
        keptDate,
        message.mediaGroupId,
        message.kind,
        message.text.slice(0, 20000),
        file?.fileId?.slice(0, 191) || null,
        file?.fileUniqueId?.slice(0, 128) || null,
        rawBody,
        now,
      ]
    );
  } catch (error) {
    if (!isDuplicate(error)) throw error;
    await pool.execute(
      `UPDATE telegram_messages
         SET media_group_id=?, kind=?, body=?, file_id=?, file_unique_id=?, raw_body=?, message_date=?
       WHERE ${propertyIdWhere()}`,
      [...params, rowId]
    );
  }
}

export async function loadChatMessages(chatId: string): Promise<OfferMessage[]> {
  await ensureTelegramTables();
  const [rows] = await crmPool().execute<RowDataPacket[]>(messagesByChatSql(), [chatId]);
  return rows.flatMap(row => {
    const kind = String(row.kind ?? '');
    if (kind !== 'text' && kind !== 'photo' && kind !== 'sticker' && kind !== 'other') return [];
    const messageKind = kind as OfferMessage['kind'];
    const fileUniqueId = row.file_unique_id == null ? '' : String(row.file_unique_id);
    const fileId = row.file_id == null ? '' : String(row.file_id);
    const date = row.message_date == null || String(row.message_date).trim() === '' ? null : Number(row.message_date);
    return [{
      chatId: String(row.chat_id ?? chatId),
      messageId: String(row.message_id ?? ''),
      date: date != null && Number.isFinite(date) ? date : null,
      mediaGroupId: row.media_group_id == null || String(row.media_group_id) === '' ? null : String(row.media_group_id),
      kind: messageKind,
      text: row.body == null ? '' : String(row.body),
      files: fileUniqueId ? [{fileId, fileUniqueId}] : [],
    }];
  }).filter(message => message.messageId);
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
  const stored = asOfferMessage(parsed);
  if (parsed.accepted) await upsertTelegramMessage(stored, update);
  if (!parsed.accepted || parsed.service || !chatAllowed(parsed.chatId)) return {ok: true as const, ignored: true};
  if (stored.kind === 'sticker') {
    await recordTelegramEvent({
      chatId: parsed.chatId,
      messageId: parsed.messageId,
      mediaGroupId: parsed.mediaGroupId,
      propertyId: null,
      action: 'separator',
      note: SEPARATOR_NOTE,
    });
    return {ok: true as const, ignored: true, separator: true};
  }
  if (stored.kind === 'other') return {ok: true as const, ignored: true};
  const messages = await loadChatMessages(parsed.chatId);
  const offers = groupChatOffers(messages);
  const offer = offers.find(item => item.messageIds.includes(parsed.messageId));
  if (!offer) return {ok: true as const, ignored: true};
  const branding = brandingFileIds(offers.map(item => ({
    key: item.firstMessageId,
    fileUniqueIds: item.photos.map(photo => photo.file.fileUniqueId),
  })));
  const photos = galleryPhotos(offer.photos.map(photo => ({...photo, fileUniqueId: photo.file.fileUniqueId})), branding);
  const notes: string[] = [];
  const images: StoredImage[] = [];
  for (const photo of photos) {
    try {
      images.push(await downloadTelegramPhoto({
        fileId: photo.file.fileId,
        fileUniqueId: photo.file.fileUniqueId,
        fileName: photo.file.fileName,
        mime: photo.file.mime,
        messageId: photo.messageId,
      }));
    } catch (error) {
      notes.push(error instanceof Error ? error.message : 'تعذر حفظ الصورة');
    }
  }
  if (!offer.text.trim() && !images.length) return {ok: true as const, ignored: true};
  const saved = await publishTelegramOffer({
    chatId: offer.chatId,
    messageIds: offer.messageIds,
    mediaGroupId: offer.mediaGroupId,
    sourceKey: offerSourceKey(offer.chatId, offer.firstMessageId),
    propertyId: offerPropertyId(offer.chatId, offer.firstMessageId),
    text: offer.text,
    images,
    edited: parsed.edited,
    imageNote: notes[0],
    replaceImages: true,
    keepFileIds: photos.map(photo => photo.file.fileUniqueId).filter(Boolean),
  });
  return {ok: true as const, action: saved.action, propertyId: saved.id};
}
