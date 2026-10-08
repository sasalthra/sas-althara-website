/**
 * Byte comparison for mixed collations (utf8mb4_unicode_ci, utf8mb4_general_ci, ascii_bin).
 * HEX(), LOWER() results, CONVERT_TZ, and string literals are coercible and raise
 * MySQL/MariaDB error 1267 when two of them use different collations.
 * CAST AS BINARY on both sides has no collation. Never use HEX(LOWER()) or CONVERT_TZ.
 */
export function asBinary(expr: string) {
  return `CAST(${expr} AS BINARY)`;
}
export function folded(expr: string) {
  return asBinary(`LOWER(TRIM(${expr}))`);
}
export function binEq(expr: string) {
  return `${folded(expr)}=${folded('?')}`;
}
export function binJoin(left: string, right: string) {
  return `${folded(left)}=${folded(right)}`;
}
