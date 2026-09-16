#!/usr/bin/env node
// ترقية قاعدة بيانات CRM من الترمنال — بديل phpMyAdmin.
//
// يقرأ بيانات الاتصال من .env.local (أو .env) ولا يطبعها أبداً.
// آمن: إضافة فقط. لا DROP ولا DELETE ولا TRUNCATE.
// قابل لإعادة التشغيل: أي خانة/فهرس موجود يُتخطى بدل أن يفشل.
//
// الاستخدام:
//   node scripts/migrate-leads.mjs --check   ← فحص فقط، لا يعدل شيئاً
//   node scripts/migrate-leads.mjs           ← تنفيذ الترقية

import {readFileSync, existsSync} from 'node:fs';
import mysql from 'mysql2/promise';
// Decision logic lives in a pure module so it can be tested without a live
// server — see scripts/check-migration-plan.mjs.
import {planMigration, COLUMNS, STAGES} from './lib/migration-plan.mjs';
import {parseEnv} from './lib/parse-env.mjs';

const CHECK_ONLY = process.argv.includes('--check');

// ── بيانات الاتصال ────────────────────────────────────────────
// المحلّل في scripts/lib/parse-env.mjs يتقبّل CRLF و BOM والاقتباس،
// وإلا حملت القيم حرف \r فظهرت رسالة "بيانات ناقصة" مع ملف صحيح.
for (const file of ['.env.local', '.env', '.env.production']) {
  if (!existsSync(file)) continue;
  for (const [key, value] of Object.entries(parseEnv(readFileSync(file, 'utf8')))) {
    if (!process.env[key]) process.env[key] = value;
  }
}
const {DB_HOST, DB_USER, DB_PASSWORD, DB_NAME, DB_PORT} = process.env;
if (!DB_HOST || !DB_USER || !DB_PASSWORD || !DB_NAME) {
  console.error('\n✗ بيانات الاتصال غير مكتملة.');
  console.error('  أنشئ ملف .env.local في جذر المشروع يحتوي:');
  console.error('    DB_HOST=...\n    DB_USER=...\n    DB_PASSWORD=...\n    DB_NAME=...\n');
  console.error('  ملاحظة: Hostinger يمنع الاتصال الخارجي افتراضياً.');
  console.error('  فعّل "Remote MySQL" في hPanel وأضف عنوان IP الخاص بك.\n');
  process.exit(1);
}

// ── ما سنضيفه ────────────────────────────────────────────────
// التعريفات في scripts/lib/migration-plan.mjs — مُختبرة في check-migration-plan.mjs

const conn = await mysql.createConnection({
  host: DB_HOST, user: DB_USER, password: DB_PASSWORD, database: DB_NAME,
  port: Number(DB_PORT || 3306), charset: 'utf8mb4', multipleStatements: false,
  ...(process.env.DB_SSL === 'true' ? {ssl: {rejectUnauthorized: true}} : {}),
});

