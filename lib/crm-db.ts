import { env } from 'cloudflare:workers';
export function crmDb(){if(!env.DB)throw new Error('Database unavailable');return env.DB;}
