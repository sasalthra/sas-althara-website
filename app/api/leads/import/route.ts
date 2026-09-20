import {actor,body,endpoint,reply,ApiError} from '@/lib/secure-api';
import {importSchema} from '@/lib/lead-import';
import {runImport} from '@/lib/import-service';
export const runtime='nodejs';export const dynamic='force-dynamic';
export async function POST(req:Request){return endpoint(async()=>{
 const user=await actor(req,['admin','supervisor']);const v=importSchema.parse(await body(req,2000000));
 if(v.mode==='commit'&&!v.confirmed)throw new ApiError(400,'أكد مراجعة المعاينة قبل الاستيراد');
 if(v.mode==='preview'&&v.assignment)throw new ApiError(400,'التعيين يُرسل عند تأكيد الاستيراد فقط');
 return reply(await runImport(v.rows,v.mapping,user.userId,v.mode==='commit','excel',v.mode==='commit'?v.assignment:undefined));
});}
