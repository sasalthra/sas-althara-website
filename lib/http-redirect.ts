import {permanentRedirect} from 'next/navigation';

/**
 * In-render fallback. The property proxy answers fragment URLs with HTTP 301
 * before this runs. permanentRedirect is the App Router permanent status (308)
 * if a request reaches the page anyway.
 */
export function redirectPermanent(pathname: string): never {
  const url = pathname.startsWith('/') ? pathname : `/${pathname}`;
  permanentRedirect(url);
}
