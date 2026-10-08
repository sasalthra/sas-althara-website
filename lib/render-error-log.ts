import {publicSyncError} from './sheet-sync-config';

const messages = new Map<string, string>();
const MAX = 50;

/** Remember a redacted server-render error so an admin can read it by digest. */
export function rememberRenderError(error: unknown) {
  const digest = error && typeof error === 'object' && 'digest' in error
    ? String((error as {digest?: unknown}).digest ?? '')
    : '';
  if (!/^[a-zA-Z0-9_-]{4,80}$/.test(digest)) return;
  if (messages.has(digest)) return;
  if (messages.size >= MAX) {
    const oldest = messages.keys().next().value;
    if (oldest) messages.delete(oldest);
  }
  messages.set(digest, publicSyncError(error));
}

export function renderErrorMessage(digest: string) {
  return messages.get(digest) ?? null;
}
