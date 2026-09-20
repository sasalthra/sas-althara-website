import {z} from 'zod';
import properties from '../data/properties.json';
import {leadSchema,stageKeys} from './lead-input';
import {canonicalStage, stageLabel} from './lead-stages';

export const importFields={
  name:'اسم العميل',
  phone:'الجوال',
  propertyId:'معرف العقار',
  propertyOther:'وصف العقار الآخر',
  source:'المصدر',
  notes:'الملاحظات',
  followUp:'تاريخ المتابعة',
  stage:'حالة العميل / المرحلة',
};
export type Mapping=Partial<Record<keyof typeof importFields,number>>;
export const mappingSchema=z.record(
  z.enum(['name','phone','propertyId','propertyOther','source','notes','followUp','stage']),
  z.number().int().min(0).max(99)
).refine(m=>m.name!==undefined&&m.phone!==undefined&&new Set(Object.values(m)).size===Object.values(m).length,'راجع ربط الأعمدة: الاسم والجوال مطلوبان ولا يجوز تكرار العمود');

export const assignmentSchema=z.object({
  mode:z.enum(['unassigned','one','distribute']),
  userIds:z.array(z.string().uuid()).max(80).default([]),
}).strict().superRefine((v,ctx)=>{
  if(v.mode==='one'&&v.userIds.length!==1)ctx.addIssue({code:'custom',message:'اختر مندوباً واحداً لتعيين كل العملاء'});
  if(v.mode==='distribute'&&v.userIds.length<2)ctx.addIssue({code:'custom',message:'اختر مندوبين أو أكثر للتوزيع بالتساوي'});
  if(v.mode==='unassigned'&&v.userIds.length)ctx.addIssue({code:'custom',message:'بدون تعيين لا يحتاج قائمة مناديب'});
  if(new Set(v.userIds).size!==v.userIds.length)ctx.addIssue({code:'custom',message:'لا تكرر المندوب في قائمة التوزيع'});
});
export type Assignment=z.infer<typeof assignmentSchema>;

export const importSchema=z.object({
  rows:z.array(z.array(z.string().max(4000)).max(100)).min(1).max(1000),
  mapping:mappingSchema,
  mode:z.enum(['preview','commit']),
  confirmed:z.boolean().default(false),
  assignment:assignmentSchema.optional(),
}).strict();

const DEFAULT_PROPERTY_OTHER='غير محدد';
const headerMatchers: [keyof typeof importFields, RegExp][] = [
  ['name', /^(اسم\s*العميل|اسم\s*الزبون|الاسم|العميل|الزبون|name|client|full\s*name)$/i],
  ['phone', /^(الجوال|الهاتف|رقم\s*الجوال|رقم\s*الهاتف|جوال|هاتف|phone|mobile|whatsapp)$/i],
  ['stage', /^(حاله\s*العميل|حالة\s*العميل|المرحله|المرحلة|الحاله|الحالة|stage|status)$/i],
  ['followUp', /^(تاريخ\s*المتابعه|تاريخ\s*المتابعة|موعد\s*المتابعه|موعد\s*المتابعة|المتابعه|المتابعة|follow\s*up|followup)$/i],
  ['propertyId', /^(معرف\s*العقار|رقم\s*العقار|property\s*id|listing\s*id)$/i],
  ['propertyOther', /^(وصف\s*العقار\s*الاخر|وصف\s*العقار\s*الآخر|وصف\s*العقار|العقار\s*الاخر|العقار\s*الآخر|العقار|property)$/i],
  ['source', /^(المصدر|مصدر|source|channel)$/i],
  ['notes', /^(الملاحظات|ملاحظات|ملاحظة|notes|note|comment)$/i],
];

export function suggestMapping(headers: string[]): Mapping {
  const mapping: Mapping = {};
  const used = new Set<number>();
  headers.forEach((header, index) => {
    const folded = header.normalize('NFKC').replace(/[أإآٱ]/g, 'ا').replace(/ة/g, 'ه').replace(/ى/g, 'ي').replace(/\s+/g, ' ').trim();
    for (const [key, pattern] of headerMatchers) {
      if (mapping[key] !== undefined || used.has(index)) continue;
      if (pattern.test(folded)) {
        mapping[key] = index;
        used.add(index);
        break;
      }
    }
  });
  return mapping;
}

export function normalizePhone(value:string){
 let v=value.trim().replace(/[٠-٩]/g,c=>String(c.charCodeAt(0)-1632)).replace(/[۰-۹]/g,c=>String(c.charCodeAt(0)-1776));
 if(!/^[+\d\s()-]+$/.test(v)){
  const extracted=v.replace(/[^\d+]/g,'');
  v=extracted.startsWith('00')||extracted.startsWith('+')||/^0?\d{9,}/.test(extracted)?extracted:'';
 }
 if(!v)return null;
 v=v.replace(/[\s()-]/g,'');if(v.startsWith('00'))v='+'+v.slice(2);
 if(/^05\d{8}$/.test(v))v='+966'+v.slice(1);else if(/^5\d{8}$/.test(v))v='+966'+v;else if(/^9665\d{8}$/.test(v))v='+'+v;
 return /^\+[1-9]\d{7,14}$/.test(v)?v:null;
}

