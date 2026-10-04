import {actor, ApiError, body, endpoint, reply} from '@/lib/secure-api';
import {listSheetTabs, readSheetGrid} from '@/lib/sheet-fetch.server';
import {parseSheetRef, sheetPreviewSchema, suggestSheetMapping} from '@/lib/sheet-sync-config';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  return endpoint(async () => {
    await actor(req, ['admin']);
    const input = sheetPreviewSchema.parse(await body(req, 20000));
    const ref = parseSheetRef(input.sheetUrl);
    if (!ref) throw new ApiError(400, 'رابط الجدول أو معرفه غير صالح');
    const gid = (input.gid || ref.gid || '').trim();
    const tabs = await listSheetTabs(ref.sheetId);
    const grid = await readSheetGrid(ref.sheetId, gid);
    const headers = (grid[0] || []).map(cell => String(cell ?? '').replace(/^\uFEFF/, '').trim().slice(0, 150));
    if (headers.filter(header => header.trim()).length < 2) throw new ApiError(422, 'لم أجد صف عناوين في الجدول');
    return reply({sheetId: ref.sheetId, gid, headers, mapping: suggestSheetMapping(headers), tabs});
  });
}
