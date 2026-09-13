import {z} from 'zod';
import properties from '../data/properties.json';
export const stageKeys = ['new','received','no_answer','contacted','data_received','calculation_done','visit_qualified','property_visited','bank_approval','deposit_paid','contract_signed','transferred','unqualified','not_interested','viewing','negotiation','won','closed'] as const;
export const leadSchema = z.object({
  id:z.string().uuid(), name:z.string().trim().min(2).max(100),
  phone:z.string().trim().regex(/^[+\d\s()-]{7,22}$/),
  propertyId:z.string().refine(id => id === 'other' || properties.some(p => p.id === id)),
  propertyOther:z.string().trim().max(500).default(''),
  source:z.string().trim().min(1).max(80).default('manual'),
  notes:z.string().max(3000).default(''), stage:z.enum(stageKeys).default('new'),
  followUp:z.string().refine(value => value === '' || (/^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0,10) === value)).default(''),
  assignedTo:z.string().uuid().nullable().optional(), fieldAssignedTo:z.string().uuid().nullable().optional(),
}).superRefine((v,ctx) => {if(v.propertyId === 'other' && v.propertyOther.length < 2) ctx.addIssue({code:'custom',path:['propertyOther'],message:'اكتب وصف العقار الآخر'});});
