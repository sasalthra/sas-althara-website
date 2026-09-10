import {getChatGPTUser,chatGPTSignInPath as chatgptSignInPath} from '@/app/chatgpt-auth';
import {isAdminIdentity} from '@/lib/admin';

import CRM from './workspace';
export const dynamic='force-dynamic';
export default async function CRMPage(){const user=await getChatGPTUser();if(!isAdminIdentity(user))return <main className="login-page"><a href="/"><img src="/brand/logo.png" alt="ساس الثراء" width={220}/></a><section className="panel"><span className="eyebrow">النظام الداخلي</span><h1 className="detail-title">دخول إدارة ساس الثراء</h1><p>{user?'هذا الحساب غير مخوّل بدخول الإدارة.':'الدخول مخصص لحساب الإدارة المعتمد فقط.'}</p><a className="primary" href={user?'/signout-with-chatgpt?return_to=/crm':chatgptSignInPath('/crm')} target="_top">{user?'تسجيل الخروج وتغيير الحساب':'تسجيل الدخول الآمن'}</a><p className="subtle">يتم التحقق من هويتك عبر تسجيل الدخول، دون حفظ كلمة مرور داخل الموقع. الدخول التجريبي المحلي معطّل.</p><a href="/">العودة إلى الموقع</a></section></main>;return <CRM/>}