try {
  // SHOW COLUMNS/INDEX تعمل بصلاحيات الجدول فقط — لا حاجة لـ information_schema،
  // وهو ما سبب خطأ #1044 في phpMyAdmin.
  const [cols] = await conn.query('SHOW COLUMNS FROM leads');
  const have = new Set(cols.map(c => c.Field));
  const [idx] = await conn.query('SHOW INDEX FROM leads');
  const haveIdx = new Set(idx.map(i => i.Key_name));
  const [[{n: rowCount}]] = await conn.query('SELECT COUNT(*) AS n FROM leads');
  const plan = planMigration(cols, idx);

  console.log(`\nقاعدة البيانات: ${DB_NAME}`);
  console.log(`جدول leads: ${rowCount} سجلاً، ${have.size} خانة\n`);

  const missingCols = plan.addColumns;
  const missingIdx  = plan.addIndexes;
  const stageNeedsWidening = plan.widenStage;

  console.log('الخانات المطلوبة:');
  for (const [c] of COLUMNS) console.log(`  ${have.has(c) ? '✓ موجودة' : '✗ ناقصة '}  ${c}`);
  console.log(`\nقائمة المراحل: ${stageNeedsWidening ? '✗ تحتاج توسيع' : '✓ مكتملة'}`);
  console.log(`الفهارس الناقصة: ${missingIdx.length}`);

  if (!missingCols.length && !missingIdx.length && !stageNeedsWidening) {
    console.log('\n✓ القاعدة محدّثة بالكامل. لا حاجة لأي تعديل.\n');
    process.exit(0);
  }

  if (CHECK_ONLY) {
    console.log('\n(فحص فقط — لم يُعدّل شيء. أعد التشغيل بدون --check للتنفيذ.)\n');
    process.exit(0);
  }

  console.log('\n── التنفيذ ──');
  for (const [name, ddl] of missingCols) {
    await conn.query(`ALTER TABLE leads ADD COLUMN \`${name}\` ${ddl}`);
    console.log(`  + أُضيفت الخانة ${name}`);
  }
  if (missingCols.some(([c]) => c === 'created_by')) {
    const [r] = await conn.query("UPDATE leads SET created_by = owner WHERE created_by = ''");
    console.log(`  ↻ عُبّئت created_by لـ ${r.affectedRows} سجلاً (حتى لا يختفوا من التقارير)`);
  }
  if (missingCols.some(([c]) => c === 'source')) {
    const [r] = await conn.query("UPDATE leads SET source = 'manual' WHERE source = ''");
    console.log(`  ↻ عُبّئت source لـ ${r.affectedRows} سجلاً`);
  }
  if (stageNeedsWidening) {
    await conn.query(`ALTER TABLE leads MODIFY COLUMN stage ENUM(${STAGES.map(s => `'${s}'`).join(',')}) NOT NULL DEFAULT 'new'`);
    console.log(`  ↻ وُسّعت قائمة المراحل إلى ${STAGES.length} مرحلة`);
  }
  for (const [name, def] of missingIdx) {
    try { await conn.query(`ALTER TABLE leads ADD INDEX \`${name}\` ${def}`); console.log(`  + أُضيف الفهرس ${name}`); }
    catch (e) { console.log(`  · تُخطّي الفهرس ${name} (${e.code})`); }
  }

  // ── التحقق بعد التنفيذ ──
  const [after] = await conn.query('SHOW COLUMNS FROM leads');
  const nowHave = new Set(after.map(c => c.Field));
  const stillMissing = COLUMNS.filter(([c]) => !nowHave.has(c)).map(([c]) => c);
  const [[{n: afterCount}]] = await conn.query('SELECT COUNT(*) AS n FROM leads');

  console.log('\n── التحقق ──');
  if (stillMissing.length) {
    console.log(`✗ لا تزال ناقصة: ${stillMissing.join(', ')}`);
    process.exit(1);
  }
  if (afterCount !== rowCount) {
    console.log(`✗ تغيّر عدد السجلات: ${rowCount} → ${afterCount}`);
    process.exit(1);
  }
  console.log(`✓ الخانات الخمس موجودة`);
  console.log(`✓ عدد السجلات كما هو: ${afterCount} (لم تُفقد أي بيانات)`);

  // إثبات أن استعلام التقارير الحقيقي يعمل الآن
  await conn.query(`SELECT l.id,l.name,l.property_id,l.property_other,l.source,l.stage,s.name AS sales,f.name AS field
    FROM leads l LEFT JOIN crm_users s ON s.id=l.assigned_to LEFT JOIN crm_users f ON f.id=l.field_assigned_to
    ORDER BY l.id LIMIT 1`);
  console.log('✓ استعلام تقرير العملاء ينفّذ بنجاح');
  await conn.query('SELECT l.property_id,l.property_other FROM leads l ORDER BY l.id LIMIT 1');
  console.log('✓ استعلام تقرير العقارات ينفّذ بنجاح');

  console.log('\n✓ تمت الترقية. اعمل Redeploy ثم افتح التقارير.\n');
} catch (e) {
  console.error(`\n✗ فشل: ${e.code || ''} ${e.message}`);
  if (e.code === 'ER_TABLEACCESS_DENIED_ERROR' || e.code === 'ER_DBACCESS_DENIED_ERROR')
    console.error('  المستخدم لا يملك صلاحية ALTER على هذا الجدول.');
  if (e.code === 'ETIMEDOUT' || e.code === 'ECONNREFUSED' || e.code === 'ENOTFOUND')
    console.error('  تعذّر الوصول للسيرفر. فعّل "Remote MySQL" في hPanel وأضف عنوان IP الخاص بك.');
  if (e.code === 'ER_NO_SUCH_TABLE')
    console.error('  جدول leads غير موجود — راجع قيمة DB_NAME.');
  process.exit(1);
} finally {
  await conn.end();
}
