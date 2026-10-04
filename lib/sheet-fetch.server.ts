import 'server-only';
import {createSign} from 'node:crypto';
import {z} from 'zod';
import {ApiError, body} from './secure-api';
import {parseCsv, parseSheetTabList, type SheetTab} from './sheet-sync-config';

const MAX_ROWS = 5001;
const MAX_BYTES = 5_000_000;
const SHEET_USER_AGENT = 'Mozilla/5.0 (compatible; SasAltharaCRM/1.0; +https://sasalthra.sa)';

type ServiceAccount = {client_email: string; private_key: string};

export function readServiceAccount(): ServiceAccount | null {
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON?.trim() || '';
  if (raw) {
    try {
      const json = raw.startsWith('{') ? raw : Buffer.from(raw, 'base64').toString('utf8');
      const parsed = z.object({client_email: z.string().email(), private_key: z.string().min(40)}).parse(JSON.parse(json));
      return {client_email: parsed.client_email, private_key: parsed.private_key.replace(/\\n/g, '\n')};
    } catch (error) {
      console.error('GOOGLE_SERVICE_ACCOUNT_JSON was not readable', error instanceof Error ? error.name : 'error');
    }
  }
  const email = process.env.GOOGLE_SHEETS_CLIENT_EMAIL?.trim() || '';
  const privateKey = process.env.GOOGLE_SHEETS_PRIVATE_KEY || '';
  if (email && privateKey) return {client_email: email, private_key: privateKey.replace(/\\n/g, '\n')};
  return null;
}

export function serviceAccountConfigured() {
  return Boolean(readServiceAccount());
}

function looksLikeCsv(text: string, contentType: string) {
  if (/text\/html|application\/xhtml/i.test(contentType)) return false;
  const start = text.trimStart().slice(0, 24).toLowerCase();
  if (start.startsWith('<!doctype') || start.startsWith('<html')) return false;
  return text.includes(',') || text.includes('\n');
}

function limitGrid(grid: string[][]) {
  if (grid.length <= MAX_ROWS) return grid;
  return grid.slice(0, MAX_ROWS);
}

async function googleToken(account: ServiceAccount) {
  const now = Math.floor(Date.now() / 1000);
  const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');
  const unsigned =
    encode({alg: 'RS256', typ: 'JWT'}) +
    '.' +
    encode({
      iss: account.client_email,
      scope: 'https://www.googleapis.com/auth/spreadsheets.readonly',
      aud: 'https://oauth2.googleapis.com/token',
      iat: now,
      exp: now + 300,
    });
  const signer = createSign('RSA-SHA256');
  signer.update(unsigned);
  const assertion = unsigned + '.' + signer.sign(account.private_key, 'base64url');
  const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: {'content-type': 'application/x-www-form-urlencoded'},
    body: new URLSearchParams({grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion}),
    signal: AbortSignal.timeout(15000),
    redirect: 'error',
  });
  if (!tokenResponse.ok) throw new ApiError(502, 'تعذر توثيق Google Sheets');
  return z.object({access_token: z.string().min(1)}).parse(await body(tokenResponse, 20000)).access_token;
}

function quoteSheetTitle(title: string) {
  return `'${title.replace(/'/g, "''")}'`;
}

async function fetchPrivateGrid(account: ServiceAccount, sheetId: string, gid: string) {
  const token = await googleToken(account);
  let range = 'A:ZZ';
  if (gid) {
    const meta = await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}?fields=sheets.properties(sheetId,title)`,
      {headers: {Authorization: `Bearer ${token}`}, signal: AbortSignal.timeout(20000), redirect: 'error', cache: 'no-store'}
    );
    if (!meta.ok) throw new ApiError(502, 'تعذر قراءة أوراق الجدول الخاص');
    const parsed = z
      .object({
        sheets: z
          .array(z.object({properties: z.object({sheetId: z.number().optional(), title: z.string().optional()}).optional()}))
          .optional(),
      })
      .parse(await body(meta, 500000));
    const title = parsed.sheets?.find(sheet => String(sheet.properties?.sheetId ?? '') === gid)?.properties?.title;
    if (!title) throw new ApiError(422, 'رقم الورقة غير موجود في الجدول');
    range = `${quoteSheetTitle(title)}!A:ZZ`;
  }
  const response = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/${encodeURIComponent(range)}?valueRenderOption=FORMATTED_VALUE`,
    {headers: {Authorization: `Bearer ${token}`}, signal: AbortSignal.timeout(20000), redirect: 'error', cache: 'no-store'}
  );
  if (!response.ok) throw new ApiError(502, 'تعذر قراءة الجدول الخاص');
  const result = z
    .object({values: z.array(z.array(z.union([z.string(), z.number(), z.boolean()]))).max(MAX_ROWS)})
    .parse(await body(response, MAX_BYTES));
  return result.values.map(row => row.map(cell => String(cell)));
}

