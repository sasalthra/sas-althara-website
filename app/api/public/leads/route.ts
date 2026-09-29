import {acceptInboundLead} from '@/lib/lead-intake';

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
    const allowed = new Set<string>([
      'localhost:3000',
      '127.0.0.1:3000',
      'localhost:5173',
      '127.0.0.1:5173',
      'sasalthra.sa',
      'www.sasalthra.sa',
    ]);
    if (process.env.NEXTAUTH_URL) {
      allowed.add(new URL(process.env.NEXTAUTH_URL).host.toLowerCase());
    }
    if (process.env.PUBLIC_SITE_URL) {
      allowed.add(new URL(process.env.PUBLIC_SITE_URL).host.toLowerCase());
    }
    return allowed.has(host);
  } catch {
    return false;
  }
}

export async function POST(req: Request) {
  const origin = req.headers.get('origin');
  if (!allowedOrigin(origin)) {
    return json({error: 'طلب غير مسموح'}, 403);
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return json({error: 'بيانات غير صالحة'}, 400);
  }

  const record = body && typeof body === 'object' ? (body as Record<string, unknown>) : {};
  const fallback = typeof record.source === 'string' && record.source.trim() ? record.source.trim() : 'calculate-loan';
  const result = await acceptInboundLead(body, fallback);
  if (!result.ok) return json({error: result.error}, result.status);
  return json({ok: true, id: result.id, duplicate: result.duplicate === true});
}
