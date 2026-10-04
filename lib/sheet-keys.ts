import {createHash} from 'node:crypto';

/** SHA-256 hex. Unique indexes use this instead of long utf8mb4 strings. */
export function sheetSourceKey(sheetId: string, gid: string) {
  return createHash('sha256').update(`${sheetId}\u001f${gid.trim()}`).digest('hex');
}

export function sheetRowKeyHash(sourceId: string, rowKey: string) {
  return createHash('sha256').update(`${sourceId}\u001f${rowKey}`).digest('hex');
}
