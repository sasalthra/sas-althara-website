#!/usr/bin/env node
// إصلاح ملكية العملاء: ربط السجلات بمستخدم مسجل في crm_users.
//
// المشكلة: سجل بـ owner = 'google:...' (هوية تسجيل دخول، ليست معرف مستخدم)
// و created_by = 'null' (نص، ليس قيمة فاضية) يختفي من كل تقرير غير إداري،
// لأن التحقق من الصلاحية يقارن owner/created_by/assigned_to بمعرف المستخدم.
//
// آمن: يأخذ نسخة احتياطية أولاً، ويطبع خطته، ويتحقق بعد التنفيذ.
// الاستخدام:
//   node scripts/fix-lead-ownership.mjs --check          ← عرض الخطة فقط
//   node scripts/fix-lead-ownership.mjs --to=<user-id>   ← التنفيذ

import {readFileSync, existsSync} from 'node:fs';
import mysql from 'mysql2/promise';
import {parseEnv} from './lib/parse-env.mjs';

for (const f of ['.env.local', '.env']) {
  if (!existsSync(f)) continue;
  for (const [k, v] of Object.entries(parseEnv(readFileSync(f, 'utf8')))) if (!process.env[k]) process.env[k] = v;
}
const {DB_HOST, DB_USER, DB_PASSWORD, DB_NAME, DB_PORT} = process.env;
if (!DB_HOST || !DB_USER || !DB_PASSWORD || !DB_NAME) {
  console.error('✗ بيانات الاتصال غير مكتملة في .env.local'); process.exit(1);
}

const CHECK_ONLY = process.argv.includes('--check');
const target = (process.argv.find(a => a.startsWith('--to=')) || '').slice(5);
if (!CHECK_ONLY && !target) {
  console.error('✗ حدد المستخدم الهدف:  --to=<user-id>   (أو استخدم --check لعرض الخطة)');
  process.exit(1);
}

const conn = await mysql.createConnection({host: DB_HOST, user: DB_USER, password: DB_PASSWORD,
  database: DB_NAME, port: Number(DB_PORT || 3306), charset: 'utf8mb4'});

try {
  const [users] = await conn.query('SELECT id, name, role FROM crm_users');
  const byId = new Map(users.map(u => [u.id, u]));

  console.log('المستخدمون المسجلون:');
  for (const u of users) console.log(`  ${u.role.padEnd(11)} | ${u.name.padEnd(16)} | ${u.id}`);

  // سجلات لا يمكن لأي مستخدم غير إداري رؤيتها: المالك غير مسجل
  // و created_by غير صالح و assigned_to لا يشير لمستخدم موجود.
  const [broken] = await conn.query(`
    SELECT l.id, l.name, l.owner, l.created_by, l.assigned_to, l.field_assigned_to
    FROM leads l
    LEFT JOIN crm_users uo ON uo.id = l.owner
    WHERE uo.id IS NULL
       OR l.created_by IN ('', 'null', 'undefined')
       OR l.created_by IS NULL`);

  console.log(`\nسجلات بملكية مكسورة: ${broken.length}`);
  for (const r of broken) {
    const assignee = byId.get(r.assigned_to);
    console.log(`  «${r.name}»`);
    console.log(`     owner=${r.owner} ${byId.has(r.owner) ? '✓' : '✗ غير مسجل'}`);
    console.log(`     created_by='${r.created_by}' ${['', 'null', 'undefined', null].includes(r.created_by) ? '✗ غير صالح' : '✓'}`);
    console.log(`     assigned_to=${r.assigned_to || '(فاضي)'} ${assignee ? `✓ ${assignee.name}` : '✗'}`);
  }

  if (!broken.length) { console.log('\n✓ لا توجد ملكية مكسورة.'); process.exit(0); }

  if (CHECK_ONLY) {
    console.log('\n(فحص فقط — لم يُعدّل شيء.)');
    console.log('للتنفيذ:  npm run db:fix-ownership -- --to=<user-id>');
    process.exit(0);
  }

  const owner = byId.get(target);
  if (!owner) {
    console.error(`\n✗ المعرف ${target} غير موجود في crm_users. اختر معرفاً من القائمة أعلاه.`);
    process.exit(1);
  }
  console.log(`\nالمالك الجديد: ${owner.name} (${owner.role})`);

  // نسخة احتياطية قبل أي كتابة.
  const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const backup = `leads_ownerfix_${stamp}`;
  const [exists] = await conn.query('SHOW TABLES LIKE ?', [backup]);
  if (exists.length) console.log(`  · النسخة الاحتياطية ${backup} موجودة، لن تُكتب مرة أخرى`);
  else {
    await conn.query(`CREATE TABLE \`${backup}\` AS SELECT * FROM leads`);
    const [[{n}]] = await conn.query(`SELECT COUNT(*) AS n FROM \`${backup}\``);
    console.log(`  ✓ نسخة احتياطية: ${backup} (${n} سجلاً)`);
  }

  const before = (await conn.query('SELECT COUNT(*) AS n FROM leads'))[0][0].n;
  const ids = broken.map(r => r.id);
  const placeholders = ids.map(() => '?').join(',');

  // owner و created_by إلى مستخدم مسجل. assigned_to يُحفظ إن كان صالحاً بالفعل.
  const [r1] = await conn.query(
    `UPDATE leads SET owner = ?, created_by = ? WHERE id IN (${placeholders})`, [target, target, ...ids]);
  console.log(`  ↻ صُحّحت الملكية في ${r1.affectedRows} سجلاً`);

  const [r2] = await conn.query(
    `UPDATE leads SET assigned_to = ? WHERE id IN (${placeholders})
       AND (assigned_to IS NULL OR assigned_to = '' OR assigned_to NOT IN (SELECT id FROM crm_users))`,
    [target, ...ids]);
  if (r2.affectedRows) console.log(`  ↻ صُحّح التكليف في ${r2.affectedRows} سجلاً`);

  // ── التحقق ──
  const after = (await conn.query('SELECT COUNT(*) AS n FROM leads'))[0][0].n;
  if (after !== before) { console.error(`\n✗ تغيّر عدد السجلات: ${before} → ${after}`); process.exit(1); }

  const [[{stillBroken}]] = await conn.query(`
    SELECT COUNT(*) AS stillBroken FROM leads l
    LEFT JOIN crm_users uo ON uo.id = l.owner
    WHERE uo.id IS NULL OR l.created_by IN ('', 'null', 'undefined') OR l.created_by IS NULL`);

  console.log('\n── التحقق ──');
  console.log(`✓ عدد السجلات كما هو: ${after}`);
  console.log(`${stillBroken === 0 ? '✓' : '✗'} سجلات بملكية مكسورة بعد الإصلاح: ${stillBroken}`);

  // إثبات أن السجل يظهر الآن في نطاق صلاحية المستخدم الهدف.
  const [[{visible}]] = await conn.query(
    `SELECT COUNT(*) AS visible FROM leads l
     WHERE (l.owner = ? OR l.created_by = ? OR l.assigned_to = ? OR l.field_assigned_to = ?)`,
    [target, target, target, target]);
  console.log(`✓ سجلات ظاهرة الآن في تقارير ${owner.name}: ${visible}`);

  if (stillBroken > 0) process.exit(1);
  console.log(`\n✓ تم. النسخة الاحتياطية في ${backup} إن احتجت الرجوع.\n`);
} catch (e) {
  console.error(`\n✗ فشل: ${e.code || ''} ${e.message}`);
  process.exit(1);
} finally { await conn.end(); }
