import {acceptInboundLead, leadWebhookAuthorized, leadWebhookTokenFrom} from '@/lib/lead-intake';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

function json(body: unknown, status = 200) {
  return Response.json(body, {
    status,
    headers: {'Cache-Control': 'no-store'},
  });
}

function allowedOrigin(origin: string | null) {
  if (!origin) return false;
  try {
    const host = new URL(origin).host.toLowerCase();
    const allowed = new Set<string>(['sasalthra.sa', 'www.sasalthra.sa']);
    if (process.env.NEXTAUTH_URL) allowed.add(new URL(process.env.NEXTAUTH_URL).host.toLowerCase());
    if (process.env.PUBLIC_SITE_URL) allowed.add(new URL(process.env.PUBLIC_SITE_URL).host.toLowerCase());
    return allowed.has(host);
  } catch {
    return false;
  }
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const mode = url.searchParams.get('hub.mode');
  const token = url.searchParams.get('hub.verify_token');
  const challenge = url.searchParams.get('hub.challenge');
  if (mode === 'subscribe' && challenge) {
    if (!leadWebhookAuthorized(token)) return json({error: 'غير مصرح'}, 403);
    return new Response(challenge, {status: 200, headers: {'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store'}});
  }
  return json({ok: true});
}

export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return json({error: 'بيانات غير صالحة'}, 400);
  }
  const allowed = leadWebhookAuthorized(leadWebhookTokenFrom(req, body)) || allowedOrigin(req.headers.get('origin'));
  if (!allowed) return json({error: 'طلب غير مسموح'}, 403);
  const result = await acceptInboundLead(body, 'ad');
  if (!result.ok) return json({error: result.error}, result.status);
  return json({ok: true, id: result.id, duplicate: result.duplicate === true, ignored: result.ignored === true});
}
