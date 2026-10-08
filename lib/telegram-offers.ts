import {offerPropertyId, offerSourceKey} from './telegram-ids';
import {foldArabic, parseOffer} from './telegram-parse';

/** A sticker closes the open offer. Without one, a details post after this gap starts another. */
export const OFFER_GAP_SECONDS = 45 * 60;

/** Legacy rows have no raw messages. A wider hole than this is not one burst. */
export const LEGACY_ID_GAP = 40;

export const BRANDING_OFFER_THRESHOLD = 3;

export const SEPARATOR_NOTE = 'فاصل بين العروض';
export const EMPTY_NOTE = 'رسالة بلا نص ولا صورة';

export type OfferFile = {
  fileId: string;
  fileUniqueId: string;
  fileName?: string;
  mime?: string;
};

export type OfferMessage = {
  chatId: string;
  messageId: string;
  date: number | null;
  mediaGroupId: string | null;
  kind: 'text' | 'photo' | 'sticker' | 'other';
  text: string;
  files: OfferFile[];
  edited?: boolean;
};

export type GroupedOffer = {
  chatId: string;
  firstMessageId: string;
  messageIds: string[];
  mediaGroupId: string | null;
  text: string;
  photos: {messageId: string; file: OfferFile}[];
  closed: boolean;
  lastDate: number | null;
};

export type FragmentInput = {
  id: string;
  chatId: string;
  messageIds: string[];
  mediaGroupId: string | null;
  title: string;
  description: string;
  images: {messageId: string; fileUniqueId: string; path: string}[];
  createdAt: number | null;
};

export type LogInput = {
  chatId: string;
  messageId: string;
  createdAt: number | null;
  note: string | null;
  action: string;
  propertyId: string | null;
};

export type MergePlan = {
  chatId: string;
  targetId: string;
  sourceKey: string;
  title: string;
  messageIds: string[];
  mediaGroupId: string | null;
  text: string;
  images: {messageId: string; fileUniqueId: string; path: string}[];
  messageCount: number;
  photoCount: number;
  fragments: {id: string; title: string}[];
};

/** مشروع / الموقع / السعر — a new details post, not a photo with no caption. */
export function isDetailsText(text: string): boolean {
  const folded = foldArabic(text);
  return /مشروع/.test(folded) || /الموقع/.test(folded) || /سعر/.test(folded);
}

export function textScore(text: string): number {
  const folded = foldArabic(text);
  const trimmed = folded.trim();
  if (!trimmed) return 0;
  let score = trimmed.length;
  if (/مشروع/.test(folded)) score += 800;
  if (/الموقع/.test(folded)) score += 250;
  if (/سعر/.test(folded)) score += 250;
  if (/عدد\s*الغرف|دورات\s*(?:ال)?مياه|مساحه/.test(folded)) score += 400;
  return score;
}

export function unixTime(value: string | number | null | undefined): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value > 10_000_000_000 ? Math.trunc(value / 1000) : Math.trunc(value);
  }
  if (typeof value !== 'string' || !value.trim()) return null;
  const trimmed = value.trim();
  if (/^\d+$/.test(trimmed)) {
    const numeric = Number(trimmed);
    return numeric > 10_000_000_000 ? Math.trunc(numeric / 1000) : numeric;
  }
  const parsed = Date.parse(trimmed);
  return Number.isFinite(parsed) ? Math.trunc(parsed / 1000) : null;
}

function numericId(id: string): number {
  const value = Number(id);
  return Number.isFinite(value) ? value : 0;
}

function chooseText(current: string, incoming: string): string {
  return textScore(incoming) > textScore(current) ? incoming : current;
}

/**
 * Messages between stickers are one offer. Text may arrive before or after photos.
 * An edit of a message id replaces that message and stays in the same offer.
 * With no sticker, a details text more than 45 minutes after the previous message opens a new offer.
 */
