import {createWriteStream} from 'node:fs';
import {mkdir, mkdtemp, open, readFile, rm, stat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {Readable} from 'node:stream';
import {pipeline} from 'node:stream/promises';
import Busboy from 'busboy';
import yauzl from 'yauzl';
import type {Entry, ZipFile} from 'yauzl';
import {combinedText, groupExportMessages, messagePhotoPaths, messageText, type ExportMessage} from './telegram-export';
import {normalizeChatId, sourceKeyFor} from './telegram-ids';
import {mediaTarget} from './telegram-media';
import {publishTelegramOffer, recordTelegramEvent} from './telegram-sync';
import type {StoredImage} from './telegram-media';

export class ImportError extends Error {}

export type ImportSummary = {created: number; updated: number; skipped: number; errors: string[]};

/** Application cap. Hostinger's proxy often rejects the request before this, around 128MB. */
export const TELEGRAM_UPLOAD_LIMIT = 512 * 1024 * 1024;
const JSON_LIMIT = 64 * 1024 * 1024;
const PHOTO_LIMIT = 20 * 1024 * 1024;

function openZip(file: string) {
  return new Promise<ZipFile>((resolve, reject) => {
    yauzl.open(file, {lazyEntries: true, autoClose: false}, (error, zip) => {
      if (error || !zip) reject(error || new ImportError('تعذر فتح الملف المضغوط'));
      else resolve(zip);
    });
  });
}

function readEntries(zip: ZipFile) {
  const entries = new Map<string, Entry>();
  return new Promise<Map<string, Entry>>((resolve, reject) => {
    zip.on('entry', (entry: Entry) => {
      const name = entry.fileName.replace(/\\/g, '/');
      if (!name.includes('..') && !name.endsWith('/')) entries.set(name, entry);
      zip.readEntry();
    });
    zip.once('end', () => resolve(entries));
    zip.once('error', reject);
    zip.readEntry();
  });
}

function openEntry(zip: ZipFile, entry: Entry) {
  return new Promise<NodeJS.ReadableStream>((resolve, reject) => {
    zip.openReadStream(entry, (error, stream) => {
      if (error || !stream) reject(error || new ImportError('تعذر قراءة ملف داخل الأرشيف'));
      else resolve(stream);
    });
  });
}

async function readEntry(zip: ZipFile, entry: Entry, max: number) {
  if (entry.uncompressedSize > max) throw new ImportError('ملف result.json أكبر من الحد المسموح');
  const stream = await openEntry(zip, entry);
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of stream) {
    const bytes = typeof chunk === 'string' ? Buffer.from(chunk) : Buffer.from(chunk);
    size += bytes.length;
    if (size > max) throw new ImportError('ملف result.json أكبر من الحد المسموح');
    chunks.push(bytes);
  }
  return Buffer.concat(chunks);
}

async function writeEntry(zip: ZipFile, entry: Entry, absolute: string, max: number) {
  if (entry.uncompressedSize > max) return false;
  await mkdir(path.dirname(absolute), {recursive: true});
  const stream = await openEntry(zip, entry);
  await pipeline(stream, createWriteStream(absolute));
  return true;
}

function findResult(entries: Map<string, Entry>) {
  const names = [...entries.keys()].filter(name => /(^|\/)result\.json$/i.test(name));
  names.sort((left, right) => left.length - right.length);
  return names[0] ? entries.get(names[0]) ?? null : null;
}

function findPhoto(entries: Map<string, Entry>, relative: string) {
  const wanted = relative.replace(/\\/g, '/').replace(/^\/+/, '');
  if (!wanted || wanted.includes('..')) return null;
  if (entries.has(wanted)) return entries.get(wanted) ?? null;
  for (const [name, entry] of entries) {
    if (name === wanted || name.endsWith(`/${wanted}`)) return entry;
  }
  return null;
}

