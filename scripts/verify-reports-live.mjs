#!/usr/bin/env node
// تحقق نهائي للقراءة فقط: هل التقارير تقرأ البيانات فعلاً الآن لكل دور؟
import {readFileSync, existsSync} from 'node:fs';
import mysql from 'mysql2/promise';
import {parseEnv} from './lib/parse-env.mjs';

for (const f of ['.env.local', '.env']) {
  if (!existsSync(f)) continue;
  for (const [k, v] of Object.entries(parseEnv(readFileSync(f, 'utf8')))) if (!process.env[k]) process.env[k] = v;
}
const {DB_HOST, DB_USER, DB_PASSWORD, DB_NAME, DB_PORT} = process.env;
const conn = await mysql.createConnection({host: DB_HOST, user: DB_USER, password: DB_PASSWORD,
  database: DB_NAME, port: Number(DB_PORT || 3306), charset: 'utf8mb4'});

const leadFrom = 'leads l LEFT JOIN crm_users s ON s.id=l.assigned_to LEFT JOIN crm_users f ON f.id=l.field_assigned_to';
const leadFields = 'l.id,l.name,l.property_id,l.property_other,l.source,l.stage,l.follow_up,l.created_at,s.name AS sales,f.name AS field';
let failures = 0;
const ok = (pass, msg) => { console.log(`${pass ? '✓' : '✗'} ${msg}`); if (!pass) failures++; };

try {
  // 1. استعلام تقرير العملاء كما يبنيه lib/reports.ts حرفياً
  const [rows] = await conn.query(`SELECT ${leadFields} FROM ${leadFrom} ORDER BY l.created_at DESC, l.id LIMIT 25`);
  ok(rows.length > 0, `تقرير العملاء يُرجع ${rows.length} سجلاً`);
  if (rows.length) console.log(`    «${rows[0].name}» | المصدر: ${rows[0].source} | المرحلة: ${rows[0].stage} | المبيعات: ${rows[0].sales || '—'}`);

  // 2. استعلام تقرير العقارات
  const [props] = await conn.query(`SELECT l.property_id,l.property_other FROM ${leadFrom} ORDER BY l.id LIMIT 10001`);
  ok(props.length > 0, `تقرير العقارات يقرأ ${props.length} رابط عميل-عقار`);
  const linked = new Map();
  for (const p of props) linked.set(String(p.property_id || 'other'), (linked.get(String(p.property_id || 'other')) || 0) + 1);
  for (const [id, n] of linked) console.log(`    العقار ${id}: ${n} عميل مرتبط`);

  // 3. نطاق الصلاحية لكل دور فعلي
  const [users] = await conn.query('SELECT id,name,role FROM crm_users');
  for (const u of users) {
    const assignment = u.role === 'field' ? 'l.field_assigned_to'
      : u.role === 'supervisor' ? 'l.assigned_to = ? OR l.field_assigned_to' : 'l.assigned_to';
    const args = u.role === 'supervisor' ? [u.id, u.id, u.id, u.id] : [u.id, u.id, u.id];
    if (u.role === 'admin') {
      const [[{n}]] = await conn.query(`SELECT COUNT(*) AS n FROM ${leadFrom}`);
      ok(n > 0, `${u.name} (admin) يرى ${n} عميلاً`);
    } else {
      const [[{n}]] = await conn.query(
        `SELECT COUNT(*) AS n FROM ${leadFrom} WHERE (l.owner = ? OR l.created_by = ? OR ${assignment} = ?)`, args);
      console.log(`${n > 0 ? '✓' : '·'} ${u.name} (${u.role}) يرى ${n} عميلاً`);
    }
  }

  // 4. الفترة الافتراضية للتقرير (آخر 30 يوماً بتوقيت الرياض)
  const [[{inWindow}]] = await conn.query(`
    SELECT COUNT(*) AS inWindow FROM leads l
    WHERE SUBSTRING(CONVERT_TZ(CAST(l.created_at AS CHAR),'+00:00','+03:00'),1,10)
          >= DATE_FORMAT(DATE_SUB(NOW(), INTERVAL 30 DAY),'%Y-%m-%d')`);
  ok(inWindow > 0, `داخل الفترة الافتراضية (آخر 30 يوماً): ${inWindow} عميل`);

  // 5. المرحلة الحالية مقبولة في ENUM الموسّع
  const [[{stage}]] = await conn.query('SELECT stage FROM leads LIMIT 1');
  const [cols] = await conn.query('SHOW COLUMNS FROM leads LIKE ?', ['stage']);
  ok(String(cols[0].Type).includes(`'${stage}'`), `المرحلة «${stage}» مقبولة في ENUM`);
  ok(String(cols[0].Type).includes("'won'") && String(cols[0].Type).includes("'closed'"),
    'المراحل won و closed أُعيدت بعد التوسيع');

  console.log(failures ? `\n✗ ${failures} تحقق فشل` : '\n✓ كل التحققات نجحت — التقارير تقرأ البيانات فعلاً');
} finally { await conn.end(); }
process.exit(failures ? 1 : 0);