export function groupChatOffers(input: OfferMessage[]): GroupedOffer[] {
  const byId = new Map<string, OfferMessage>();
  for (const message of input) {
    if (!message?.chatId || !message.messageId) continue;
    const key = `${message.chatId}\n${message.messageId}`;
    const previous = byId.get(key);
    if (!previous) {
      byId.set(key, message);
      continue;
    }
    const date = previous.date != null && message.date != null
      ? Math.min(previous.date, message.date)
      : (previous.date ?? message.date);
    const chosen = message.edited || !previous.edited ? message : previous;
    byId.set(key, {
      ...chosen,
      date,
      edited: Boolean(previous.edited || message.edited),
      mediaGroupId: chosen.mediaGroupId || previous.mediaGroupId,
      text: chosen.text || previous.text,
      files: chosen.files.length ? chosen.files : previous.files,
    });
  }
  const messages = [...byId.values()].sort((left, right) => numericId(left.messageId) - numericId(right.messageId));
  const offers: GroupedOffer[] = [];
  let open: GroupedOffer | null = null;

  const addPhotos = (offer: GroupedOffer, message: OfferMessage) => {
    for (const file of message.files) {
      if (!file?.fileUniqueId) continue;
      const sameMessage = offer.photos.findIndex(photo => photo.messageId === message.messageId && photo.file.fileUniqueId === file.fileUniqueId);
      if (sameMessage >= 0) {
        offer.photos[sameMessage] = {messageId: message.messageId, file};
        continue;
      }
      if (offer.photos.some(photo => photo.file.fileUniqueId === file.fileUniqueId)) continue;
      offer.photos.push({messageId: message.messageId, file});
    }
  };

  for (const message of messages) {
    if (message.kind === 'sticker') {
      if (open) open.closed = true;
      open = null;
      continue;
    }
    if (message.kind === 'other') continue;
    const hasText = Boolean(message.text.trim());
    const hasPhoto = message.kind === 'photo' && message.files.some(file => file.fileUniqueId);
    if (!hasText && !hasPhoto) continue;

    if (open && open.lastDate != null && message.date != null && message.date - open.lastDate > OFFER_GAP_SECONDS && isDetailsText(message.text)) {
      open.closed = true;
      open = null;
    }

    if (!open) {
      open = {
        chatId: message.chatId,
        firstMessageId: message.messageId,
        messageIds: [message.messageId],
        mediaGroupId: message.mediaGroupId,
        text: message.text,
        photos: [],
        closed: false,
        lastDate: message.date,
      };
      if (hasPhoto) addPhotos(open, message);
      offers.push(open);
      continue;
    }

    if (!open.messageIds.includes(message.messageId)) open.messageIds.push(message.messageId);
    if (!open.mediaGroupId && message.mediaGroupId) open.mediaGroupId = message.mediaGroupId;
    open.text = chooseText(open.text, message.text);
    if (hasPhoto) addPhotos(open, message);
    if (message.date != null && (open.lastDate == null || message.date > open.lastDate)) open.lastDate = message.date;
  }
  return offers;
}

/** A file_unique_id seen in this many different offers is the repeated brand card. */
export function brandingFileIds(offers: {key: string; fileUniqueIds: string[]}[], threshold = BRANDING_OFFER_THRESHOLD): Set<string> {
  const seen = new Map<string, Set<string>>();
  for (const offer of offers) {
    for (const id of new Set(offer.fileUniqueIds.filter(Boolean))) {
      const keys = seen.get(id) ?? new Set<string>();
      keys.add(offer.key);
      seen.set(id, keys);
    }
  }
  const branding = new Set<string>();
  for (const [id, keys] of seen) {
    if (keys.size >= threshold) branding.add(id);
  }
  return branding;
}

export function galleryPhotos<T extends {fileUniqueId: string}>(photos: T[], branding: Set<string>): T[] {
  return photos.filter(photo => !photo.fileUniqueId || !branding.has(photo.fileUniqueId));
}

export function isSeparatorNote(note: string | null, action: string): boolean {
  if (action === 'separator') return true;
  const text = note || '';
  return text.includes(SEPARATOR_NOTE) || text.includes(EMPTY_NOTE);
}