/** Public htmlview tab list, then the service-account metadata when the sheet is private. */
export async function listSheetTabs(sheetId: string): Promise<SheetTab[]> {
  if (!/^[a-zA-Z0-9_-]{20,100}$/.test(sheetId)) return [];
  try {
    const response = await fetch(`https://docs.google.com/spreadsheets/d/${sheetId}/htmlview`, {
      redirect: 'follow',
      cache: 'no-store',
      signal: AbortSignal.timeout(15000),
      headers: {'User-Agent': SHEET_USER_AGENT, Accept: 'text/html'},
    });
    if (response.ok) {
      const text = (await response.text()).slice(0, 1_000_000);
      const tabs = parseSheetTabList(text);
      if (tabs.length) return tabs;
    }
  } catch (error) {
    console.error('public sheet tabs were not listed', error instanceof Error ? error.name : 'error');
  }
  const account = readServiceAccount();
  if (!account) return [];
  try {
    const token = await googleToken(account);
    const meta = await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}?fields=sheets.properties(sheetId,title)`,
      {headers: {Authorization: `Bearer ${token}`}, signal: AbortSignal.timeout(20000), redirect: 'error', cache: 'no-store'}
    );
    if (!meta.ok) return [];
    const parsed = z
      .object({
        sheets: z
          .array(z.object({properties: z.object({sheetId: z.number().optional(), title: z.string().optional()}).optional()}))
          .optional(),
      })
      .parse(await body(meta, 500000));
    return (parsed.sheets || [])
      .map(sheet => ({
        gid: String(sheet.properties?.sheetId ?? ''),
        name: String(sheet.properties?.title || '').replace(/[\u0000-\u001f]/g, '').trim().slice(0, 80),
      }))
      .filter(tab => /^\d{1,20}$/.test(tab.gid) && tab.name)
      .slice(0, 40);
  } catch (error) {
    console.error('private sheet tabs were not listed', error instanceof Error ? error.name : 'error');
    return [];
  }
}

function publicCsvUrls(sheetId: string, gid: string) {
  const exported = new URL(`https://docs.google.com/spreadsheets/d/${sheetId}/export`);
  exported.searchParams.set('format', 'csv');
  if (gid) exported.searchParams.set('gid', gid);
  const gviz = new URL(`https://docs.google.com/spreadsheets/d/${sheetId}/gviz/tq`);
  gviz.searchParams.set('tqx', 'out:csv');
  if (gid) gviz.searchParams.set('gid', gid);
  return [exported, gviz];
}

/**
 * Google's CSV export answers with a 307 to googleusercontent. Follow it, and
 * send a User-Agent so the redirect is not replaced by an HTML interstitial.
 */
async function fetchPublicCsv(url: URL) {
  const response = await fetch(url, {
    redirect: 'follow',
    cache: 'no-store',
    signal: AbortSignal.timeout(20000),
    headers: {
      'User-Agent': SHEET_USER_AGENT,
      Accept: 'text/csv,text/plain;q=0.9,*/*;q=0.8',
    },
  });
  const text = await response.text();
  return {
    ok: response.ok,
    status: response.status,
    contentType: response.headers.get('content-type') || '',
    text,
  };
}

/** Public CSV export first. Private sheets fall back to a Google service account when one is configured. */
export async function readSheetGrid(sheetId: string, gid = ''): Promise<string[][]> {
  if (!/^[a-zA-Z0-9_-]{20,100}$/.test(sheetId)) throw new ApiError(400, 'معرف الجدول غير صالح');
  if (gid && !/^\d{1,20}$/.test(gid)) throw new ApiError(400, 'رقم الورقة غير صالح');
  let publicFailed = false;
  let lastStatus = 0;
  let lastType = '';
  for (const url of publicCsvUrls(sheetId, gid)) {
    try {
      const fetched = await fetchPublicCsv(url);
      lastStatus = fetched.status;
      lastType = fetched.contentType;
      if (fetched.text.length > MAX_BYTES) throw new ApiError(413, 'الجدول أكبر من الحد المسموح');
      if (fetched.ok && looksLikeCsv(fetched.text, fetched.contentType)) {
        const grid = limitGrid(parseCsv(fetched.text));
        if (grid.length) return grid;
      }
      publicFailed = true;
    } catch (error) {
      if (error instanceof ApiError) throw error;
      publicFailed = true;
      lastType = error instanceof Error ? error.message : 'network';
    }
  }
  const account = readServiceAccount();
  if (!account) {
    const statusNote = lastStatus ? ` (${lastStatus}${lastType ? ` ${lastType}` : ''})` : '';
    throw new ApiError(
      502,
      publicFailed
        ? `تعذر قراءة تصدير CSV${statusNote}. إن كان الجدول خاصاً أضف GOOGLE_SERVICE_ACCOUNT_JSON وشارك الجدول مع حساب الخدمة`
        : `تعذر قراءة الجدول${statusNote}`
    );
  }
  return limitGrid(await fetchPrivateGrid(account, sheetId, gid));
}
