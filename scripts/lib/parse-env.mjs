// .env parser used by scripts/migrate-leads.mjs.
// Separated so it can be tested — a CRLF file silently appended "\r" to every
// value, which made a correct .env.local look like missing credentials.

// Parses .env text into a plain object. Tolerates:
//   - Windows CRLF line endings and a UTF-8 BOM
//   - `export KEY=value` prefixes
//   - single or double quoted values
//   - trailing inline `# comments` on unquoted values
//   - blank lines and whole-line comments
export function parseEnv(text) {
  const out = {};
  for (const line of String(text).replace(/^\uFEFF/, '').split(/\r?\n/)) {
    if (/^\s*(#|$)/.test(line)) continue;
    const m = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
    if (!m) continue;
    let value = m[2].trim();
    const quoted = (value.startsWith('"') && value.endsWith('"') && value.length > 1)
      || (value.startsWith("'") && value.endsWith("'") && value.length > 1);
    if (quoted) value = value.slice(1, -1);
    else value = value.replace(/\s+#.*$/, '').trim();
    // Guard against a stray CR surviving any path above.
    out[m[1]] = value.replace(/[\r\n]+$/, '');
  }
  return out;
}