function bestText(parts: string[]): string {
  return parts.reduce((best, part) => chooseText(best, part), '');
}

function dedupeImages(images: {messageId: string; fileUniqueId: string; path: string}[], branding: Set<string>) {
  const ordered = [...images].sort((left, right) => numericId(left.messageId) - numericId(right.messageId));
  const kept: {messageId: string; fileUniqueId: string; path: string}[] = [];
  for (const image of ordered) {
    if (!image.path.startsWith('/media/')) continue;
    if (image.fileUniqueId && branding.has(image.fileUniqueId)) continue;
    if (kept.some(item => item.path === image.path || (item.fileUniqueId && item.fileUniqueId === image.fileUniqueId))) continue;
    kept.push(image);
  }
  return kept.slice(0, 30);
}

function planOf(
  chatId: string,
  firstMessageId: string,
  messageIds: string[],
  mediaGroupId: string | null,
  text: string,
  images: {messageId: string; fileUniqueId: string; path: string}[],
  fragments: {id: string; title: string}[],
): MergePlan | null {
  const uniqueFragments = [...new Map(fragments.map(item => [item.id, item])).values()];
  if (uniqueFragments.length < 2) return null;
  const parsed = parseOffer(text);
  return {
    chatId,
    targetId: offerPropertyId(chatId, firstMessageId),
    sourceKey: offerSourceKey(chatId, firstMessageId),
    title: parsed.title,
    messageIds: [...new Set(messageIds)].sort((left, right) => numericId(left) - numericId(right)),
    mediaGroupId,
    text,
    images,
    messageCount: new Set(messageIds).size,
    photoCount: images.length,
    fragments: uniqueFragments,
  };
}

function plansFromMessages(chatId: string, messages: OfferMessage[], fragments: FragmentInput[]): {plans: MergePlan[]; used: Set<string>} {
  const used = new Set<string>();
  if (!messages.length) return {plans: [], used};
  const offers = groupChatOffers(messages);
  const matchedFor = (offer: GroupedOffer) => {
    const ids = new Set(offer.messageIds);
    return fragments.filter(fragment => fragment.id === offerPropertyId(chatId, offer.firstMessageId) || fragment.messageIds.some(id => ids.has(id)));
  };
  const branding = brandingFileIds(offers.map(offer => ({
    key: offer.firstMessageId,
    fileUniqueIds: [
      ...offer.photos.map(photo => photo.file.fileUniqueId),
      ...matchedFor(offer).flatMap(fragment => fragment.images.map(image => image.fileUniqueId)),
    ],
  })));
  const plans: MergePlan[] = [];
  for (const offer of offers) {
    const matched = matchedFor(offer);
    for (const fragment of matched) used.add(fragment.id);
    const text = bestText([offer.text, ...matched.map(fragment => fragment.description)]);
    const fromFragments = matched.flatMap(fragment => fragment.images);
    const fromMessages = offer.photos.map(photo => {
      const stored = fromFragments.find(image => image.fileUniqueId === photo.file.fileUniqueId || image.messageId === photo.messageId);
      return stored || {messageId: photo.messageId, fileUniqueId: photo.file.fileUniqueId, path: ''};
    });
    const images = dedupeImages(fromMessages.length ? fromMessages : fromFragments, branding);
    const mediaGroupId = offer.mediaGroupId || matched.find(fragment => fragment.mediaGroupId && !fragment.mediaGroupId.startsWith('x'))?.mediaGroupId || null;
    const plan = planOf(
      chatId,
      offer.firstMessageId,
      offer.messageIds,
      mediaGroupId,
      text,
      images,
      matched.map(fragment => ({id: fragment.id, title: fragment.title})),
    );
    if (plan) plans.push(plan);
  }
  return {plans, used};
}

type Atom = {
  messageId: string;
  at: number | null;
  sticker: boolean;
  fragment: FragmentInput | null;
  text: string;
};

