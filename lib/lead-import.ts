import {z} from 'zod';
import {leadSchema} from './lead-input';
export const importFields={name:'اسم العميل',phone:'الجوال',propertyId:'معرف العقار',propertyOther:'وصف العقار الآخر',source:'المصدر',notes:'الملاحظات',followUp:'تاريخ المتابعة'};
export type Mapping=Partial<Record<keyof typeof importFields,number>>;
export const mappingSchema=z.record(z.enum(['name','phone','propertyId','propertyOther','source','notes','followUp']),z.number().int().min(0).max(99)).refine(m=>m.name!==undefined&&m.phone!==undefined&&new Set(Object.values(m)).size===Object.values(m).length,'راجع ربط الأعمدة: الاسم والجوال مطلوبان ولا يجوز تكرار العمود');
export const importSchema=z.object({rows:z.array(z.array(z.string().max(4000)).max(100)).min(1).max(1000),mapping:mappingSchema,mode:z.enum(['preview','commit']),confirmed:z.boolean().default(false)}).strict();
export function normalizePhone(value:string){
 let v=value.trim().replace(/[٠-٩]/g,c=>String(c.charCodeAt(0)-1632)).replace(/[۰-۹]/g,c=>String(c.charCodeAt(0)-1776));
 if(!/^[+\d\s()-]+$/.test(v))return null;
 v=v.replace(/[\s()-]/g,'');if(v.startsWith('00'))v='+'+v.slice(2);
 if(/^05\d{8}$/.test(v))v='+966'+v.slice(1);else if(/^5\d{8}$/.test(v))v='+966'+v;else if(/^9665\d{8}$/.test(v))v='+'+v;
 return /^\+[1-9]\d{7,14}$/.test(v)?v:null;
}
export function previewImport(rows:string[][],mapping:Mapping,existingPhones:string[]){
 const parsed=mappingSchema.safeParse(mapping);if(!parsed.success)throw Error('راجع ربط الأعمدة');
 const seen=new Set(existingPhones.map(normalizePhone).filter(Boolean));
 return rows.map((raw,index)=>{
  const mapped:Record<string,string>={};for(const [key,col] of Object.entries(parsed.data))mapped[key]=raw[col]?.trim()||'';
  const phone=normalizePhone(mapped.phone||'');
  const v=leadSchema.safeParse({id:crypto.randomUUID(),...mapped,phone:phone||'',propertyId:mapped.propertyId||'other',propertyOther:mapped.propertyOther||'',source:mapped.source||'excel'});
  const base={row:index+1,raw};
  if(!v.success)return {...base,status:'invalid' as const,errors:v.error.issues.map(i=>String(i.path[0])),lead:null};
  if(seen.has(phone))return {...base,status:'duplicate' as const,errors:['رقم جوال مكرر؛ لم يستبدل السجل الأصلي'],lead:v.data};
  seen.add(phone);return {...base,status:'ready' as const,errors:[],lead:v.data};
 });
}
