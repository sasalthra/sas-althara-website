export type ReportPresetId = 'today' | 'week' | 'month' | '30' | 'custom';

export function nextCalendarDay(day: string): string {
  return shiftCalendarDay(day, 1);
}

export function shiftCalendarDay(day: string, days: number): string {
  const [y, m, d] = day.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + days);
  return dt.toISOString().slice(0, 10);
}

/** Days since Saturday. JavaScript Sunday=0 … Saturday=6, and the CRM week starts Saturday. */
export function daysSinceSaturday(day: string): number {
  const [y, m, d] = day.split('-').map(Number);
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return (dow + 1) % 7;
}

export function startOfRiyadhWeek(day: string): string {
  return shiftCalendarDay(day, -daysSinceSaturday(day));
}

export function reportPresetRange(id: string, today: string): {from: string; to: string} | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(today)) return null;
  if (id === 'today') return {from: today, to: today};
  if (id === 'week') return {from: startOfRiyadhWeek(today), to: today};
  if (id === 'month') return {from: `${today.slice(0, 8)}01`, to: today};
  if (id === '30') return {from: shiftCalendarDay(today, -29), to: today};
  return null;
}

export function activeReportPreset(from: string, to: string, today: string): ReportPresetId | '' {
  if (!from || !to) return '';
  for (const id of ['today', 'week', 'month', '30'] as const) {
    const range = reportPresetRange(id, today);
    if (range && range.from === from && range.to === to) return id;
  }
  return 'custom';
}
