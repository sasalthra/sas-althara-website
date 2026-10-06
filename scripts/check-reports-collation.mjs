// Mixed-collation check for the reports SQL. Not part of `npm test` (needs MySQL and MariaDB).
// Defaults match the local docker ports used to reproduce Hostinger error 1267.
//   docker run -d --name reports-mysql8 -e MYSQL_ROOT_PASSWORD=pass -e MYSQL_DATABASE=crm -p 33066:3306 mysql:8.0 --character-set-server=utf8mb4 --collation-server=utf8mb4_general_ci
//   docker run -d --name reports-maria104 -e MYSQL_ROOT_PASSWORD=pass -e MYSQL_DATABASE=crm -p 33067:3306 mariadb:10.4 --character-set-server=utf8mb4 --collation-server=utf8mb4_general_ci
// Optional: MariaDB 10.11 on 33068 and MariaDB 11.4 on 33069. Missing optional servers are skipped.
import assert from 'node:assert/strict';
import {mkdtempSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createRequire} from 'node:module';
import {build} from 'esbuild';
import mysql from 'mysql2/promise';

const engines = [
  {name: 'MySQL 8', port: Number(process.env.MYSQL_PORT || 33066)},
  {name: 'MariaDB 10.4', port: Number(process.env.MARIADB_PORT || 33067)},
  {name: 'MariaDB 10.11', port: Number(process.env.MARIADB_1011_PORT || 33068)},
  {name: 'MariaDB 11.4', port: Number(process.env.MARIADB_114_PORT || 33069)},
];
const databases = [
  {name: 'crm_general', collation: 'utf8mb4_general_ci'},
  {name: 'crm_unicode', collation: 'utf8mb4_unicode_ci'},
];
const connections = [
  {name: 'utf8mb4_unicode_ci', charset: 'utf8mb4_unicode_ci'},
  {name: 'utf8mb4_general_ci', charset: 'utf8mb4'},
];
const admin = {userId: 'root', role: 'admin'};
const filters = {from: '2026-09-01', to: '2026-09-30', employee: '', source: '', stage: '', funding: '', page: 1, pageSize: 50};