function clusterLegacy(atoms: Atom[]): Atom[][] {
  const sorted = [...atoms].sort((left, right) => numericId(left.messageId) - numericId(right.messageId) || Number(left.sticker) - Number(right.sticker));
  const bursts: Atom[][] = [];
  let current: Atom[] = [];
  let previous: Atom | null = null;
  for (const atom of sorted) {
    if (atom.sticker) {
      if (current.length) bursts.push(current);
      current = [];
      previous = null;
      continue;
    }
    if (previous) {
      const idGap = numericId(atom.messageId) - numericId(previous.messageId);
      const timeGap = previous.at != null && atom.at != null ? atom.at - previous.at : 0;
      const far = idGap > LEGACY_ID_GAP;
      const late = timeGap > OFFER_GAP_SECONDS;
      if ((far || late) && current.length) {
        bursts.push(current);
        current = [];
      }
    }
    current.push(atom);
    previous = atom;
  }
  if (current.length) bursts.push(current);
  return bursts;
}

function legacyPlans(chatId: string, fragments: FragmentInput[], logs: LogInput[]): MergePlan[] {
  if (!fragments.length) return [];
  const atoms: Atom[] = [];
  for (const fragment of fragments) {
    const ids = fragment.messageIds.length ? fragment.messageIds : [];
    const stamp = fragment.createdAt;
    for (const id of ids) {
      atoms.push({messageId: id, at: stamp, sticker: false, fragment, text: fragment.description || ''});
    }
  }
  for (const log of logs) {
    if (!log.messageId || !isSeparatorNote(log.note, log.action)) continue;
    atoms.push({messageId: log.messageId, at: log.createdAt, sticker: true, fragment: null, text: ''});
  }
  const bursts = clusterLegacy(atoms);
  const groups = bursts.map(burst => {
    const matched = [...new Map(burst.flatMap(atom => atom.fragment ? [[atom.fragment.id, atom.fragment] as const] : [])).values()];
    const messageIds = [...new Set(burst.map(atom => atom.messageId))];
    return {matched, messageIds, text: bestText(matched.map(fragment => fragment.description))};
  });
  const branding = brandingFileIds(groups.map((group, index) => ({
    key: group.messageIds[0] || String(index),
    fileUniqueIds: group.matched.flatMap(fragment => fragment.images.map(image => image.fileUniqueId)),
  })));
  const plans: MergePlan[] = [];
  for (const group of groups) {
    if (!group.messageIds.length) continue;
    const mediaGroupId = group.matched.find(fragment => fragment.mediaGroupId && !fragment.mediaGroupId.startsWith('x'))?.mediaGroupId || null;
    const images = dedupeImages(group.matched.flatMap(fragment => fragment.images), branding);
    const plan = planOf(
      chatId,
      group.messageIds[0] || '0',
      group.messageIds,
      mediaGroupId,
      group.text,
      images,
      group.matched.map(fragment => ({id: fragment.id, title: fragment.title})),
    );
    if (plan) plans.push(plan);
  }
  return plans;
}

/**
 * Rebuild offers from stored messages when they exist, otherwise from the sync log.
 * A plan is emitted only when two or more fragment listings belong to the same offer.
 */
export function planOfferMerges(input: {messages: OfferMessage[]; fragments: FragmentInput[]; logs: LogInput[]}): MergePlan[] {
  const chats = new Set<string>();
  for (const item of [...input.messages, ...input.fragments, ...input.logs]) {
    if (item.chatId) chats.add(item.chatId);
  }
  const plans: MergePlan[] = [];
  for (const chatId of chats) {
    const messages = input.messages.filter(item => item.chatId === chatId);
    const fragments = input.fragments.filter(item => item.chatId === chatId);
    const logs = input.logs.filter(item => item.chatId === chatId);
    const fromMessages = plansFromMessages(chatId, messages, fragments);
    plans.push(...fromMessages.plans);
    const covered = new Set(messages.map(item => item.messageId));
    const leftover = fragments.filter(fragment => !fromMessages.used.has(fragment.id));
    const leftoverLogs = logs.filter(log => !covered.has(log.messageId));
    plans.push(...legacyPlans(chatId, leftover, leftoverLogs));
  }
  return plans;
}