function exportRoot(value: unknown) {
  if (Array.isArray(value)) return {id: '', messages: value as ExportMessage[]};
  if (!value || typeof value !== 'object' || !Array.isArray((value as {messages?: unknown}).messages)) {
    throw new ImportError('ملف JSON لا يحتوي قائمة messages. صدّر السجل من تيليجرام بصيغة JSON.');
  }
  const root = value as {id?: unknown; messages: ExportMessage[]};
  return {id: root.id == null ? '' : String(root.id), messages: root.messages};
}

async function publishGroups(root: {id: string; messages: ExportMessage[]}, loadPhoto: (relative: string, messageId: string) => Promise<StoredImage | null>) {
  const summary: ImportSummary = {created: 0, updated: 0, skipped: 0, errors: []};
  const chatId = normalizeChatId(root.id);
  if (!chatId) throw new ImportError('ملف التصدير بلا معرف القناة');
  const usable: ExportMessage[] = [];
  for (const message of root.messages) {
    if (!message || message.type === 'service' || message.type === 'unsupported') {
      summary.skipped += 1;
      continue;
    }
    if (!messageText(message).trim() && !messagePhotoPaths(message).length) {
      summary.skipped += 1;
      continue;
    }
    usable.push(message);
  }
  let missingPhotos = 0;
  for (const group of groupExportMessages(usable)) {
    const ids = group.map(message => String(message.id ?? '').replace(/\D/g, '')).filter(Boolean);
    if (!ids.length) {
      summary.skipped += 1;
      continue;
    }
    const explicit = group.map(message => message.media_group_id ?? message.grouped_id).find(value => value != null && String(value) !== '');
    const mediaGroupId = explicit == null ? (group.length > 1 ? `x${ids[0]}` : null) : String(explicit);
    const images: StoredImage[] = [];
    for (const message of group) {
      const messageId = String(message.id ?? '').replace(/\D/g, '');
      for (const relative of messagePhotoPaths(message)) {
        try {
          const saved = await loadPhoto(relative, messageId);
          if (saved) images.push(saved);
          else missingPhotos += 1;
        } catch (error) {
          missingPhotos += 1;
          if (summary.errors.length < 12) summary.errors.push(error instanceof Error ? error.message : 'تعذر حفظ صورة');
        }
      }
    }
    try {
      const saved = await publishTelegramOffer({
        chatId,
        messageIds: ids,
        mediaGroupId,
        sourceKey: sourceKeyFor(chatId, ids[0] || '0', mediaGroupId),
        text: combinedText(group),
        images,
        edited: false,
      });
      summary[saved.action] += 1;
    } catch (error) {
      if (summary.errors.length < 12) summary.errors.push(error instanceof Error ? error.message : 'تعذر حفظ عرض');
    }
  }
  if (missingPhotos && summary.errors.length < 12) summary.errors.push(`تعذر إرفاق ${missingPhotos} صورة من الأرشيف`);
  await recordTelegramEvent({
    chatId,
    messageId: '',
    mediaGroupId: null,
    propertyId: null,
    action: 'import',
    note: `جديد ${summary.created}، تحديث ${summary.updated}، تجاوز ${summary.skipped}`,
  });
  return summary;
}

async function importJsonBuffer(bytes: Buffer, photos: Map<string, Entry> | null, zip: ZipFile | null) {
  let root: ReturnType<typeof exportRoot>;
  try {
    root = exportRoot(JSON.parse(bytes.toString('utf8')));
  } catch (error) {
    if (error instanceof ImportError) throw error;
    throw new ImportError('تعذر قراءة JSON');
  }
  return publishGroups(root, async (relative, messageId) => {
    if (!photos || !zip) return null;
    const entry = findPhoto(photos, relative);
    if (!entry) return null;
    const ext = (path.extname(relative).toLowerCase() || '.jpg').replace(/[^a-z0-9.]/g, '') || '.jpg';
    const safeExt = ['.jpg', '.jpeg', '.png', '.webp', '.gif'].includes(ext) ? (ext === '.jpeg' ? '.jpg' : ext) : '.jpg';
    const filename = `tgx-${root.id.replace(/\D/g, '').slice(-12) || 'chat'}-${messageId}-${Buffer.from(relative).toString('hex').slice(0, 24)}${safeExt}`;
    const target = mediaTarget(filename);
    const wrote = await writeEntry(zip, entry, target.absolute, PHOTO_LIMIT);
    if (!wrote) return null;
    return {messageId, fileUniqueId: filename, path: target.publicPath};
  });
}

