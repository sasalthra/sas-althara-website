// Index and mixed-collation check for the lead list and note query.
// Not part of npm test. Requires the local MySQL 8 and MariaDB 10.4 containers:
//   docker run -d --name reports-mysql8 -e MYSQL_ROOT_PASSWORD=pass -e MYSQL_DATABASE=crm -p 33066:3306 mysql:8.0 --character-set-server=utf8mb4 --collation-server=utf8mb4_general_ci
//   docker run -d --name reports-maria104 -e MYSQL_ROOT_PASSWORD=pass -e MYSQL_DATABASE=crm -p 33067:3306 mariadb:10.4 --character-set-server=utf8mb4 --collation-server=utf8mb4_general_ci
import assert from 'node:assert/strict';
import {mkdirSync} from 'node:fs';
import {createRequire} from 'node:module';
import {join} from 'node:path';
import {build} from 'esbuild';
import mysql from 'mysql2/promise';

mkdirSync('test-output', {recursive: true});
await build({
  entryPoints: ['lib/lead-list.ts'],
  outfile: 'test-output/lead-list.cjs',
  bundle: true,
  platform: 'node',
  format: 'cjs',
  plugins: [{
    name: 'at-alias',
    setup(b) {
      b.onResolve({filter: /^@\//}, args => ({path: join(process.cwd(), args.path.slice(2))}));
    },
  }],
});
const {latestNotesSql} = createRequire(import.meta.url)(join(process.cwd(), 'test-output/lead-list.cjs'));

const engines = [
  {name: 'MySQL 8', port: Number(process.env.MYSQL_PORT || 33066)},
  {name: 'MariaDB 10.4', port: Number(process.env.MARIADB_PORT || 33067)},
];

function schemaSql() {
  return `
    CREATE DATABASE IF NOT EXISTS probe_idx CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci;
    USE probe_idx;
    DROP TABLE IF EXISTS lead_activity, leads, crm_users;
    CREATE TABLE crm_users (
      id VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
      name VARCHAR(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL,
      role VARCHAR(32) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL,
      PRIMARY KEY (id)
    ) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
    CREATE TABLE leads (
      id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
      assigned_to VARCHAR(191) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL,
      name_g VARCHAR(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NULL,
      created_at VARCHAR(40) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL,
      PRIMARY KEY (id),
      INDEX leads_assigned_idx (assigned_to)
    ) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
    CREATE TABLE lead_activity (
      id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
      lead_id VARCHAR(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NOT NULL,
      user_id VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NULL,
      action VARCHAR(40) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL,
      details TEXT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL,
      created_at VARCHAR(40) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NULL,
      PRIMARY KEY (id),
      INDEX activity_lead_time (lead_id, created_at)
    ) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci;
  `;
}

function planType(rows) {
  const row = rows.find(item => item.table && item.table !== '<derived>') || rows[rows.length - 1] || {};
  return String(row.type || row.Type || '');
}

async function explain(conn, sql, params) {
  const [rows] = await conn.query(`EXPLAIN ${sql}`, params);
  return rows;
}

let failures = 0;
function check(ok, message) {
  console.log(`${ok ? '✓' : '✗'} ${message}`);
  if (!ok) failures += 1;
}

const notesSql = latestNotesSql(1);
assert.doesNotMatch(notesSql, /HEX\s*\(|CONVERT_TZ\s*\(|LOWER\s*\(|TRIM\s*\(/i);
assert.match(notesSql, /activity\.lead_id IN \(CAST\(\? AS BINARY\)\)/);
assert.doesNotMatch(notesSql, /CAST\(\s*activity\.lead_id\s+AS BINARY\s*\)\s*=/i);

for (const engine of engines) {
  let conn;
  try {
    conn = await mysql.createConnection({
      host: '127.0.0.1',
      port: engine.port,
      user: 'root',
      password: 'pass',
      multipleStatements: true,
      charset: 'utf8mb4_unicode_ci',
    });
  } catch (error) {
    console.log(`✗ ${engine.name} connection failed: ${error instanceof Error ? error.message : error}`);
    failures += 1;
    continue;
  }
  try {
    await conn.query(schemaSql());
    await conn.query(
      `INSERT INTO crm_users (id, name, role) VALUES ('alice', 'Alice', 'sales'), ('ahmad', 'أحمد', 'field')`
    );
    await conn.query(
      `INSERT INTO leads (id, assigned_to, name_g, created_at) VALUES ('lead-1', 'alice', 'Alice', '2026-10-01'), ('lead-2', 'أحمد', 'نورة', '2026-10-02')`
    );
    await conn.query(
      `INSERT INTO lead_activity (id, lead_id, user_id, action, details, created_at) VALUES
        ('a1', 'lead-1', 'alice', 'note', '{"note":"sales note"}', '2026-10-03'),
        ('a2', 'lead-1', 'ahmad', 'note', '{"note":"field note"}', '2026-10-04')`
    );

    let mixed = false;
    try {
      await conn.query('SELECT u.name FROM crm_users u JOIN leads l ON u.name = l.name_g');
    } catch (error) {
      mixed = error && (error.errno === 1267 || error.code === 'ER_CANT_AGGREGATE_2COLLATIONS');
    }
    check(mixed, `${engine.name} direct unicode_ci = general_ci raises 1267`);

    const [castJoin] = await conn.query(
      `SELECT l.id FROM leads l JOIN crm_users u ON l.assigned_to = CAST(u.id AS BINARY) WHERE u.id = CAST(? AS BINARY)`,
      ['alice']
    );
    check(castJoin.length === 1 && castJoin[0].id === 'lead-1', `${engine.name} CAST-on-the-parameter join matches alice`);

    const [nameJoin] = await conn.query(
      `SELECT l.id FROM leads l JOIN crm_users u ON l.name_g = CAST(u.name AS BINARY) WHERE u.id = CAST(? AS BINARY)`,
      ['alice']
    );
    check(nameJoin.length === 1, `${engine.name} CAST join across general_ci and unicode_ci does not raise 1267`);

    const indexed = await explain(conn, `SELECT id FROM lead_activity WHERE lead_id = CAST(? AS BINARY)`, ['lead-1']);
    const indexedType = planType(indexed);
    check(indexedType === 'range' || indexedType === 'ref' || indexedType === 'const', `${engine.name} lead_id = CAST(?) uses ${indexedType || 'no'} index`);

    const wrapped = await explain(
      conn,
      `SELECT id FROM lead_activity WHERE CAST(LOWER(TRIM(lead_id)) AS BINARY) = CAST(? AS BINARY)`,
      ['lead-1']
    );
    check(planType(wrapped) === 'ALL', `${engine.name} wrapped lead_id is a full scan (${planType(wrapped)})`);

    const assigned = await explain(conn, `SELECT id FROM leads WHERE assigned_to = CAST(? AS BINARY)`, ['alice']);
    const assignedType = planType(assigned);
    check(assignedType === 'range' || assignedType === 'ref' || assignedType === 'const', `${engine.name} assigned_to = CAST(?) uses ${assignedType || 'no'} index`);

    const [notes] = await conn.query(notesSql, ['lead-1', 'sales', 'field']);
    const byRole = new Map(notes.map(row => [row.role, row.note]));
    check(byRole.get('sales') === 'sales note' && byRole.get('field') === 'field note', `${engine.name} latest-note query returns both roles`);
    check(!/HEX\s*\(|CONVERT_TZ\s*\(/i.test(notesSql), `${engine.name} notes SQL has no HEX or CONVERT_TZ`);
  } catch (error) {
    console.log(`✗ ${engine.name} ${error instanceof Error ? error.message : error}`);
    failures += 1;
  } finally {
    await conn.end();
  }
}

if (failures) {
  console.log(`\n✗ ${failures} index/collation check(s) failed`);
  process.exit(1);
}
console.log('\n✓ index and mixed-collation checks passed on MySQL 8 and MariaDB 10.4');
