export type FeatureActor = {userId: string; role: string};
export type FeatureLead = {assigned_to?: string | null; is_featured?: unknown; created_at?: string | null};

export function isFeaturedValue(value: unknown): boolean {
  return value === true || value === 1 || value === '1';
}

/** Admins and supervisors, plus the sales rep currently assigned to the lead. */
export function canToggleFeatured(actor: FeatureActor, lead: FeatureLead): boolean {
  if (actor.role === 'admin' || actor.role === 'supervisor') return true;
  return actor.role === 'sales' && Boolean(actor.userId) && lead.assigned_to === actor.userId;
}

/** Featured clients first, then the existing newest-registration order. */
export function compareClients<T extends FeatureLead>(a: T, b: T): number {
  const featuredDelta = Number(isFeaturedValue(b.is_featured)) - Number(isFeaturedValue(a.is_featured));
  if (featuredDelta) return featuredDelta;
  return String(b.created_at || '').localeCompare(String(a.created_at || ''));
}
