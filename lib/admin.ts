import {getServerSession} from 'next-auth';
import {authConfigured, authOptions} from './auth';
import {ADMIN_EMAIL} from './auth-policy';
export async function getAdmin() {
  if (!authConfigured()) return null;
  const session = await getServerSession(authOptions);
  const id = (session as {adminId?: string} | null)?.adminId;
  if (session?.user?.email !== ADMIN_EMAIL || !id?.startsWith('google:')) return null;
  return {userId: id, email: ADMIN_EMAIL};
}
