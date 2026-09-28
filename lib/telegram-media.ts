import {access, mkdir, writeFile} from 'node:fs/promises';
import path from 'node:path';
import {telegramMethod} from './telegram-bot';

export type StoredImage = {messageId: string; fileUniqueId: string; path: string};

const MAX_PHOTO_BYTES = 20 * 1024 * 1024;

export function mediaDirectory() {
  return path.join(process.cwd(), 'public', 'media');
}

export function mediaTarget(filename: string) {
  const safe = filename.replace(/[^a-zA-Z0-9._-]/g, '');
  if (!safe || safe.startsWith('.') || safe !== filename) throw new Error('اسم ملف الصورة غير صالح');
  const absolute = path.join(mediaDirectory(), safe);
  const root = mediaDirectory();
  if (!absolute.startsWith(root + path.sep)) throw new Error('مسار الصورة غير صالح');
  return {absolute, publicPath: `/media/${safe}`};
}

export async function mediaFileExists(publicPath: string) {
  if (!publicPath.startsWith('/media/')) return false;
  try {
    const target = mediaTarget(publicPath.slice('/media/'.length));
    await access(target.absolute);
    return true;
  } catch {
    return false;
  }
}

export async function writeMediaBytes(filename: string, bytes: Buffer) {
  if (bytes.length > MAX_PHOTO_BYTES) throw new Error('الصورة أكبر من الحد المسموح');
  const target = mediaTarget(filename);
  await mkdir(mediaDirectory(), {recursive: true});
  await writeFile(target.absolute, bytes);
  return target.publicPath;
}

function extensionOf(filePath: string, mime?: string) {
  const match = /\.([a-z0-9]{1,5})$/i.exec(filePath);
  const ext = (match?.[1] || '').toLowerCase();
  if (ext === 'jpeg' || ext === 'jpg') return 'jpg';
  if (ext === 'png' || ext === 'webp' || ext === 'gif') return ext;
  if (mime === 'image/png') return 'png';
  if (mime === 'image/webp') return 'webp';
  if (mime === 'image/gif') return 'gif';
  return 'jpg';
}

export async function downloadTelegramPhoto(input: {
  fileId: string;
  fileUniqueId: string;
  messageId: string;
  fileName?: string;
  mime?: string;
}): Promise<StoredImage> {
  const ext = extensionOf(input.fileName || '', input.mime);
  const filename = `tg-${input.fileUniqueId.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 80) || 'file'}.${ext}`;
  const target = mediaTarget(filename);
  if (await mediaFileExists(target.publicPath)) {
    return {messageId: input.messageId, fileUniqueId: input.fileUniqueId, path: target.publicPath};
  }
  const result = await telegramMethod('getFile', {file_id: input.fileId}) as {file_path?: string; file_size?: number};
  const filePath = result.file_path || '';
  if (!filePath || filePath.includes('..') || filePath.startsWith('/') || /^https?:/i.test(filePath)) {
    throw new Error('مسار ملف تيليجرام غير متوقع');
  }
  if (typeof result.file_size === 'number' && result.file_size > MAX_PHOTO_BYTES) {
    throw new Error('الصورة أكبر من الحد المسموح');
  }
  const bot = process.env.TELEGRAM_BOT_TOKEN?.trim();
  if (!bot) throw new Error('ضع TELEGRAM_BOT_TOKEN في متغيرات Hostinger');
  let response: Response;
  try {
    response = await fetch(`https://api.telegram.org/file/bot${bot}/${filePath}`, {
      cache: 'no-store',
      signal: AbortSignal.timeout(20000),
    });
  } catch {
    throw new Error('تعذر تنزيل الصورة من تيليجرام');
  }
  if (!response.ok) throw new Error('تعذر تنزيل الصورة من تيليجرام');
  const bytes = Buffer.from(await response.arrayBuffer());
  const publicPath = await writeMediaBytes(filename, bytes);
  return {messageId: input.messageId, fileUniqueId: input.fileUniqueId, path: publicPath};
}
