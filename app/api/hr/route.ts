import {z} from 'zod';
import {crmDb,crmTransaction} from '@/lib/crm-db';
import {actor,body,endpoint,reply,ApiError} from '@/lib/secure-api';
import {scheduleSchema,pointSchema,validatePunch,localDay,serviceSchema,canManageSchedule} from '@/lib/hr-policy';
export const runtime='nodejs';export const dynamic='force-dynamic';
const profileSchema=z.object({userId:z.string().uuid(),jobTitle:z.string().trim().max(100),department:z.string().trim().max(100),leaveBalance:z.number().min(0).max(365),schedule:scheduleSchema});
function json(v:unknown){return typeof v==='string'?JSON.parse(v):v;}
export async function GET(req:Request){return endpoint(async()=>{
 const user=await actor(),db=crmDb(),admin=canManageSchedule(user.role);
 const month=z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/).parse(new URL(req.url).searchParams.get('month')||new Date().toISOString().slice(0,7));
 const profiles=await db.prepare(`SELECT p.*,u.name FROM hr_profiles p JOIN crm_users u ON u.id=p.user_id ${admin?'':'WHERE p.user_id=?'} ORDER BY u.name`).bind(...(admin?[]:[user.userId])).all();
 const attendance=await db.prepare(`SELECT * FROM hr_attendance WHERE work_day LIKE ? ${admin?'':'AND user_id=?'} ORDER BY work_day DESC`).bind(`${month}-%`,...(admin?[]:[user.userId])).all();
 const calendarLeaves=await db.prepare(`SELECT user_id,type,status,start_date,end_date FROM hr_requests WHERE type='leave' AND status='approved' AND start_date<=? AND end_date>=? ${admin?'':'AND user_id=?'}`).bind(`${month}-31`,`${month}-01`,...(admin?[]:[user.userId])).all();
 const requests=await db.prepare(`SELECT r.*,u.name FROM hr_requests r LEFT JOIN crm_users u ON u.id=r.user_id ${admin?'':'WHERE r.user_id=?'} ORDER BY r.created_at DESC LIMIT 200`).bind(...(admin?[]:[user.userId])).all();
 const announcements=await db.prepare('SELECT id,title,details,created_at FROM hr_announcements ORDER BY created_at DESC LIMIT 30').all();
 return reply({userId:user.userId,month,calendarLeaves:calendarLeaves.results,profiles:profiles.results.map(p=>({...p,schedule:json(p.schedule)})),attendance:attendance.results,requests:requests.results,announcements:announcements.results,serverTime:new Date().toISOString()});
});}
export async function POST(req:Request){return endpoint(async()=>{
 const user=await actor(req),raw=z.object({action:z.enum(['profile','punch','request','review','announcement'])}).passthrough().parse(await body(req));
 if(['profile','review','announcement'].includes(raw.action)&&!canManageSchedule(user.role))throw new ApiError(403,'تعديل الدوام والاعتماد للإدارة فقط');
 const now=new Date(),stamp=now.toISOString();let target=user.userId;
 await crmTransaction(async db=>{
 if(raw.action==='profile'){
  const v=profileSchema.parse(raw.data);target=v.userId;
  if(!await db.prepare('SELECT id FROM crm_users WHERE id=? AND active=1').bind(v.userId).first())throw new ApiError(404,'الموظف غير موجود');
  await db.prepare('INSERT INTO hr_profiles (user_id,job_title,department,leave_balance,schedule,updated_at) VALUES (?,?,?,?,?,?) ON DUPLICATE KEY UPDATE job_title=VALUES(job_title),department=VALUES(department),leave_balance=VALUES(leave_balance),schedule=VALUES(schedule),updated_at=VALUES(updated_at)').bind(v.userId,v.jobTitle,v.department,v.leaveBalance,JSON.stringify(v.schedule),stamp).run();
 } else if(raw.action==='punch'){
  const v=z.object({id:z.string().uuid(),kind:z.enum(['in','out']),point:pointSchema}).parse(raw);target=v.id;
  // Lock the employee row: serializes concurrent punches even before today's attendance row exists.
  const profile=await db.prepare('SELECT schedule FROM hr_profiles WHERE user_id=? FOR UPDATE').bind(user.userId).first<{schedule:unknown}>();
  if(!profile)throw new ApiError(409,'لم تضبط الإدارة الدوام والموقع بعد');
  const s=scheduleSchema.parse(json(profile.schedule)),day=localDay(now,s.timezone);
  const row=await db.prepare('SELECT * FROM hr_attendance WHERE user_id=? AND work_day=?').bind(user.userId,day).first<{check_in:string|null;check_out:string|null;in_key:string;out_key:string|null}>();
  if(row&&(v.kind==='in'?row.in_key:row.out_key)===v.id)return;
  let checked;try{checked=validatePunch(s,v.point,v.kind,row,now);}catch(e){throw new ApiError(409,e instanceof Error?e.message:'تعذر التسجيل');}
  if(v.kind==='in')await db.prepare('INSERT INTO hr_attendance (user_id,work_day,check_in,late_minutes,in_key,in_distance,in_accuracy) VALUES (?,?,?,?,?,?,?)').bind(user.userId,day,stamp,checked.lateMinutes,v.id,checked.distance,v.point.accuracy).run();
  else await db.prepare('UPDATE hr_attendance SET check_out=?,out_key=?,out_distance=?,out_accuracy=? WHERE user_id=? AND work_day=? AND check_out IS NULL').bind(stamp,v.id,checked.distance,v.point.accuracy,user.userId,day).run();
 } else if(raw.action==='request'){
  const v=serviceSchema.parse(raw.data);target=v.id;
  await db.prepare('INSERT INTO hr_requests (id,user_id,type,details,status,created_at,start_date,end_date) VALUES (?,?,?,?,?,?,?,?)').bind(v.id,user.userId,v.type,v.details,'pending',stamp,v.startDate??null,v.endDate??null).run();
 } else if(raw.action==='review'){
  const v=z.object({id:z.string().uuid(),status:z.enum(['approved','rejected']),note:z.string().trim().min(3).max(2000)}).parse(raw.data);target=v.id;
  const r=await db.prepare("UPDATE hr_requests SET status=?,review_note=?,reviewed_by=?,reviewed_at=? WHERE id=? AND status='pending' AND user_id<>?").bind(v.status,v.note,user.userId,stamp,v.id,user.userId).run();
  if(!r.meta.changes)throw new ApiError(409,'الطلب غير متاح أو لا يمكنك اعتماد طلبك');
 } else {
  const v=z.object({title:z.string().trim().min(2).max(150),details:z.string().trim().min(2).max(3000)}).parse(raw.data);target=crypto.randomUUID();
  await db.prepare('INSERT INTO hr_announcements (id,title,details,created_at) VALUES (?,?,?,?)').bind(target,v.title,v.details,stamp).run();
 }
 await db.prepare('INSERT INTO crm_audit (id,actor_id,action,target_id,details,created_at) VALUES (?,?,?,?,?,?)').bind(crypto.randomUUID(),user.userId,`hr.${raw.action}`,target,'{}',stamp).run();
 });return reply({ok:true});
});}
