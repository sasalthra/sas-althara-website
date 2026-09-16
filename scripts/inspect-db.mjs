#!/usr/bin/env node
// فحص للقراءة فقط: ما هو وضع قاعدة البيانات الحقيقي؟ لا يعدّل شيئاً.
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

try {
  const [tables] = await conn.query('SHOW TABLES');
  const names = tables.map(t => Object.values(t)[0]);
  console.log(`الجداول الموجودة (${names.length}):`);
  console.log('  ' + names.join('\n  '));

  const [cols] = await conn.query('SHOW COLUMNS FROM leads');
  console.log(`\nخانات جدول leads (${cols.length}):`);
  for (const c of cols) console.log(`  ${c.Field.padEnd(20)} ${c.Type}`);

  const [[{n}]] = await conn.query('SELECT COUNT(*) AS n FROM leads');
  console.log(`\nعدد العملاء في الجدول: ${n}`);

  // كم عميل سيظهر فعلاً في تقرير آخر 30 يوماً؟
  const [[{recent}]] = await conn.query(
    "SELECT COUNT(*) AS recent FROM leads WHERE SUBSTRING(created_at,1,10) >= DATE_FORMAT(DATE_SUB(NOW(), INTERVAL 30 DAY),'%Y-%m-%d')");
  console.log(`منهم داخل آخر 30 يوماً (الفترة الافتراضية للتقرير): ${recent}`);

  if (n > 0) {
    const [sample] = await conn.query('SELECT created_at, owner, stage, property_id FROM leads ORDER BY created_at DESC LIMIT 5');
    console.log('\nأحدث السجلات (تاريخ الإنشاء / المالك / المرحلة / العقار):');
    for (const r of sample) console.log(`  ${r.created_at} | ${r.owner} | ${r.stage} | ${r.property_id}`);
  }

  for (const t of ['crm_users', 'crm_transactions', 'hr_attendance']) {
    if (!names.includes(t)) { console.log(`\n⚠ الجدول ${t} غير موجود`); continue; }
    const [[{c}]] = await conn.query(`SELECT COUNT(*) AS c FROM \`${t}\``);
    console.log(`\n${t}: ${c} صفاً`);
  }
} finally { await conn.end(); }
