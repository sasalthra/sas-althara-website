import assert from 'node:assert/strict';

/** node:sqlite treats CAST(x AS BINARY) as numeric. Report SQL uses that cast so MySQL compares bytes; tests compare the same bytes as BLOB. */
export function sqliteReportSql(sql) {
  return String(sql).replaceAll(' AS BINARY', ' AS BLOB');
}

function binarySide(sql, index, dir) {
  let i = index;
  while (sql[i] === ' ' || sql[i] === '\n' || sql[i] === '\t') i += dir;
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

/** Every comparison must be CAST(... AS BINARY) on both sides, and the coercible-string traps must be gone. */
export function assertCollationSafe(sql) {
  const text = String(sql);
  assert.doesNotMatch(text, /HEX\s*\(|CONVERT_TZ\s*\(/i, text);
  const masked = text.replace(/'(?:''|[^'])*'/g, match => ' '.repeat(match.length));
  for (const op of masked.matchAll(/<>|<=|>=|!=|=|<|>/g)) {
    assert.equal(binarySide(text, op.index - 1, -1), true, `left side of ${op[0]} is not CAST AS BINARY\n${text}`);
    assert.equal(binarySide(text, op.index + op[0].length, 1), true, `right side of ${op[0]} is not CAST AS BINARY\n${text}`);
  }
}
