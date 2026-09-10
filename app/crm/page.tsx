import {getAdmin} from '@/lib/admin';
import {authConfigured} from '@/lib/auth';
import {LoginButton} from './auth-buttons';
import CRM from './workspace';
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export default async function CRMPage({searchParams}: {searchParams: Promise<{error?: string}>}) {
  if (await getAdmin()) return <CRM/>;
  const {error} = await searchParams;
  return <main className="login-page"><a href="/"><img src="/brand/logo.png" alt="ساس الثراء" width={220}/></a>
    <section className="panel"><span className="eyebrow">النظام الداخلي</span><h1 className="detail-title">دخول إدارة ساس الثراء</h1>
      <p>الدخول مخصص لحساب الإدارة المعتمد فقط.</p>
      {error && <p role="alert">تعذر تسجيل الدخول. تأكد من استخدام حساب الإدارة المعتمد ثم حاول مجددًا.</p>}
      {authConfigured() ? <LoginButton/> : <p role="status">تسجيل الدخول غير متاح حتى اكتمال إعداد النظام.</p>}
      <p className="subtle">يتم التحقق من حسابك عبر Google دون حفظ كلمة مرورك داخل الموقع.</p><a href="/">العودة إلى الموقع</a>
    </section></main>;
}
