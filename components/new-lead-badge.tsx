import {isNewUnassignedLead, type FeatureLead} from '@/lib/lead-featured';

/** Animated NEW mark. Hidden once assigned_to is set; no stored flag. */
export default function NewLeadBadge({lead}: {lead: FeatureLead}) {
  if (!isNewUnassignedLead(lead)) return null;
  return (
    <span className="new-lead-badge" aria-label="جديد غير مسند">
      NEW
    </span>
  );
}
