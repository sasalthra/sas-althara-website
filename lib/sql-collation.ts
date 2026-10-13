/**
 * Index-friendly comparisons for mixed collations
 * (utf8mb4_unicode_ci, utf8mb4_general_ci, ascii_bin).
 *
 * HEX(), LOWER() results, CONVERT_TZ, and two coercible strings raise
 * MySQL/MariaDB error 1267. CAST AS BINARY has no collation, so it does not
 * mix. The indexed column stays bare — wrapping it in CAST/LOWER/TRIM makes
 * the predicate non-sargable:
 *   indexed_col = CAST(other AS BINARY)
 *   col = CAST(? AS BINARY)
 *
 * On MySQL 8 that plan is a range on the index; on MariaDB 10.4 it is a ref.
 * The old CAST(LOWER(TRIM(col)) AS BINARY) plan was a full scan.
 * Never use HEX(LOWER()) or CONVERT_TZ.
 */
export function asBinary(expr: string) {
  return `CAST(${expr} AS BINARY)`;
}

/** Bare column (or other indexed expression) equals a bound parameter. */
export function paramEq(column: string) {
  return `${column} = ${asBinary('?')}`;
}

/**
 * Equality where `indexed` must stay free of functions so the optimizer can
 * use its index. The other side is cast to binary.
 */
export function indexEq(indexed: string, other: string) {
  return `${indexed} = ${asBinary(other)}`;
}

export function inParams(column: string, count: number) {
  if (count <= 0) return '1 = 0';
  return `${column} IN (${Array.from({length: count}, () => asBinary('?')).join(', ')})`;
}

/** @deprecated Use paramEq. Kept so existing call sites stay index-friendly. */
export function binEq(expr: string) {
  return paramEq(expr);
}

/** Left side is the indexed column. Right side is cast, not folded. */
export function binJoin(left: string, right: string) {
  return indexEq(left, right);
}
