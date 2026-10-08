import {getCrmUser} from '@/lib/admin';
import {renderErrorMessage} from '@/lib/render-error-log';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Admins can read the redacted message stored for a server-error digest. */
export async function GET(req: Request) {
  const user = await getCrmUser();
  if (!user || user.role !== 'admin') {
    return Response.json({error: 'غير مصرح'}, {status: 403});
  }
  const digest = new URL(req.url).searchParams.get('digest') || '';
  if (!/^[a-zA-Z0-9_-]{4,80}$/.test(digest)) {
    return Response.json({error: 'مرجع غير صالح'}, {status: 400});
  }
  const message = renderErrorMessage(digest);
  if (!message) return Response.json({error: 'لا توجد تفاصيل'}, {status: 404});
  return Response.json({message});
}
