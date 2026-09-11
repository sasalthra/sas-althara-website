import {getServerSession} from 'next-auth';
import {authOptions} from '@/lib/auth';
import {LoginButton} from './auth-buttons';
import Workspace from './workspace';

export const dynamic = 'force-dynamic';

export default async function CrmPage() {
  const session = await getServerSession(authOptions);

  if (!session?.user) {
    return (
      <main className="min-h-screen flex items-center justify-center p-6">
        <div className="w-full max-w-md rounded-2xl border p-8 shadow-sm">
          <h1 className="text-2xl font-bold mb-2">تسجيل الدخول</h1>

          <p className="text-sm text-muted-foreground mb-6">
            الدخول إلى نظام إدارة العملاء
          </p>

          <LoginButton />
        </div>
      </main>
    );
  }

  return <Workspace />;
}