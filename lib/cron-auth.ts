import {timingSafeEqual} from 'node:crypto';

export function cronAuthorized(
  headers: {authorization?: string | null; cronSecret?: string | null},
  secret = process.env.CRON_SECRET
) {
  const value = (secret || '').trim();
  if (value.length < 32) return false;
  const cronHeader = (headers.cronSecret || '').trim();
  const authorization = (headers.authorization || '').trim();
  const bearer = authorization.toLowerCase().startsWith('bearer ') ? authorization.slice(7).trim() : '';
  const token = cronHeader || bearer;
  if (!token) return false;
  const left = Buffer.from(value);
  const right = Buffer.from(token);
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}