export async function importTelegramFile(filePath: string, filename: string) {
  const info = await stat(filePath);
  const handle = await open(filePath, 'r');
  const head = Buffer.alloc(4);
  await handle.read(head, 0, 4, 0);
  await handle.close();
  const isZip = (head[0] === 0x50 && head[1] === 0x4b) || filename.toLowerCase().endsWith('.zip');
  if (!isZip) {
    if (info.size > JSON_LIMIT) throw new ImportError('ملف JSON أكبر من الحد المسموح');
    return importJsonBuffer(await readFile(filePath), null, null);
  }
  const zip = await openZip(filePath);
  try {
    const entries = await readEntries(zip);
    const result = findResult(entries);
    if (!result) throw new ImportError('الأرشيف لا يحتوي result.json. صدّر السجل بصيغة JSON مع مجلد photos.');
    const json = await readEntry(zip, result, JSON_LIMIT);
    return importJsonBuffer(json, entries, zip);
  } finally {
    zip.close();
  }
}

export async function importTelegramRequest(req: Request): Promise<ImportSummary> {
  const declared = Number(req.headers.get('content-length') || 0);
  if (declared > TELEGRAM_UPLOAD_LIMIT) {
    throw new ImportError('الملف أكبر من حد الرفع. وسيط Hostinger غالبًا يرفض ما يزيد عن 128 ميجابايت؛ ارفع result.json أو قسّم الصور.');
  }
  const contentType = req.headers.get('content-type') || '';
  if (!contentType.toLowerCase().includes('multipart/form-data') || !req.body) {
    throw new ImportError('ارفق ملف result.json أو الأرشيف المضغوط');
  }
  const dir = await mkdtemp(path.join(tmpdir(), 'tg-import-'));
  const destination = path.join(dir, 'upload.bin');
  try {
    const uploaded = await saveUpload(req, contentType, destination);
    if (uploaded.truncated) {
      throw new ImportError('الملف أكبر من حد الرفع. وسيط Hostinger غالبًا يرفض ما يزيد عن 128 ميجابايت؛ ارفع result.json أو قسّم الصور.');
    }
    return await importTelegramFile(destination, uploaded.filename);
  } finally {
    await rm(dir, {recursive: true, force: true});
  }
}

function saveUpload(req: Request, contentType: string, destination: string) {
  const busboy = Busboy({
    headers: {'content-type': contentType},
    limits: {files: 1, fileSize: TELEGRAM_UPLOAD_LIMIT, fields: 4, parts: 6},
  });
  return new Promise<{filename: string; truncated: boolean}>((resolve, reject) => {
    let filename = 'upload.bin';
    let truncated = false;
    let wrote = false;
    let stored: Promise<void> = Promise.resolve();
    busboy.on('file', (_name, file, info) => {
      wrote = true;
      filename = path.basename(info.filename || 'upload.bin');
      file.on('limit', () => {
        truncated = true;
      });
      const output = createWriteStream(destination);
      stored = pipeline(file, output);
    });
    busboy.on('error', reject);
    busboy.on('finish', () => {
      stored.then(() => {
        if (!wrote) reject(new ImportError('لم يُرفق ملف'));
        else resolve({filename, truncated});
      }, reject);
    });
    const stream = Readable.fromWeb(req.body as import('node:stream/web').ReadableStream<Uint8Array>);
    stream.on('error', reject);
    stream.pipe(busboy);
  });
}