function isCalendarDate(value:string){
 return /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0,10) === value;
}

/** Empty → ''; valid calendar date → YYYY-MM-DD; unreadable → null (caller warns, does not invent). */
export function parseFollowUpDate(value:string):string|null{
 const raw=value.trim();
 if(!raw)return '';
 if(isCalendarDate(raw))return raw;
 const iso=raw.match(/^(\d{4}-\d{2}-\d{2})[ T].*/);
 if(iso&&isCalendarDate(iso[1]))return iso[1];
 const arabic=raw.replace(/[٠-٩]/g,c=>String(c.charCodeAt(0)-1632)).replace(/[۰-۹]/g,c=>String(c.charCodeAt(0)-1776));
 const dmy=arabic.match(/^(\d{1,2})[/.+-](\d{1,2})[/.+-](\d{4})$/);
 if(dmy){
  const day=dmy[1].padStart(2,'0'),month=dmy[2].padStart(2,'0'),year=dmy[3];
  const preferred=`${year}-${month}-${day}`;
  if(isCalendarDate(preferred))return preferred;
  const us=`${year}-${day}-${month}`;
  if(isCalendarDate(us))return us;
 }
 if(/^\d{4,6}(\.\d+)?$/.test(arabic)){
  const serial=Math.round(Number(arabic));
  if(serial>=20000&&serial<=80000){
   const date=new Date(Date.UTC(1899,11,30)+serial*86400000);
   const isoDate=date.toISOString().slice(0,10);
   if(isCalendarDate(isoDate))return isoDate;
  }
 }
 return null;
}

function resolveProperty(mapped:Record<string,string>){
 const id=(mapped.propertyId||'').trim();
 const other=(mapped.propertyOther||'').trim();
 if(id && id!=='other' && properties.some(p=>p.id===id))return {propertyId:id,propertyOther:''};
 const description=other||(id && id!=='other'?id:'')||DEFAULT_PROPERTY_OTHER;
 return {propertyId:'other',propertyOther:description};
}

export function previewImport(rows:string[][],mapping:Mapping,existingPhones:string[]){
 const parsed=mappingSchema.safeParse(mapping);if(!parsed.success)throw Error('راجع ربط الأعمدة');
 const seen=new Set(existingPhones.map(normalizePhone).filter(Boolean));
 return rows.map((raw,index)=>{
  const mapped:Record<string,string>={};for(const [key,col] of Object.entries(parsed.data))mapped[key]=raw[col]?.trim()||'';
  const warnings:string[]=[];
  const phone=normalizePhone(mapped.phone||'');
  const property=resolveProperty(mapped);
  const followUpParsed=parseFollowUpDate(mapped.followUp||'');
  if((mapped.followUp||'').trim() && followUpParsed===null){
   warnings.push(`تاريخ المتابعة «${mapped.followUp.trim()}» غير مفهوم؛ استورد بدون موعد`);
  }
  let stage:(typeof stageKeys)[number]='new';
  const stageCell=(mapped.stage||'').trim();
  if(stageCell){
   const resolved=canonicalStage(stageCell);
   if(resolved&&(stageKeys as readonly string[]).includes(resolved))stage=resolved as (typeof stageKeys)[number];
   else warnings.push(`مرحلة غير معروفة «${stageCell}»؛ استُخدمت «${stageLabel('new')}» دون إنشاء مرحلة جديدة`);
  }
  const v=leadSchema.safeParse({
   id:crypto.randomUUID(),
   name:mapped.name||'',
   phone:phone||'',
   propertyId:property.propertyId,
   propertyOther:property.propertyOther,
   source:mapped.source||'excel',
   notes:mapped.notes||'',
   followUp:followUpParsed||'',
   stage,
  });
  const base={row:index+1,raw,warnings};
  if(!v.success)return {...base,status:'invalid' as const,errors:v.error.issues.map(i=>String(i.path[0])),lead:null};
  if(seen.has(phone))return {...base,status:'duplicate' as const,errors:['رقم جوال مكرر؛ لم يستبدل السجل الأصلي'],lead:v.data};
  seen.add(phone);return {...base,status:'ready' as const,errors:[],lead:v.data};
 });
}

export function assigneesForReady(count:number,assignment?:Assignment){
 if(!assignment||assignment.mode==='unassigned'||!assignment.userIds.length)return Array.from({length:count},()=>'');
 if(assignment.mode==='one')return Array.from({length:count},()=>assignment.userIds[0]);
 return Array.from({length:count},(_,i)=>assignment.userIds[i%assignment.userIds.length]);
}
