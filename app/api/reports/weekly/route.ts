import {ApiError, actor, body, endpoint, reply} from '@/lib/secure-api';
import {sendWeeklyReport} from '@/lib/weekly-report-job.server';
import {manualReportRange, riyadhClock, validReportRange} from '@/lib/weekly-report';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function rangeFor(period: string, from: string, to: string) {
  if (period === 'week' || period === 'month') {
    const range = manualReportRange(period, riyadhClock(new Date()).dayKey);
    if (!range) throw new ApiError(400, 'تعذر تحديد الفترة');
    return range;
  }
  if (period === 'filters') {
    if (!validReportRange(from, to)) throw new ApiError(400, 'حدد فترة صالحة في الفلاتر أولاً');
    return {from, to};
  }
  throw new ApiError(400, 'فترة غير معروفة');
}

export async function POST(req: Request) {
  return endpoint(async () => {
    await actor(req, ['admin']);
    const payload = await body(req);
    const data = payload && typeof payload === 'object'
      ? payload as {period?: unknown; from?: unknown; to?: unknown; preview?: unknown}
      : {};
    const range = rangeFor(String(data.period || ''), String(data.from || ''), String(data.to || ''));
    const preview = data.preview === true;
    const result = await sendWeeklyReport({force: true, preview, from: range.from, to: range.to});
    if (preview) {
      if (!result.html) throw new ApiError(503, 'تعذر تجهيز معاينة التقرير');
      return reply({ok: true, html: result.html, from: result.from, to: result.to});
    }
    if (!result.sent) throw new ApiError(503, `تعذر إرسال التقرير: ${result.error || 'فشل الإرسال'}`);
    const toAddress = result.toAddress.join('، ');
    return reply({
      ok: true,
      sent: true,
      recorded: false,
      from: result.from,
      to: result.to,
      toAddress: result.toAddress,
      message: `تم إرسال التقرير إلى ${toAddress} عن الفترة ${result.from} — ${result.to}`,
    });
  });
}
