/** Who may multi-select clients. Admin is «مدير»; supervisor is the other manager role. */
export function canBulkSelect(role: string) {
  return role === 'admin' || role === 'supervisor';
}

/** Permanent delete stays with the admin. Sales and field are rejected. */
export function canBulkDelete(role: string) {
  return role === 'admin';
}
