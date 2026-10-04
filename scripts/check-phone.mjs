import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {DatabaseSync} from 'node:sqlite';
import {createRequire} from 'node:module';
import {mkdtempSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

const out = mkdtempSync(join(tmpdir(), 'sas-phone-'));
const require = createRequire(import.meta.url);

try {
  await build({
    entryPoints: ['lib/phone.ts', 'lib/inbound-lead.ts', 'lib/assignment-email.ts'],
    outdir: out,
    bundle: true,
    platform: 'node',
    format: 'cjs',
    outExtension: {'.js': '.cjs'},
  });
  const phone = require(join(out, 'phone.cjs'));
  const inbound = require(join(out, 'inbound-lead.cjs'));
  const mail = require(join(out, 'assignment-email.cjs'));

  const cases = [
    ['0551234567', '0551234567'],
    ['551234567', '0551234567'],
    ['966551234567', '0551234567'],
    ['+966551234567', '0551234567'],
    ['+966 55 123 4567', '0551234567'],
    ['00966551234567', '0551234567'],
    ['00966 55-123-4567', '0551234567'],
    ['(055) 123-4567', '0551234567'],
    ['٠٥٥١٢٣٤٥٦٧', '0551234567'],
    ['۰۵۵۱۲۳۴۵۶۷', '0551234567'],
    ['٠٥٥ 123-4567', '0551234567'],
    ['  561619056\u2069', '0561619056'],
    ['055\u00a01234567', '0551234567'],
    ['9660551234567', '0551234567'],
    ['009660551234567', '0551234567'],
    ['5.5e8', '0550000000'],
    ['971501234567', '971501234567'],
    ['00971501234567', '00971501234567'],
    ['0112345678', '0112345678'],
    ['12345', '12345'],
    ['5568399159', '5568399159'],
    ['', ''],
    ['abc', ''],
    ['---', ''],
  ];
  for (const [input, expected] of cases) {
    assert.equal(phone.normalizeLeadPhone(input), expected, input);
  }
  assert.equal(phone.isSaudiMobile('+966 55 123 4567'), true);
  assert.equal(phone.isSaudiMobile('971501234567'), false);
  assert.equal(phone.displayLeadPhone('+966551234567'), '0551234567');
  assert.equal(phone.displayLeadPhone(''), '');
  assert.equal(phone.leadPhoneMatchesQuery('0551234567', '+966 55 123 4567'), true);
  assert.equal(phone.leadPhoneMatchesQuery('0551234567', '٠٥٥١٢٣٤٥٦٧'), true);
  assert.equal(phone.leadPhoneMatchesQuery('0551234567', '٠٠٩٦٦٥٥١٢٣٤٥٦٧'), true);
  assert.equal(phone.leadPhoneMatchesQuery('0551234567', '551234'), true);
  assert.equal(phone.leadPhoneMatchesQuery('0551234567', '+966 55'), true);
  assert.equal(phone.leadPhoneMatchesQuery('0551234567', 'أحمد'), false);
  assert.equal(phone.leadPhoneMatchesQuery('971501234567', '00971501234567'), true);
  assert.equal(phone.phoneLookupVariants('+966551234567').includes('0551234567'), true);
  assert.equal(phone.phoneLookupVariants('+966551234567').includes('551234567'), true);
  assert.equal(phone.normalizeLeadPhone('1'.repeat(30)).length, 22);

  const plan = phone.planLeadPhoneMigration([
    {id: 'a', phone: '+966551234567'},
    {id: 'b', phone: '٠٥٥١٢٣٤٥٦٧'},
    {id: 'c', phone: '0550000000'},
    {id: 'd', phone: '971501234567'},
    {id: 'e', phone: ''},
  ]);
  assert.deepEqual(plan.updates.map(row => row.id).sort(), ['a', 'b']);
  assert.equal(plan.updates.find(row => row.id === 'a').phone, '0551234567');
  assert.deepEqual(plan.duplicateNotes.map(row => row.id).sort(), ['a', 'b']);
  assert.equal(plan.duplicateNotes[0].count, 2);
  assert.equal(plan.duplicateNotes.some(row => row.id === 'c'), false);
  assert.equal(plan.duplicateNotes.some(row => row.id === 'd'), false);

  const google = inbound.extractInboundLead({
    user_column_data: [
      {column_id: 'FULL_NAME', string_value: 'علي محمد'},
      {column_id: 'PHONE_NUMBER', string_value: '+966 55 111 2233'},
    ],
    campaign_id: 'cmp',
    form_id: 'نموذج جوجل',
  }, 'website');
  assert.equal(google.name, 'علي محمد');
  assert.equal(google.phone, '+966 55 111 2233');
  assert.equal(google.source, 'google');
  assert.equal(google.formName, 'نموذج جوجل');

  const meta = inbound.extractInboundLead({
    full_name: 'سارة',
    phone_number: '0551112233',
    campaign_name: 'حملة ميتا',
    source: 'meta',
  });
  assert.equal(meta.source, 'meta');
  assert.equal(meta.campaign, 'حملة ميتا');
  assert.equal(meta.platformPing, false);

  const ping = inbound.extractInboundLead({leadgen_id: '123', object: 'leadgen'});
  assert.equal(ping.platformPing, true);
  assert.equal(ping.phone, '');
  assert.equal(ping.source, 'meta');

  const tiktok = inbound.extractInboundLead({name: 'خالد', mobile: '٥٥١١١١٢٢٣٣', source: 'tiktok', ad_name: 'إعلان'});
  assert.equal(tiktok.source, 'tiktok');
  assert.equal(tiktok.campaign, 'إعلان');

  const letter = mail.reregistrationEmail({
    name: 'علي <script>',
    phone: '0551234567',
    stageLabel: 'عميل جديد',
    sourceLabel: 'ميتا',
    campaign: 'حملة الربيع',
    submittedName: 'علي الجديد',
    submittedNotes: 'يريد فيلا',
    url: 'https://sas.test/crm/leads/lead-1',
    when: 'اليوم',
  });
  assert.match(letter.subject, /إعادة تسجيل عميل/);
  assert.match(letter.subject, /علي/);
  assert.match(letter.text, /0551234567/);
  assert.match(letter.text, /المرحلة الحالية: عميل جديد/);
  assert.match(letter.text, /مصدر التسجيل الجديد: ميتا/);
  assert.match(letter.text, /حملة الربيع/);
  assert.match(letter.text, /https:\/\/sas\.test\/crm\/leads\/lead-1/);
  assert.match(letter.html, /dir="rtl"/);
  assert.match(letter.html, /#3F1A44/);
  assert.match(letter.html, /#d1d5db/);
  assert.match(letter.html, /color:#111/);
  assert.match(letter.html, /علي &lt;script&gt;/);
  assert.doesNotMatch(letter.html, /<script>/);

  await build({
    entryPoints: ['lib/lead-schema.ts'],
    outfile: join(out, 'schema.cjs'),
    bundle: true,
    platform: 'node',
    format: 'cjs',
    external: ['mysql2/promise'],
  });
  const {ensureLeadSchema, resetLeadSchemaCache} = require(join(out, 'schema.cjs'));
  const mem = new DatabaseSync(':memory:');
  mem.exec(`CREATE TABLE leads(id TEXT PRIMARY KEY, phone TEXT, stage TEXT, created_at TEXT, is_featured INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE lead_activity(id TEXT PRIMARY KEY, lead_id TEXT, user_id TEXT, action TEXT, details TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP);
    CREATE TABLE crm_users(id TEXT PRIMARY KEY, email TEXT, phone TEXT);`);
  mem.prepare('INSERT INTO leads (id, phone, stage, created_at) VALUES (?, ?, ?, ?)').run('a', '+966551234567', 'new', '2020-01-01');
  mem.prepare('INSERT INTO leads (id, phone, stage, created_at) VALUES (?, ?, ?, ?)').run('b', '٠٥٥١٢٣٤٥٦٧', 'contacted', '2020-01-02');
  mem.prepare('INSERT INTO leads (id, phone, stage, created_at) VALUES (?, ?, ?, ?)').run('c', '971501234567', 'new', '2020-01-03');
  function executor(db) {
    return {async execute(sql, values = []) {
      const text = String(sql).trim();
      if (text.startsWith('SHOW')) throw Error('near SHOW: syntax error');
      if (text.startsWith('SELECT')) return [db.prepare(text).all(...values)];
      return [{affectedRows: Number(db.prepare(text).run(...values).changes)}];
    }};
  }
  resetLeadSchemaCache();
  await ensureLeadSchema(executor(mem));
  assert.equal(mem.prepare("SELECT phone FROM leads WHERE id='a'").get().phone, '0551234567');
  assert.equal(mem.prepare("SELECT phone FROM leads WHERE id='b'").get().phone, '0551234567');
  assert.equal(mem.prepare("SELECT phone FROM leads WHERE id='c'").get().phone, '971501234567');
  const notes = mem.prepare("SELECT lead_id FROM lead_activity WHERE action='phone_duplicate' ORDER BY lead_id").all();
  assert.deepEqual(notes.map(row => row.lead_id), ['a', 'b']);
  assert.match(mem.prepare("SELECT details FROM lead_activity WHERE lead_id='a' AND action='phone_duplicate'").get().details, /لم يُدمج/);
  resetLeadSchemaCache();
  await ensureLeadSchema(executor(mem));
  assert.equal(mem.prepare("SELECT COUNT(*) AS n FROM lead_activity WHERE action='phone_duplicate'").get().n, 2);
  mem.close();

  const sql = new DatabaseSync(':memory:');
  sql.exec(`CREATE TABLE leads(id TEXT PRIMARY KEY, owner TEXT, created_by TEXT, assigned_to TEXT, field_assigned_to TEXT, name TEXT, phone TEXT, property_id TEXT, property_other TEXT, source TEXT, stage TEXT, notes TEXT, follow_up TEXT, created_at TEXT, updated_at TEXT);
    CREATE TABLE crm_users(id TEXT PRIMARY KEY, name TEXT, username TEXT, role TEXT, active INTEGER, email TEXT, created_at TEXT);
    CREATE TABLE lead_activity(id TEXT PRIMARY KEY, lead_id TEXT, user_id TEXT, action TEXT, details TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP);`);
  const admin = crypto.randomUUID();
  const sales = crypto.randomUUID();
  sql.prepare('INSERT INTO crm_users (id, name, username, role, active, email, created_at) VALUES (?, ?, ?, ?, 1, ?, ?)').run(admin, 'إدارة', 'admin', 'admin', 'ops@sas.test', '2020-01-01');
  sql.prepare('INSERT INTO crm_users (id, name, username, role, active, email, created_at) VALUES (?, ?, ?, ?, 1, ?, ?)').run(sales, 'مندوب', 'sales', 'sales', 'rep@sas.test', '2020-01-02');
  const driver = {async execute(query, args = []) {
    const text = String(query);
    const statement = sql.prepare(text);
    return /^SELECT/i.test(text.trim()) ? [statement.all(...args)] : [{affectedRows: Number(statement.run(...args).changes)}];
  }};
  globalThis.phonePool = driver;
  globalThis.sentMail = [];
  globalThis.mailThrows = false;
  Object.assign(process.env, {
    DB_HOST: 'synthetic',
    DB_USER: 'synthetic',
    DB_PASSWORD: 'synthetic',
    DB_NAME: 'synthetic',
    NEXTAUTH_URL: 'https://sas.test',
    LEAD_WEBHOOK_SECRET: 'lead-secret-token',
  });
  const boundary = {name: 'phone-boundary', setup(b) {
    b.onResolve({filter: /^mysql2\/promise$/}, () => ({path: 'mysql', namespace: 'test'}));
    b.onResolve({filter: /[\\/]mail$/}, () => ({path: 'mail', namespace: 'test'}));
    b.onLoad({filter: /.*/, namespace: 'test'}, (args) => ({
      loader: 'js',
      contents: args.path === 'mysql'
        ? 'export default {createPool(){return globalThis.phonePool}}'
        : 'export async function sendMail(msg){if(globalThis.mailThrows)throw Error("smtp down");globalThis.sentMail.push(msg);return true}',
    }));
  }};
  await build({
    entryPoints: ['lib/lead-intake.ts'],
    outfile: join(out, 'intake.cjs'),
    bundle: true,
    platform: 'node',
    format: 'cjs',
    plugins: [boundary],
  });
  const intake = require(join(out, 'intake.cjs'));
  assert.equal(intake.leadWebhookAuthorized('lead-secret-token'), true);
  assert.equal(intake.leadWebhookAuthorized('nope'), false);
  assert.equal(intake.leadWebhookAuthorized(''), false);

  const created = await intake.acceptInboundLead({
    name: 'عميل الموقع',
    phone: '+966 55 222 3344',
    source: 'contact',
    notes: 'من الصفحة',
  }, 'contact');
  assert.equal(created.ok, true);
  assert.equal(created.duplicate, false);
  assert.equal(sql.prepare('SELECT phone, source FROM leads WHERE id=?').get(created.id).phone, '0552223344');
  assert.equal(sql.prepare('SELECT source FROM leads WHERE id=?').get(created.id).source, 'contact');
  assert.equal(globalThis.sentMail.length, 1);
  assert.match(globalThis.sentMail[0].subject, /عميل جديد سجل — بحاجة للتوزيع/);
  assert.match(globalThis.sentMail[0].text, /0552223344/);
  assert.match(globalThis.sentMail[0].text, /عميل الموقع/);
  assert.match(globalThis.sentMail[0].text, /نموذج التواصل/);
  assert.match(globalThis.sentMail[0].html, /#3F1A44/);
  assert.match(globalThis.sentMail[0].html, /#d1d5db/);
  assert.match(globalThis.sentMail[0].html, /color:#111/);
  assert.equal(globalThis.sentMail[0].to.includes('ops@sas.test'), true);

  sql.prepare('UPDATE leads SET assigned_to=? WHERE id=?').run(sales, created.id);
  globalThis.sentMail = [];
  globalThis.mailThrows = true;
  const again = await intake.acceptInboundLead({
    name: 'اسم جديد',
    phone: '٠٠٩٦٦٥٥٢٢٢٣٣٤٤',
    source: 'meta',
    campaign_name: 'حملة الخريف',
    notes: 'أعاد التعبئة',
  }, 'meta');
  assert.equal(again.ok, true, again.error);
  assert.equal(again.duplicate, true);
  assert.equal(again.id, created.id);
  assert.equal(sql.prepare('SELECT COUNT(*) AS n FROM leads').get().n, 1);
  const activity = sql.prepare("SELECT details FROM lead_activity WHERE lead_id=? AND action='reregistered'").get(created.id);
  assert.match(activity.details, /حملة الخريف/);
  assert.match(activity.details, /اسم جديد/);
  assert.equal(globalThis.sentMail.length, 0, 'mail failure does not record a send');

  globalThis.mailThrows = false;
  globalThis.sentMail = [];
  const third = await intake.acceptInboundLead({
    full_name: 'من سناب',
    phone_number: '552223344',
    source: 'snapchat',
    form_name: 'نموذج سناب',
  }, 'snapchat');
  assert.equal(third.ok, true);
  assert.equal(third.duplicate, true);
  assert.equal(sql.prepare('SELECT COUNT(*) AS n FROM leads').get().n, 1);
  assert.equal(globalThis.sentMail.length, 2);
  assert.equal(globalThis.sentMail[0].to, 'rep@sas.test');
  assert.equal(globalThis.sentMail[1].to.includes('ops@sas.test'), true);
  assert.equal(globalThis.sentMail[1].to.includes('sasalthra.sa@gmail.com'), true);
  assert.match(globalThis.sentMail[0].subject, /إعادة تسجيل/);
  assert.match(globalThis.sentMail[0].text, /0552223344/);
  assert.match(globalThis.sentMail[0].text, /عميل الموقع/);
  assert.match(globalThis.sentMail[0].text, /سناب/);
  assert.match(globalThis.sentMail[0].text, /نموذج سناب/);
  assert.match(globalThis.sentMail[0].text, new RegExp(`https://sas\\.test/crm/leads/${created.id}`));
  assert.match(globalThis.sentMail[0].html, /#3F1A44/);

  sql.prepare('UPDATE leads SET assigned_to=? WHERE id=?').run('', created.id);
  globalThis.sentMail = [];
  const unassigned = await intake.acceptInboundLead({name: 'بدون مندوب', phone: '0552223344', source: 'google'}, 'google');
  assert.equal(unassigned.duplicate, true);
  assert.equal(globalThis.sentMail.length, 1);
  assert.equal(globalThis.sentMail[0].to.includes('ops@sas.test'), true);
  assert.equal(String(globalThis.sentMail[0].to).includes('rep@sas.test'), false);

  const honeypot = await intake.acceptInboundLead({name: 'بوت', phone: '0550000000', company: 'spam'}, 'contact');
  assert.equal(honeypot.ok, true);
  assert.equal(honeypot.ignored, true);
  assert.equal(sql.prepare('SELECT COUNT(*) AS n FROM leads').get().n, 1);

  const missing = await intake.acceptInboundLead({name: 'بلا رقم', phone: 'abc', source: 'contact'}, 'contact');
  assert.equal(missing.ok, false);
  assert.equal(missing.status, 400);

  const kept = await intake.acceptInboundLead({name: 'دولي', phone: '+971501112233', source: 'tiktok'}, 'tiktok');
  assert.equal(kept.ok, true);
  assert.equal(sql.prepare('SELECT phone FROM leads WHERE id=?').get(kept.id).phone, '971501112233');

  const pingResult = await intake.acceptInboundLead({leadgen_id: '99'}, 'meta');
  assert.equal(pingResult.ok, true);
  assert.equal(pingResult.ignored, true);

  sql.close();
  console.log('PASS Saudi 05 normalizer, search, migration notes, inbound duplicate email');
} finally {
  rmSync(out, {recursive: true, force: true});
}
