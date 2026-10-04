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
 * Featured clients stay first. For admins, unassigned «عميل جديد» leads come
 * next, then everyone else by newest registration.
 */
export function compareClients<T extends FeatureLead>(
  a: T,
  b: T,
  options?: {promoteNewUnassigned?: boolean}
): number {
  const featuredDelta = Number(isFeaturedValue(b.is_featured)) - Number(isFeaturedValue(a.is_featured));
  if (featuredDelta) return featuredDelta;
  if (options?.promoteNewUnassigned) {
    const freshDelta = Number(isNewUnassignedLead(b)) - Number(isNewUnassignedLead(a));
    if (freshDelta) return freshDelta;
  }
  return String(b.created_at || '').localeCompare(String(a.created_at || ''));
}
