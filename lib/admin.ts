import {getServerSession} from 'next-auth';
import {authConfigured, authOptions} from './auth';

export type CrmRole = 'admin' | 'supervisor' | 'sales' | 'field';

export async function getCrmUser() {
  if (!authConfigured()) return null;

  const session = await getServerSession(authOptions);

  const crmSession = session as
    | (typeof session & {
        crmUserId?: string;
        crmUsername?: string;
        crmRole?: CrmRole;
      })
    | null;

  if (!session?.user || !crmSession?.crmUserId || !crmSession.crmRole) {
    return null;
  }

  return {
    userId: crmSession.crmUserId,
    username: crmSession.crmUsername ?? '',
    role: crmSession.crmRole,
    name: session.user.name ?? '',
    email: session.user.email ?? null,
  };
}

export async function getAdmin() {
  return getCrmUser();
}