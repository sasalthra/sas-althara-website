import 'server-only';
import {createSign} from 'node:crypto';
import {z} from 'zod';
import {body,ApiError} from './secure-api';
import {checkSheetHeaders,type SheetConfig} from './sheets-policy';
export async function fetchSheet(config:SheetConfig){
 const email=process.env.GOOGLE_SHEETS_CLIENT_EMAIL,privateKey=process.env.GOOGLE_SHEETS_PRIVATE_KEY;
 if(!email||!privateKey)throw new ApiError(409,'يلزم إعداد حساب خدمة Google Sheets على الخادم');
 const now=Math.floor(Date.now()/1000),encode=(v:unknown)=>Buffer.from(JSON.stringify(v)).toString('base64url');
 const unsigned=encode({alg:'RS256',typ:'JWT'})+'.'+encode({iss:email,scope:'https://www.googleapis.com/auth/spreadsheets.readonly',aud:'https://oauth2.googleapis.com/token',iat:now,exp:now+300});
 const signer=createSign('RSA-SHA256');signer.update(unsigned);const assertion=unsigned+'.'+signer.sign(privateKey.replace(/\\n/g,'\n'),'base64url');
 const tokenResponse=await fetch('https://oauth2.googleapis.com/token',{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},body:new URLSearchParams({grant_type:'urn:ietf:params:oauth:grant-type:jwt-bearer',assertion}),signal:AbortSignal.timeout(15000),redirect:'error'});
 if(!tokenResponse.ok)throw new ApiError(502,'تعذر توثيق Google Sheets');
 const token=z.object({access_token:z.string().min(1)}).parse(await body(tokenResponse,20000));
 const response=await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${config.sheetId}/values/${encodeURIComponent(config.range)}?valueRenderOption=FORMATTED_VALUE`,{headers:{Authorization:`Bearer ${token.access_token}`},signal:AbortSignal.timeout(20000),redirect:'error',cache:'no-store'});
 if(!response.ok)throw new ApiError(502,'تعذر قراءة مصدر العملاء؛ راجع المشاركة والنطاق');
 const result=z.object({values:z.array(z.array(z.union([z.string(),z.number(),z.boolean()])).max(100)).max(1001)}).parse(await body(response,2000000));
 checkSheetHeaders(config,result.values[0]||[]);
 return result.values.slice(1).map(r=>r.map(String));
}
