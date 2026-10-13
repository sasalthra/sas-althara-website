import assert from 'node:assert/strict';

/**
 * node:sqlite treats CAST(x AS BINARY) as numeric, and TEXT = CAST(x AS BLOB)
 * does not match. Report and lead SQL casts only the non-indexed side so MySQL
 * can use an index. Tests compare the original strings, and leave real
 * expression casts (SUBSTR/REPLACE) as BLOBs.
 */
export function sqliteReportSql(sql) {
  const simple = String.raw`(\?|(?:\`?\w+\`?\.)*\`?\w+\`?|'(?:[^']|'')*')`;
  const cast = `CAST\\(\\s*${simple}\\s+AS BINARY\\s*\\)`;
  let text = String(sql).replace(
    new RegExp(`((?:\\b\`?\\w+\`?\\.)?\`?\\w+\`?)\\s*=\\s*${cast}`, 'gi'),
    '$1 = $2'
  );
  const paramCast = /CAST\(\s*(\?|(?:`?\w+`?\.)*`?\w+`?)\s+AS BINARY\s*\)/gi;
  text = text.replace(paramCast, (match, inner, offset, whole) => {
    const before = whole.slice(0, offset);
    if (/\bIN\s*\([^)]*$/i.test(before)) return inner;
    return match;
  });
  return text.replaceAll(' AS BINARY', ' AS BLOB');
}

function skipSpace(sql, index, dir) {
  let i = index;
  while (sql[i] === ' ' || sql[i] === '\n' || sql[i] === '\t') i += dir;
  return i;
}

function binarySide(sql, index, dir) {
  let i = skipSpace(sql, index, dir);
  if (dir > 0) {
    if (!/^CAST\s*\(/i.test(sql.slice(i))) return false;
    const open = sql.indexOf('(', i);
    let depth = 0;
    for (let j = open; j < sql.length; j++) {
      if (sql[j] === '(') depth++;
      else if (sql[j] === ')') {
        depth--;
        if (depth === 0) return / AS BINARY\)$/.test(sql.slice(i, j + 1));
      }
    }
    return false;
  }
  if (sql[i] !== ')') return false;
  let depth = 0;
  for (let j = i; j >= 0; j--) {
    if (sql[j] === ')') depth++;
    else if (sql[j] === '(') {
      depth--;
      if (depth === 0) {
        const head = sql.slice(0, j);
        return /CAST\s*$/i.test(head) && / AS BINARY\)$/.test(sql.slice(head.search(/CAST\s*$/i), i + 1));
      }
    }
  }
  return false;
}

/**
 * Id/key predicates keep the column bare and cast the other side.
 * Date expressions may still be CAST AS BINARY on both sides.
 * HEX(), CONVERT_TZ, and CAST(LOWER(TRIM())) are rejected.
 */
export function assertCollationSafe(sql) {
  const text = String(sql);
  assert.doesNotMatch(text, /HEX\s*\(|CONVERT_TZ\s*\(/i, text);
  assert.doesNotMatch(text, /CAST\s*\(\s*(?:LOWER|TRIM)\s*\(/i, text);
  assert.doesNotMatch(text, /CAST\(\s*(?:`?\w+`?\.)*`?\w+`?\s+AS BINARY\s*\)\s*=/i, text);
  const masked = text.replace(/'(?:''|[^'])*'/g, match => ' '.repeat(match.length));
  for (const op of masked.matchAll(/<>|<=|>=|!=|=|<|>/g)) {
    const right = binarySide(text, op.index + op[0].length, 1);
    const left = binarySide(text, op.index - 1, -1);
    assert.equal(right || left, true, `comparison is not collation-safe\n${text}`);
    assert.equal(right, true, `right side of ${op[0]} is not CAST AS BINARY\n${text}`);
  }
}
