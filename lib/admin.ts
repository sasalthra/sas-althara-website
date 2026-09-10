import {getChatGPTUser} from '@/app/chatgpt-auth';
export const ADMIN_EMAIL='sasalthra.sa@gmail.com';
export function isAdminIdentity(user:{email:string;userId:string}|null){return !!user&&user.email.trim().toLowerCase()===ADMIN_EMAIL&&!user.userId.startsWith('local_');}
export async function getAdmin(){const user=await getChatGPTUser();return isAdminIdentity(user)?user:null}
