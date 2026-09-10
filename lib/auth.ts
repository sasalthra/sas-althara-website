import type { NextAuthOptions } from 'next-auth';
import GoogleProvider from 'next-auth/providers/google';
import { allowedGoogleProfile, ADMIN_EMAIL } from './auth-policy';
export function authConfigured() {
  const {NEXTAUTH_URL, NEXTAUTH_SECRET, GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET} = process.env;
  if (!NEXTAUTH_URL || !NEXTAUTH_SECRET || NEXTAUTH_SECRET.length < 32 || !GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET) return false;
  try {
    const url = new URL(NEXTAUTH_URL);
    return url.origin === NEXTAUTH_URL && (url.protocol === 'https:' || (process.env.NODE_ENV !== 'production' && url.hostname === 'localhost'));
  } catch { return false; }
}
export const authOptions: NextAuthOptions = {
  secret: process.env.NEXTAUTH_SECRET,
  providers: [GoogleProvider({
    clientId: process.env.GOOGLE_CLIENT_ID || '',
    clientSecret: process.env.GOOGLE_CLIENT_SECRET || '',
    authorization: {params: {scope: 'openid email profile', prompt: 'select_account'}},
  })],
  session: {strategy: 'jwt', maxAge: 60 * 60},
  jwt: {maxAge: 60 * 60},
  pages: {signIn: '/crm', error: '/crm'},
  callbacks: {
    async signIn({account, profile}) {
      return authConfigured() && allowedGoogleProfile(account?.provider, profile);
    },
    async jwt({token, account, profile}) {
      if (account) {
        token.admin = allowedGoogleProfile(account.provider, profile);
        token.adminId = token.admin ? `google:${profile?.sub}` : null;
      }
      return token;
    },
    async session({session, token}) {
      if (token.admin === true && token.email?.toLowerCase() === ADMIN_EMAIL && typeof token.adminId === 'string') {
        session.user = {...session.user, email: ADMIN_EMAIL};
        (session as typeof session & {adminId: string}).adminId = token.adminId;
      } else {
        session.user = undefined;
      }
      return session;
    },
    async redirect({url, baseUrl}) {
      try { const target = new URL(url, baseUrl); if (target.origin === baseUrl) return target.href; } catch {}
      return baseUrl + '/crm';
    },
  },
};
