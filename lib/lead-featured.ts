export type FeatureActor = {userId: string; role: string};
export type FeatureLead = {
  assigned_to?: string | null;
  stage?: string | null;
  is_featured?: unknown;
  created_at?: string | null;
};

export function isFeaturedValue(value: unknown): boolean {
  return value === true || value === 1 || value === '1';
}

/** Hidden when the featured column could not be added. Missing means the column is usable. */
export function featuredControlsEnabled(lead: {featured_available?: unknown}): boolean {
  return lead.featured_available !== 0 && lead.featured_available !== false && lead.featured_available !== '0';
}

/** Admins and supervisors, plus the sales rep currently assigned to the lead. */
export function canToggleFeatured(actor: FeatureActor, lead: FeatureLead): boolean {
  if (actor.role === 'admin' || actor.role === 'supervisor') return true;
  return actor.role === 'sales' && Boolean(actor.userId) && lead.assigned_to === actor.userId;
}

/** Unassigned lead still in «عميل جديد». The badge is this check; assignment clears it. */
export function isNewUnassignedLead(lead: FeatureLead): boolean {
  if (String(lead.assigned_to ?? '').trim()) return false;
  return String(lead.stage ?? '') === 'new';
}

/**
 * Unassigned «عميل جديد» leads stay first (newest first), above featured
 * clients, in every view that can see them. Featured clients follow, then
 * everyone else by newest registration. Assignment leaves the top group.
 */
export function compareClients<T extends FeatureLead>(a: T, b: T): number {
  const aFresh = isNewUnassignedLead(a);
  const bFresh = isNewUnassignedLead(b);
  if (aFresh !== bFresh) return Number(bFresh) - Number(aFresh);
  if (!aFresh && !bFresh) {
    const featuredDelta = Number(isFeaturedValue(b.is_featured)) - Number(isFeaturedValue(a.is_featured));
    if (featuredDelta) return featuredDelta;
  }
  return String(b.created_at || '').localeCompare(String(a.created_at || ''));
}

/**
 * Same order as compareClients, evaluated in MySQL 5.7/8 and MariaDB.
 * CASE/TRIM/IFNULL stay portable; the featured column is omitted when it
 * could not be added. Unassigned new leads are still first in that case.
 */
export function leadListOrderSql(featuredColumn: boolean): string {
  const fresh = `CASE WHEN leads.stage = 'new' AND TRIM(IFNULL(leads.assigned_to, '')) = '' THEN 0 ELSE 1 END`;
  // Featured applies only after the unassigned-new group, so a pinned new lead
  // does not jump ahead of a newer unassigned one. The constant keeps every
  // unassigned new lead tied on that key and ordered by created_at.
  const featuredAfterFresh = `CASE WHEN leads.stage = 'new' AND TRIM(IFNULL(leads.assigned_to, '')) = '' THEN 1 ELSE leads.is_featured END DESC`;
  return featuredColumn
    ? `ORDER BY ${fresh}, ${featuredAfterFresh}, leads.created_at DESC`
    : `ORDER BY ${fresh}, leads.created_at DESC`;
}