function schemaSql(database, collation) {
  const other = collation === 'utf8mb4_general_ci' ? 'utf8mb4_unicode_ci' : 'utf8mb4_general_ci';
  return `
    CREATE DATABASE IF NOT EXISTS \`${database}\` CHARACTER SET utf8mb4 COLLATE ${collation};
    USE \`${database}\`;
    DROP TABLE IF EXISTS crm_transactions, lead_activity, leads, crm_users;
    CREATE TABLE crm_users (
      id VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
      name VARCHAR(255) CHARACTER SET utf8mb4 COLLATE ${other} NULL,
      username VARCHAR(255) CHARACTER SET utf8mb4 COLLATE ${collation} NULL,
      role VARCHAR(32) CHARACTER SET utf8mb4 COLLATE ${collation} NULL,
      active TINYINT NULL,
      created_at VARCHAR(40) CHARACTER SET utf8mb4 COLLATE ${collation} NULL
    ) CHARACTER SET utf8mb4 COLLATE ${collation};
    CREATE TABLE leads (
      id VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
      owner VARCHAR(255) CHARACTER SET utf8mb4 COLLATE ${other} NULL,
      created_by VARCHAR(255) CHARACTER SET utf8mb4 COLLATE ${collation} NULL,
      assigned_to VARCHAR(255) CHARACTER SET utf8mb4 COLLATE ${other} NULL,
      field_assigned_to VARCHAR(255) CHARACTER SET ascii COLLATE ascii_bin NULL,
      name VARCHAR(255) CHARACTER SET utf8mb4 COLLATE ${other} NULL,
      property_id VARCHAR(64) CHARACTER SET utf8mb4 COLLATE ${collation} NULL,
      property_other VARCHAR(255) CHARACTER SET utf8mb4 COLLATE ${other} NULL,
      source VARCHAR(255) CHARACTER SET utf8mb4 COLLATE ${collation} NULL,
      stage VARCHAR(64) CHARACTER SET utf8mb4 COLLATE ${other} NULL,
      follow_up VARCHAR(40) CHARACTER SET utf8mb4 COLLATE ${collation} NULL,
      created_at VARCHAR(40) CHARACTER SET utf8mb4 COLLATE ${other} NULL,
      updated_at VARCHAR(40) CHARACTER SET utf8mb4 COLLATE ${collation} NULL
    ) CHARACTER SET utf8mb4 COLLATE ${collation};
    CREATE TABLE crm_transactions (
      id VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
      lead_id VARCHAR(64) CHARACTER SET utf8mb4 COLLATE ${other} NULL,
      data LONGTEXT CHARACTER SET utf8mb4 COLLATE ${collation} NULL,
      confirmed_due VARCHAR(40) CHARACTER SET utf8mb4 COLLATE ${collation} NULL,
      updated_at VARCHAR(40) CHARACTER SET utf8mb4 COLLATE ${other} NULL
    ) CHARACTER SET utf8mb4 COLLATE ${collation};
    INSERT INTO crm_users (id, name, username, role, active, created_at) VALUES
      ('alice','Alice','alice.user','sales',1,'2026-01-01'),
      ('ahmad','أحمد','ahmad','sales',1,'2026-01-01');
    INSERT INTO leads (id, owner, created_by, assigned_to, field_assigned_to, name, property_id, property_other, source, stage, follow_up, created_at, updated_at) VALUES
      ('l1','alice','alice','alice','','عميل','p','','tiktok','contacted','2026-09-10','2026-09-01 00:00:00','2026-09-01 00:00:00'),
      ('l2','alice','alice','alice.user','','باسم','p','','تيك توك','interested','2026-09-11','2026-09-11T00:00:00.000Z','2026-09-04 00:00:00'),
      ('l3','root','root','أحمد','','بالاسم','p','','whatsapp','new','','2026-09-10T00:00:00.000Z','2026-09-10T00:00:00.000Z'),
      ('l4','alice','alice','','alice','ميدان','p','','website','new','2026-09-01','2026-09-30 20:59:59','2026-09-12 00:00:00'),
      ('l5','bob','bob','bob','','خارج','p','','web','won','2026-09-10','2026-09-30 21:00:00','2026-09-30 21:00:00');
    INSERT INTO crm_transactions (id, lead_id, data, confirmed_due, updated_at) VALUES
      ('t1','l1','{"financeEmployeeId":"alice","fundingEntity":"بنك اختبار","requestStage":"اعتماد"}','1.00','2026-09-02 00:00:00');
  `;
}

const oldJoin = `SELECT l.id FROM leads l LEFT JOIN crm_users s ON HEX(LOWER(s.id))=HEX(LOWER(l.assigned_to)) LEFT JOIN crm_users f ON HEX(LOWER(f.id))=HEX(LOWER(l.field_assigned_to)) LIMIT 1`;
const oldDate = `SELECT l.id FROM leads l WHERE SUBSTRING(CONVERT_TZ(CAST(l.created_at AS CHAR),'+00:00','+03:00'),1,10) >= ? LIMIT 1`;

function errnoOf(error) {
  return error && typeof error === 'object' && 'errno' in error ? error.errno : error?.code;
}

async function probe(conn, sql, params = []) {
  try {
    await conn.execute(sql, params);
    return null;
  } catch (error) {
    return errnoOf(error);
  }
}

function adapter(conn) {
  return {prepare(sql) {
    let values = [];
    return {bind(...args) { values = args; return this; }, async all() {
      const [rows] = await conn.execute(sql, values);
      return {results: rows};
    }};
  }};
}

