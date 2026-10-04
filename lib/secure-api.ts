import {getCrmUser} from './admin';
import {publicSyncError} from './sheet-sync-config';
import {z} from 'zod';
export class ApiError extends Error {constructor(public status:number,message:string){super(message);}}
export function reply(body:unknown,status=200){return Response.json(body,{status,headers:{'Cache-Control':'no-store'}});}
export async function actor(req?:Request, roles?:string[]){
 const user=await getCrmUser();
 if(!user) throw new ApiError(401,'يجب تسجيل الدخول');
 if(roles && !roles.includes(user.role)) throw new ApiError(403,'لا تملك الصلاحية');
 if(req && (!process.env.NEXTAUTH_URL || req.headers.get('origin')!==new URL(process.env.NEXTAUTH_URL).origin)) throw new ApiError(403,'طلب غير مسموح');
 return user;
}
export async function body(req:Request|Response,limit=64000):Promise<unknown>{
 const reader=req.body?.getReader(); if(!reader)throw new ApiError(400,'بيانات غير صالحة');
 const chunks:Uint8Array[]=[]; let size=0;
 for(;;){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>limit){await reader.cancel();throw new ApiError(413,'الطلب أكبر من المسموح');}chunks.push(value);}
 try{return JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{throw new ApiError(400,'بيانات غير صالحة');}
}
const GENERIC_FAILURE = 'تعذر تنفيذ الطلب. لم يتم تأكيد الحفظ؛ أعد المحاولة.';

function logRequestFailure(error: unknown) {
  const err = error as {code?: unknown; errno?: unknown; stack?: unknown};
  console.error('request failed', err?.code || err?.errno || '', publicSyncError(error));
  if (typeof err?.stack === 'string') console.error(err.stack);
}

/** Admin sessions see the database code and a redacted message. Other callers keep the generic text. */
export function describeFailure(error: unknown, role: string | null) {
  logRequestFailure(error);
  if (role === 'admin') return publicSyncError(error);
  return GENERIC_FAILURE;
}

export async function endpoint(fn: () => Promise<Response>) {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof ApiError) return reply({error: e.message}, e.status);
    if (e instanceof z.ZodError) return reply({error: 'راجع الحقول المطلوبة وصيغة البيانات', fields: e.issues.map(i => i.path.join('.'))}, 400);
    let role: string | null = null;
    try {
      role = (await getCrmUser())?.role ?? null;
    } catch (lookup) {
      console.error('session lookup during error failed', lookup instanceof Error ? lookup.name : 'error');
    }
    return reply({error: describeFailure(e, role)}, 503);
  }
}
