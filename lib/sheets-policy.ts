import {z} from 'zod';
import {mappingSchema} from './lead-import';
export const sheetConfigSchema=z.object({sheetId:z.string().regex(/^[a-zA-Z0-9_-]{20,100}$/),range:z.string().max(180).regex(/^[^!\r\n]+!A1:[A-Z]{1,2}1001$/),headers:z.array(z.string().max(150)).min(2).max(100),mapping:mappingSchema,enabled:z.boolean(),sourceConfirmed:z.literal(true)}).strict().refine(c=>Object.values(c.mapping).every(i=>i<c.headers.length),'ربط عمود خارج العناوين');
export type SheetConfig=z.infer<typeof sheetConfigSchema>;
export function checkSheetHeaders(config:SheetConfig,headers:unknown[]){if(config.headers.length!==headers.length||config.headers.some((h,i)=>h!==String(headers[i]??'')))throw Error('تغيرت عناوين Google Sheets؛ أوقفت المزامنة لحماية البيانات');}
