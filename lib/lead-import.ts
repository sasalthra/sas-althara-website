import {z} from 'zod';
import properties from '../data/properties.json';
import {leadSchema,stageKeys} from './lead-input';
import {canonicalStage, stageLabel} from './lead-stages';

export const importFields={
  name:'اسم العميل',
  phone:'الجوال',
  propertyId:'معرف العقار',
  propertyOther:'وصف العقار / الطلب',
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

export const DEFAULT_PROPERTY_OTHER='غير محدد';
const PLACEHOLDER=/^(?:[-–—_=*.]+|null|none|n\/?a|na|nil|\(empty\)|empty|لا يوجد|بدون|غير محدد)$/i;
/** Strip tatweel, bidi marks, harakat; unify alef/ta marbuta so Excel headers like «رقم الجــــوال» match. */
export function foldHeader(value:string){
 return value
  .normalize('NFKC')
  .replace(/^\uFEFF/, '')
  .replace(/[\u0640\u200B-\u200F\u202A-\u202E\u2060-\u206F]/g,'')
  .replace(/[\u0610-\u061A\u064B-\u065F\u0670]/g,'')
  .replace(/[أإآٱ]/g,'ا')
  .replace(/ة/g,'ه')
  .replace(/ى/g,'ي')
  .replace(/[\s\u00a0\u202f]+/g,' ')
  .replace(/[_./\\,;|:]+/g,' ')
  .replace(/\s+/g,' ')
  .trim()
  .toLowerCase();
}

const requiredHeaderMatchers: {key:'name'|'phone'; test:(folded:string)=>boolean}[] = [
  {key:'name', test:h=>
    (/اسم/.test(h)&&/(عميل|زبون)/.test(h)) ||
    /^(الاسم|اسم|العميل|الزبون|name|client|customer|full\s*name)$/.test(h)
  },
  {key:'phone', test:h=>
    /جوال|هاتف|موبايل|تلفون|whatsapp/.test(h) ||
    /^(phone|mobile|tel|cell)$/.test(h)
  },
];
const optionalHeaderMatchers: {key:keyof typeof importFields; test:(folded:string)=>boolean}[] = [
  {key:'stage', test:h=>/^(حاله(\s*العميل)?|المرحله|الحاله|stage|status)$/.test(h)},
  {key:'followUp', test:h=>/متابعه|follow\s*up|^followup$/.test(h)},
  {key:'propertyId', test:h=>/^(معرف|رقم)\s*العقار$|^property\s*id$|^listing\s*id$/.test(h)},
  {key:'propertyOther', test:h=>/^(الطلب|وصف\s*العقار(\s*الاخر)?|العقار(\s*الاخر)?|property)$/.test(h)},
  {key:'source', test:h=>/^(المصدر|مصدر|source|channel)$/.test(h)},
  {key:'notes', test:h=>/^(الملاحظات|ملاحظات|ملاحظة|notes|note|comment)$/.test(h)},
];

export function suggestMapping(headers: string[]): Mapping {
  const mapping: Mapping = {};
  const used = new Set<number>();
  function apply(matchers:{key:keyof typeof importFields; test:(folded:string)=>boolean}[]){
    headers.forEach((header, index) => {
      const folded = foldHeader(header);
      if (!folded || used.has(index)) return;
      for (const {key, test} of matchers) {
        if (mapping[key] !== undefined) continue;
        if (test(folded)) {
          mapping[key] = index;
          used.add(index);
          break;
        }
      }
    });
  }
  apply(requiredHeaderMatchers);
  apply(optionalHeaderMatchers);
  return mapping;
}

function easternDigits(value:string){
 return value.replace(/[٠-٩]/g,c=>String(c.charCodeAt(0)-1632)).replace(/[۰-۹]/g,c=>String(c.charCodeAt(0)-1776));
}

export function normalizePhone(value:string){
 let v=easternDigits(value.normalize('NFKC').replace(/[\u0640\u200B-\u200F\u202A-\u202E\u2060-\u206F]/g,'')).trim();
 if(/^\d+\.?\d*e[+-]?\d+$/i.test(v)){
  const n=Number(v);
  if(Number.isFinite(n))v=String(Math.round(n));
 }
 const digits=v.replace(/[^\d]/g,'');
 let n=digits;
 if(n.startsWith('00'))n=n.slice(2);
 if(n.startsWith('966'))n=n.slice(3);
 if(n.startsWith('0'))n=n.slice(1);
 if(/^5\d{8}$/.test(n))return '+966'+n;
 if(n.length>9){
  const tail=n.slice(-9);
  if(/^5\d{8}$/.test(tail))return '+966'+tail;
  const head=n.slice(0,9);
  if(/^5\d{8}$/.test(head))return '+966'+head;
 }
 if(!v)return null;
 if(!/^[+\d\s()-]+$/.test(v)){
  v=digits.startsWith('00')||v.includes('+')||/^0?\d{9,}/.test(digits)?digits:'';
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
 const arabic=easternDigits(raw);
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

export function isBlankPropertyText(value:string){
 const folded=foldHeader(value);
 return !folded || PLACEHOLDER.test(folded);
}

function resolveProperty(mapped:Record<string,string>){
 const id=(mapped.propertyId||'').trim();
 const other=(mapped.propertyOther||'').trim();
 if(id && id!=='other' && !isBlankPropertyText(id) && properties.some(p=>p.id===id))return {propertyId:id,propertyOther:''};
 const fromOther=isBlankPropertyText(other)?'':other;
 const fromId=id && id!=='other' && !isBlankPropertyText(id)?id:'';
 const description=fromOther||fromId||DEFAULT_PROPERTY_OTHER;
 return {propertyId:'other',propertyOther:description.length>=2?description:DEFAULT_PROPERTY_OTHER};
}

function stubLead(mapped:Record<string,string>,phone:string|null,property:{propertyId:string;propertyOther:string},stage:string,followUp:string){
 return {name:mapped.name||'',phone:phone||mapped.phone||'',propertyOther:property.propertyOther,propertyId:property.propertyId,stage,followUp,source:mapped.source||'excel',notes:mapped.notes||''};
}

export function previewImport(rows:string[][],mapping:Mapping,existingPhones:string[]){
 const parsed=mappingSchema.safeParse(mapping);if(!parsed.success)throw Error('راجع ربط الأعمدة');
 const seen=new Set(existingPhones.map(normalizePhone).filter(Boolean) as string[]);
 return rows.map((raw,index)=>{
  const mapped:Record<string,string>={};for(const [key,col] of Object.entries(parsed.data))mapped[key]=String(raw[col]??'').trim();
  const warnings:string[]=[];
  const name=(mapped.name||'').trim().slice(0,100);
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
  const sourceRaw=(mapped.source||'').trim();
  const source=(isBlankPropertyText(sourceRaw)?'excel':sourceRaw).slice(0,80)||'excel';
  const notes=(mapped.notes||'').slice(0,3000);
  const followUp=followUpParsed||'';
  const display=stubLead({...mapped,name,source,notes},phone,property,stage,followUp);
  const base={row:index+1,raw,warnings};
  if(!name)return {...base,status:'invalid' as const,errors:['name'],lead:display};
  if(!phone)return {...base,status:'invalid' as const,errors:['phone'],lead:display};
  const v=leadSchema.safeParse({
   id:crypto.randomUUID(),
   name,
   phone,
   propertyId:property.propertyId,
   propertyOther:property.propertyOther||DEFAULT_PROPERTY_OTHER,
   source,
   notes,
   followUp,
   stage,
  });
  if(!v.success){
   const optional=new Set(['propertyOther','propertyId','source','notes','followUp','stage']);
   const required=v.error.issues.map(i=>String(i.path[0])).filter(field=>!optional.has(field));
   if(!required.length){
    const forced={id:crypto.randomUUID(),name,phone,propertyId:'other' as const,propertyOther:DEFAULT_PROPERTY_OTHER,source,notes,followUp,stage};
    if(seen.has(phone))return {...base,status:'duplicate' as const,errors:['رقم جوال مكرر؛ لم يستبدل السجل الأصلي'],lead:forced};
    seen.add(phone);return {...base,status:'ready' as const,errors:[],lead:forced};
   }
   return {...base,status:'invalid' as const,errors:required,lead:display};
  }
  if(seen.has(phone))return {...base,status:'duplicate' as const,errors:['رقم جوال مكرر؛ لم يستبدل السجل الأصلي'],lead:v.data};
  seen.add(phone);return {...base,status:'ready' as const,errors:[],lead:v.data};
 });
}

export function assigneesForReady(count:number,assignment?:Assignment){
 if(!assignment||assignment.mode==='unassigned'||!assignment.userIds.length)return Array.from({length:count},()=>'');
 if(assignment.mode==='one')return Array.from({length:count},()=>assignment.userIds[0]);
 return Array.from({length:count},(_,i)=>assignment.userIds[i%assignment.userIds.length]);
}