const out = mkdtempSync(join(tmpdir(), 'sas-collation-'));
await build({entryPoints: ['lib/reports.ts'], outfile: join(out, 'reports.cjs'), bundle: true, platform: 'node', format: 'cjs', external: ['mysql2/promise']});
const {readReport, readReportDashboard} = createRequire(import.meta.url)(join(out, 'reports.cjs'));
let failures = 0;
const fail = message => { failures++; console.log('✗ ' + message); };
const ok = message => console.log('✓ ' + message);

try {
  for (const engine of engines) {
    let root;
    try {
      root = await mysql.createConnection({host: '127.0.0.1', port: engine.port, user: 'root', password: 'pass', multipleStatements: true, charset: 'utf8mb4_unicode_ci'});
    } catch (error) {
      const message = `${engine.name} is not listening on ${engine.port}: ${error instanceof Error ? error.message : error}`;
      if (engine.name === 'MySQL 8' || engine.name === 'MariaDB 10.4') fail(message);
      else console.log('· skip ' + message);
      continue;
    }
    for (const database of databases) await root.query(schemaSql(database.name, database.collation));
    await root.end();
    for (const database of databases) for (const connection of connections) {
      const label = `${engine.name} db=${database.collation} conn=${connection.name}`;
      const conn = await mysql.createConnection({host: '127.0.0.1', port: engine.port, user: 'root', password: 'pass', database: database.name, charset: connection.charset});
      const [[vars]] = await conn.query(`SELECT @@collation_connection AS c, @@collation_database AS d`);
      const joinErrno = await probe(conn, oldJoin);
      const dateErrno = await probe(conn, oldDate, ['2026-09-01']);
      console.log(`· ${label} session=${vars.c} database=${vars.d} oldJoin=${joinErrno ?? 'ok'} oldDate=${dateErrno ?? 'ok'}`);
      const db = adapter(conn);
      try {
        const dash = await readReportDashboard(db, admin, filters, new Date('2026-09-20T12:00:00.000Z'));
        assert.equal(dash.total, 4, 'unfiltered dashboard');
        assert.equal(dash.employees.find(row => row.id === 'alice').assigned, 3);
        assert.equal(dash.employees.find(row => row.id === 'ahmad').assigned, 1);
        const leads = await readReport(db, admin, 'leads', filters);
        assert.equal(leads.total, 4, 'unfiltered leads');
        assert.equal((await readReport(db, admin, 'leads', {...filters, employee: 'alice'})).total, 3);
        assert.equal((await readReport(db, admin, 'leads', {...filters, employee: 'أحمد'})).total, 1);
        assert.equal((await readReport(db, admin, 'leads', {...filters, source: 'tiktok'})).total, 1);
        assert.equal((await readReport(db, admin, 'leads', {...filters, source: 'تيك توك'})).total, 1);
        assert.equal((await readReport(db, admin, 'leads', {...filters, stage: 'مهتم'})).total, 1);
        assert.equal((await readReport(db, admin, 'leads', {...filters, from: '2026-09-11', to: '2026-09-11'})).total, 1);
        assert.equal((await readReport(db, {userId: 'alice', role: 'sales'}, 'leads', filters)).total, 3);
        assert.equal((await readReport(db, admin, 'transactions', {...filters, employee: 'alice', funding: 'بنك اختبار', stage: 'اعتماد'})).total, 1);
        const day = await readReportDashboard(db, admin, {...filters, from: '2026-09-30', to: '2026-09-30'}, new Date('2026-09-30T12:00:00.000Z'));
        assert.equal(day.total, 1, 'Riyadh day excludes 21:00 UTC');
        ok(label);
      } catch (error) {
        fail(`${label}: ${error instanceof Error ? error.message : error} errno=${errnoOf(error) ?? ''}`);
      }
      await conn.end();
    }
  }
} finally {
  rmSync(out, {recursive: true, force: true});
}
if (failures) {
  console.log(`\n✗ ${failures} collation scenario(s) failed`);
  process.exit(1);
}
console.log('\n✓ reports SQL survived mixed collations on MySQL 8 and MariaDB 10.4');
