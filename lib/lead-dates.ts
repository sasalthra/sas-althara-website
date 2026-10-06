const riyadhDate = new Intl.DateTimeFormat('ar-SA-u-ca-gregory-nu-latn', {
  timeZone: 'Asia/Riyadh',
  day: 'numeric',
  month: 'long',
  year: 'numeric',
});

const riyadhDay = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Riyadh',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

/** Stored CRM timestamps are UTC. A date-only value is that calendar day, not a local midnight. */
function asInstant(value: string): Date | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  let normalized = trimmed;
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    normalized = `${trimmed}T00:00:00.000Z`;
  } else if (/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}/.test(trimmed) && !/(?:[zZ]|[+-]\d{2}:?\d{2})$/.test(trimmed)) {
    normalized = `${trimmed.replace(' ', 'T')}Z`;
  }
  const parsed = new Date(normalized);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export function crmInstant(value?: string | Date | null): Date | null {
  if (value == null || value === '') return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  return asInstant(value);
}

function instantOf(value?: string | Date | null): Date | null {
  return crmInstant(value);
}

/** Readable registration date in Asia/Riyadh, e.g. "27 سبتمبر 2026". */
export function formatRiyadhDate(value?: string | Date | null): string {
  const instant = instantOf(value);
  return instant ? riyadhDate.format(instant) : '';
}

/** YYYY-MM-DD in Asia/Riyadh, for titles and tests. */
export function riyadhDayKey(value?: string | Date | null): string {
  const instant = instantOf(value);
  return instant ? riyadhDay.format(instant) : '';
}
