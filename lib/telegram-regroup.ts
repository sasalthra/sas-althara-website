import type {RowDataPacket} from 'mysql2/promise';
import {crmPool} from './crm-db';
import {ensureTelegramTables} from './lead-schema';
import {unpackMessageIds} from './telegram-ids';
import {planOfferMerges, type FragmentInput, type LogInput, type MergePlan, type OfferMessage, unixTime} from './telegram-offers';
import {deletePropertySql, exactEq, redirectLookupSql} from './telegram-sql';
import {publishTelegramOffer} from './telegram-sync';

export type RegroupPreview = {
  targetId: string;
  title: string;
  chatId: string;
  messageCount: number;
  photoCount: number;
  fragments: {id: string; title: string}[];
};

function imageList(value: unknown): {messageId: string; fileUniqueId: string; path: string}[] {
  let parsed: unknown = value;
  if (typeof value === 'string') {
    try {
      parsed = JSON.parse(value);
    } catch {
      parsed = null;
    }
  }
  if (!Array.isArray(parsed)) return [];
  return parsed.flatMap(item => {
    if (!item || typeof item !== 'object') return [];
    const row = item as Record<string, unknown>;
    const path = typeof row.path === 'string' ? row.path : '';
    if (!path.startsWith('/media/')) return [];
    return [{
      path,
      messageId: row.messageId == null ? '' : String(row.messageId),
      fileUniqueId: typeof row.fileUniqueId === 'string' ? row.fileUniqueId : '',
    }];
  });
}

function previewOf(plan: MergePlan): RegroupPreview {
  return {
    targetId: plan.targetId,
    title: plan.title,
    chatId: plan.chatId,
    messageCount: plan.messageCount,
    photoCount: plan.photoCount,
    fragments: plan.fragments,
  };
}

async function loadInputs(): Promise<{messages: OfferMessage[]; fragments: FragmentInput[]; logs: LogInput[]}> {
  const pool = crmPool();
  const [properties] = await pool.execute<RowDataPacket[]>(
    `SELECT id, title, description, image_meta, telegram_chat_id, telegram_message_id, telegram_message_ids, telegram_media_group_id, created_at
     FROM site_properties
     WHERE telegram_chat_id IS NOT NULL`
  );
  const [logs] = await pool.execute<RowDataPacket[]>(
    `SELECT chat_id, message_id, property_id, action, note, created_at FROM telegram_sync_log`
  );
  const [messages] = await pool.execute<RowDataPacket[]>(
    `SELECT chat_id, message_id, message_date, media_group_id, kind, body, file_id, file_unique_id FROM telegram_messages`
  );
  const fragments: FragmentInput[] = properties.flatMap(row => {
    const chatId = row.telegram_chat_id == null ? '' : String(row.telegram_chat_id).trim();
    const id = String(row.id ?? '');
    if (!chatId || !id) return [];
    const messageIds = [...new Set([
      ...unpackMessageIds(row.telegram_message_ids),
      ...(row.telegram_message_id == null ? [] : [String(row.telegram_message_id)].filter(item => /^\d+$/.test(item))),
    ])];
    return [{
      id,
      chatId,
      messageIds,
      mediaGroupId: row.telegram_media_group_id == null || String(row.telegram_media_group_id) === '' ? null : String(row.telegram_media_group_id),
      title: row.title == null ? '' : String(row.title),
      description: row.description == null ? '' : String(row.description),
      images: imageList(row.image_meta),
      createdAt: unixTime(row.created_at == null ? null : String(row.created_at)),
    }];
  });
  const logRows: LogInput[] = logs.flatMap(row => {
    const chatId = row.chat_id == null ? '' : String(row.chat_id).trim();
    if (!chatId) return [];
    return [{
      chatId,
      messageId: row.message_id == null ? '' : String(row.message_id),
      createdAt: unixTime(row.created_at == null ? null : String(row.created_at)),
      note: row.note == null ? null : String(row.note),
      action: row.action == null ? '' : String(row.action),
      propertyId: row.property_id == null ? null : String(row.property_id),
    }];
  });
  const stored: OfferMessage[] = messages.flatMap(row => {
    const kind = String(row.kind ?? '');
    if (kind !== 'text' && kind !== 'photo' && kind !== 'sticker' && kind !== 'other') return [];
    const messageKind = kind as OfferMessage['kind'];
    const chatId = row.chat_id == null ? '' : String(row.chat_id);
    const messageId = row.message_id == null ? '' : String(row.message_id);
    if (!chatId || !messageId) return [];
    const fileUniqueId = row.file_unique_id == null ? '' : String(row.file_unique_id);
    const date = unixTime(row.message_date == null ? null : String(row.message_date));
    return [{
      chatId,
      messageId,
      date,
      mediaGroupId: row.media_group_id == null || String(row.media_group_id) === '' ? null : String(row.media_group_id),
      kind: messageKind,
      text: row.body == null ? '' : String(row.body),
      files: fileUniqueId ? [{fileId: row.file_id == null ? '' : String(row.file_id), fileUniqueId}] : [],
    }];
  });
  return {messages: stored, fragments, logs: logRows};
}

async function redirectFragment(fromId: string, targetId: string) {
  if (!fromId || fromId === targetId) return;
  const pool = crmPool();
  const now = new Date().toISOString();
  const [found] = await pool.execute<RowDataPacket[]>(redirectLookupSql(), [fromId]);
  if (found[0]) {
    await pool.execute(
      `UPDATE telegram_redirects SET target_id = ? WHERE ${exactEq('id', '?')}`,
      [targetId, fromId]
    );
  } else {
    try {
      await pool.execute(
        `INSERT INTO telegram_redirects (id, target_id, created_at) VALUES (?, ?, ?)`,
        [fromId, targetId, now]
      );
    } catch (error) {
      const code = typeof error === 'object' && error && 'code' in error ? String((error as {code: unknown}).code) : '';
      if (code !== 'ER_DUP_ENTRY') throw error;
      await pool.execute(
        `UPDATE telegram_redirects SET target_id = ? WHERE ${exactEq('id', '?')}`,
        [targetId, fromId]
      );
    }
  }
  await pool.execute(deletePropertySql(), [fromId]);
}

export async function regroupTelegramOffers(apply: boolean): Promise<{plans: RegroupPreview[]; applied: number}> {
  await ensureTelegramTables();
  const plans = planOfferMerges(await loadInputs());
  const preview = plans.map(previewOf);
  if (!apply) return {plans: preview, applied: 0};
  let applied = 0;
  for (const plan of plans) {
    const saved = await publishTelegramOffer({
      chatId: plan.chatId,
      messageIds: plan.messageIds,
      mediaGroupId: plan.mediaGroupId,
      sourceKey: plan.sourceKey,
      propertyId: plan.targetId,
      text: plan.text,
      images: plan.images,
      edited: false,
      replaceImages: true,
      keepFileIds: plan.images.map(image => image.fileUniqueId).filter(Boolean),
    });
    for (const fragment of plan.fragments) {
      if (fragment.id === saved.id) continue;
      await redirectFragment(fragment.id, saved.id);
    }
    applied += 1;
  }
  return {plans: preview, applied};
}
