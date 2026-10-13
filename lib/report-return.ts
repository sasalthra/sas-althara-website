/** Report view state lives in the CRM query string so Back can reopen the same list. */

export type ReportLocationInput = {
  module?: string;
  from?: string;
  to?: string;
  reportEmployee?: string;
  source?: string;
  stage?: string;
  funding?: string;
  page?: string | number;
  pageSize?: string | number;
};

const SCROLL_STORAGE = 'sas-report-scroll';

export function buildReportPath(input: ReportLocationInput): string {
  const query = new URLSearchParams();
  query.set('tab', 'reports');
  const moduleName = String(input.module || '').trim();
  if (moduleName && moduleName !== 'overview') query.set('module', moduleName);
  const set = (key: string, value: string | number | undefined) => {
    const text = String(value ?? '').trim();
    if (!text) return;
    if (key === 'page' && text === '1') return;
    if (key === 'pageSize' && text === '25') return;
    query.set(key, text);
  };
  set('from', input.from);
  set('to', input.to);
  set('reportEmployee', input.reportEmployee);
  set('source', input.source);
  set('stage', input.stage);
  set('funding', input.funding);
  set('page', input.page);
  set('pageSize', input.pageSize);
  return '/crm?' + query.toString();
}

/** Same report, ignoring param order, so scroll survives a URL rewrite that only fills defaults. */
export function reportScrollKey(path: string): string {
  const raw = path.includes('?') ? path.slice(path.indexOf('?') + 1) : path;
  const query = new URLSearchParams(raw);
  return [
    'reports',
    query.get('module') || '',
    query.get('reportEmployee') || '',
    query.get('stage') || '',
    query.get('source') || '',
    query.get('from') || '',
    query.get('to') || '',
    query.get('funding') || '',
    query.get('page') || '1',
    query.get('pageSize') || '25',
  ].join('\u001f');
}

/**
 * Only an in-app CRM URL may be used as the lead page's back target.
 * `from` is accepted when it is already a path, so it does not collide with a date.
 */
export function safeCrmReturn(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let value = raw.trim();
  if (!value || value.length > 2000) return null;
  // Search params are already decoded once. Decode only a fully encoded path,
  // and leave inner encodings such as %26 in a filter value untouched.
  if (!value.startsWith('/') && value.includes('%')) {
    try {
      const decoded = decodeURIComponent(value);
      if (!decoded || decoded.includes('\0')) return null;
      value = decoded.trim();
    } catch {
      return null;
    }
  }
  if (!value.startsWith('/crm') || value.startsWith('//') || value.startsWith('/\\')) return null;
  if (value.includes('\\') || value.includes('://') || /[\u0000-\u001f\u007f]/.test(value)) return null;
  const hashAt = value.indexOf('#');
  const beforeHash = hashAt >= 0 ? value.slice(0, hashAt) : value;
  if (beforeHash !== '/crm' && !beforeHash.startsWith('/crm?')) return null;
  return value;
}

export function leadReturnHref(leadId: string, reportPath: string): string {
  const back = safeCrmReturn(reportPath) || '/crm?tab=reports';
  return `/crm/leads/${encodeURIComponent(leadId)}?returnTo=${encodeURIComponent(back)}`;
}

export function rememberReportScroll(path: string) {
  if (typeof window === 'undefined' || typeof sessionStorage === 'undefined') return;
  try {
    sessionStorage.setItem(SCROLL_STORAGE, JSON.stringify({
      key: reportScrollKey(path),
      y: window.scrollY,
    }));
  } catch {
    /* private mode */
  }
}

export function restoreReportScroll(path: string) {
  if (typeof window === 'undefined' || typeof sessionStorage === 'undefined') return;
  try {
    const raw = sessionStorage.getItem(SCROLL_STORAGE);
    if (!raw) return;
    const saved = JSON.parse(raw) as {key?: string; y?: number};
    if (!saved || saved.key !== reportScrollKey(path)) return;
    const y = Number(saved.y) || 0;
    if (y <= 0) return;
    const apply = () => window.scrollTo(0, y);
    requestAnimationFrame(() => {
      apply();
      requestAnimationFrame(apply);
    });
  } catch {
    /* ignore a bad snapshot */
  }
}
