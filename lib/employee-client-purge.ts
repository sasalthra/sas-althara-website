/** Shared by the admin UI and the purge API. Safe to import from client components. */
export const PURGE_CONFIRMATION_WORD = 'حذف';
export const SALES_ASSIGNMENT_SCOPE = 'assigned_to' as const;

export function confirmationMatches(employeeName: string, confirmation: string) {
  const typed = confirmation.trim().normalize('NFC');
  const name = employeeName.trim().normalize('NFC');
  if (!typed) return false;
  if (typed === PURGE_CONFIRMATION_WORD) return true;
  return name.length > 0 && typed === name;
}
