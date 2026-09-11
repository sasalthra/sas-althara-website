import type { NextAuthOptions } from 'next-auth';
import CredentialsProvider from 'next-auth/providers/credentials';
import GoogleProvider from 'next-auth/providers/google';
import bcrypt from 'bcryptjs';

import {crmDb} from './crm-db';
import {allowedGoogleProfile, ADMIN_EMAIL} from './auth-policy';

type CrmRole = 'admin' | 'supervisor' | 'sales' | 'field';

type CrmUserRow = {
  id: string;
  username: string;
  password_hash: string;
  name: string;
  email: string | null;
  role: CrmRole;
  active: number;
};

export function authConfigured() {
  const {NEXTAUTH_URL, NEXTAUTH_SECRET} = process.env;

  if (!NEXTAUTH_URL || !NEXTAUTH_SECRET || NEXTAUTH_SECRET.length < 32) {
    return false;
  }

  try {
    const url = new URL(NEXTAUTH_URL);

    return (
      url.origin === NEXTAUTH_URL &&
      (
        url.protocol === 'https:' ||
        (process.env.NODE_ENV !== 'production' && url.hostname === 'localhost')
      )
    );
  } catch {
    return false;
  }
}

const providers: NextAuthOptions['providers'] = [
  CredentialsProvider({
    name: 'Username and Password',

    credentials: {
      username: {
        label: 'Username',
        type: 'text',
      },
      password: {
        label: 'Password',
        type: 'password',
      },
    },

    async authorize(credentials) {
      const username = credentials?.username?.trim().toLowerCase();
      const password = credentials?.password;

      if (!username || !password) {
        return null;
      }

      try {
        const user = await crmDb()
          .prepare(`
            SELECT
              id,
              username,
              password_hash,
              name,
              email,
              role,
              active
            FROM crm_users
            WHERE LOWER(username) = ?
            LIMIT 1
          `)
          .bind(username)
          .first<CrmUserRow>();

        if (!user || user.active !== 1) {
          return null;
        }

        const validPassword = await bcrypt.compare(
          password,
          user.password_hash
        );

        if (!validPassword) {
          return null;
        }

        return {
          id: user.id,
          name: user.name,
          email: user.email,
          username: user.username,
          role: user.role,
        } as {
          id: string;
          name: string;
          email: string | null;
          username: string;
          role: CrmRole;
        };
      } catch (error) {
        console.error('CRM credentials login failed:', error);
        return null;
      }
    },
  }),
];

if (process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET) {
  providers.push(
    GoogleProvider({
      clientId: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
      authorization: {
        params: {
          scope: 'openid email profile',
          prompt: 'select_account',
        },
      },
    })
  );
}

export const authOptions: NextAuthOptions = {
  secret: process.env.NEXTAUTH_SECRET,

  providers,

  session: {
    strategy: 'jwt',
    maxAge: 60 * 60,
  },

  jwt: {
    maxAge: 60 * 60,
  },

  pages: {
    signIn: '/crm',
    error: '/crm',
  },

  callbacks: {
    async signIn({account, profile, user}) {
      if (account?.provider === 'credentials') {
        return Boolean(user?.id);
      }

      if (account?.provider === 'google') {
        return allowedGoogleProfile(account.provider, profile);
      }

      return false;
    },

    async jwt({token, account, profile, user}) {
      if (account?.provider === 'credentials' && user) {
        const crmUser = user as typeof user & {
          username: string;
          role: CrmRole;
        };

        token.crmUserId = crmUser.id;
        token.crmUsername = crmUser.username;
        token.crmRole = crmUser.role;
        token.crmName = crmUser.name;
        token.admin = crmUser.role === 'admin';
        token.adminId = crmUser.id;

        return token;
      }

      if (account?.provider === 'google') {
        const allowed = allowedGoogleProfile(account.provider, profile);

        token.admin = allowed;
        token.adminId = allowed ? `google:${profile?.sub}` : null;
        token.crmUserId = allowed ? `google:${profile?.sub}` : null;
        token.crmUsername = allowed ? ADMIN_EMAIL : null;
        token.crmRole = allowed ? 'admin' : null;
        token.crmName = allowed ? 'Administrator' : null;
      }

      return token;
    },

    async session({session, token}) {
      if (
        typeof token.crmUserId === 'string' &&
        typeof token.crmRole === 'string'
      ) {
        session.user = {
          ...session.user,
          name:
            typeof token.crmName === 'string'
              ? token.crmName
              : session.user?.name,
          email: session.user?.email,
        };

        const crmSession = session as typeof session & {
          crmUserId: string;
          crmUsername?: string;
          crmRole: CrmRole;
          adminId?: string;
        };

        crmSession.crmUserId = token.crmUserId;
        crmSession.crmUsername =
          typeof token.crmUsername === 'string'
            ? token.crmUsername
            : undefined;
        crmSession.crmRole = token.crmRole as CrmRole;

        if (typeof token.adminId === 'string') {
          crmSession.adminId = token.adminId;
        }
      }

      return session;
    },

    async redirect({url, baseUrl}) {
      try {
        const target = new URL(url, baseUrl);

        if (target.origin === baseUrl) {
          return target.href;
        }
      } catch {}

      return `${baseUrl}/crm`;
    },
  },
};