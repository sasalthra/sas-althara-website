import NextAuth from 'next-auth';
import {authConfigured, authOptions} from '@/lib/auth';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const handler = NextAuth(authOptions);
async function guarded(...args: Parameters<typeof handler>) {
  if (!authConfigured()) return Response.json({error: 'تسجيل الدخول غير مهيأ بعد'}, {status: 503, headers: {'Cache-Control': 'no-store'}});
  return handler(...args);
}
export {guarded as GET, guarded as POST};
