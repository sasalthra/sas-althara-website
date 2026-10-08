import {NextResponse, type NextRequest} from 'next/server';
import {loadPropertyRedirect} from '@/lib/property-catalog';

/** Old fragment listings (tg-…-m-… and tg-…-g-…) 301 to the merged offer. */
export async function proxy(request: NextRequest) {
  const parts = request.nextUrl.pathname.split('/').filter(Boolean);
  const id = parts[0] === 'properties' ? parts[1] ?? '' : '';
  if (!/^tg-\d+-[mg]-/.test(id) || parts.length !== 2) return NextResponse.next();
  try {
    const target = await loadPropertyRedirect(id);
    if (!target || target === id || !/^[A-Za-z0-9_-]{1,191}$/.test(target)) return NextResponse.next();
    const url = request.nextUrl.clone();
    url.pathname = `/properties/${target}`;
    return NextResponse.redirect(url, 301);
  } catch (error) {
    console.error('property redirect proxy failed', error);
    return NextResponse.next();
  }
}

export const config = {
  matcher: '/properties/:id',
};
