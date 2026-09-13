import {z} from 'zod';
const time=z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
export const scheduleSchema=z.object({latitude:z.number().finite().min(-90).max(90),longitude:z.number().finite().min(-180).max(180),radius:z.number().positive().max(5000),maxAccuracy:z.number().positive().max(500),start:time,end:time,grace:z.number().int().min(0).max(120),days:z.array(z.number().int().min(0).max(6)).min(1).max(7),timezone:z.string().refine(v=>{try{new Intl.DateTimeFormat('en',{timeZone:v});return true;}catch{return false;}})}).strict().refine(s=>s.end>s.start,'الدوام الليلي يحتاج إعداداً منفصلاً');
export const pointSchema=z.object({latitude:z.number().finite().min(-90).max(90),longitude:z.number().finite().min(-180).max(180),accuracy:z.number().finite().positive()}).strict();
export function canManageSchedule(role:string){return role==='admin';}
export function localDay(now:Date,timezone:string){return new Intl.DateTimeFormat('en-CA',{timeZone:timezone,year:'numeric',month:'2-digit',day:'2-digit'}).format(now);}
export function validatePunch(schedule:unknown,point:unknown,kind:'in'|'out',existing:{check_in:string|null;check_out:string|null}|null,now:Date){
 const s=scheduleSchema.parse(schedule);const parsed=pointSchema.safeParse(point);if(!parsed.success)throw Error('الموقع غير متوفر أو غير صالح');const p=parsed.data;
 if(p.accuracy>s.maxAccuracy)throw Error('دقة الموقع غير كافية');
 const rad=(n:number)=>n*Math.PI/180;
 const a=Math.sin(rad(p.latitude-s.latitude)/2)**2+Math.cos(rad(s.latitude))*Math.cos(rad(p.latitude))*Math.sin(rad(p.longitude-s.longitude)/2)**2;
 const distance=6371000*2*Math.atan2(Math.sqrt(a),Math.sqrt(Math.max(0,1-a)));
 if(distance+p.accuracy>s.radius)throw Error('خارج النطاق المسموح أو قريب من حدوده');
 if(kind==='in'&&existing?.check_in)throw Error('الحضور مسجل مسبقاً');
 if(kind==='out'&&!existing?.check_in)throw Error('سجل الحضور أولاً');
 if(kind==='out'&&existing?.check_out)throw Error('الانصراف مسجل مسبقاً');
 const day=localDay(now,s.timezone),weekday=new Date(day+'T12:00:00Z').getUTCDay();
 if(kind==='in'&&!s.days.includes(weekday))throw Error('اليوم ليس ضمن أيام العمل المحددة');
 const clock=new Intl.DateTimeFormat('en-GB',{timeZone:s.timezone,hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(now);
 const minutes=(v:string)=>Number(v.slice(0,2))*60+Number(v.slice(3,5));
 return {day,distance:Math.round(distance),lateMinutes:kind==='in'?Math.max(0,minutes(clock)-minutes(s.start)-s.grace):0};
}
export const serviceTypes={overtime:'إضافي',permission:'استئذان',correction:'تصحيح الحضور',loan:'سلفة',expenses:'مطالبة مصروفات',leave:'إجازة',custody:'عهدة',trip:'رحلة عمل',visa:'تأشيرة خروج وعودة'} as const;
const requestDate=z.string().refine(v=>/^\d{4}-\d{2}-\d{2}$/.test(v)&&Number.isFinite(Date.parse(v))&&new Date(v).toISOString().slice(0,10)===v,'تاريخ غير صالح');
export const serviceSchema=z.object({id:z.string().uuid(),type:z.enum(['overtime','permission','correction','loan','expenses','leave','custody','trip','visa']),details:z.string().trim().min(5).max(4000),startDate:requestDate.optional(),endDate:requestDate.optional()}).strict().refine(v=>v.type!=='leave'||Boolean(v.startDate&&v.endDate),'حدد فترة الإجازة').refine(v=>(!v.startDate&&!v.endDate)||Boolean(v.startDate&&v.endDate&&v.endDate>=v.startDate),'راجع ترتيب تاريخ البداية والنهاية');

type CalendarPunch={work_day:string;check_in:string;check_out:string|null;late_minutes:number};
type CalendarLeave={type:string;status:string;start_date?:string|null;end_date?:string|null};
// A missing punch is not an inferred absence or a payroll deduction.
export function attendanceCalendar(month:string,attendance:CalendarPunch[],requests:CalendarLeave[],workDays:number[],today:string){
 if(!/^\d{4}-(0[1-9]|1[0-2])$/.test(month))throw Error('شهر غير صالح');
 const [year,m]=month.split('-').map(Number),count=new Date(Date.UTC(year,m,0)).getUTCDate();
 return Array.from({length:count},(_,i)=>{
  const day=`${month}-${String(i+1).padStart(2,'0')}`,weekday=new Date(day+'T12:00:00Z').getUTCDay();
  const punch=attendance.find(a=>a.work_day===day),leave=requests.some(r=>r.type==='leave'&&r.status==='approved'&&r.start_date&&r.end_date&&r.start_date<=day&&r.end_date>=day);
  const status=punch?(punch.late_minutes>0?'late':'present'):leave?'leave':!workDays.includes(weekday)?'off':day>today?'scheduled':'no_record';
  return {day,weekday,status,lateMinutes:punch?.late_minutes??0,checkIn:punch?.check_in??null,checkOut:punch?.check_out??null};
 });
}
