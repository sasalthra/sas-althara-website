import {build} from 'esbuild';
import {createRequire} from 'node:module';
import {existsSync, mkdtempSync, readFileSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import assert from 'node:assert/strict';

const out = mkdtempSync(join(tmpdir(), 'sas-assistant-'));
const alias = {
  name: 'alias',
  setup(b) {
    b.onResolve({filter: /^@\//}, args => {
      const base = join(process.cwd(), args.path.slice(2));
      const found = [base, `${base}.ts`, `${base}.tsx`, `${base}.js`, `${base}.json`].find(path => existsSync(path));
      return {path: found || base};
    });
  },
};
const serverOnly = {
  name: 'server-only',
  setup(b) {
    b.onResolve({filter: /^server-only$/}, () => ({path: 'guard', namespace: 'guard'}));
    b.onLoad({filter: /.*/, namespace: 'guard'}, () => ({contents: '', loader: 'js'}));
  },
};

function sqliteExecutor(db) {
  return {async execute(sql, values = []) {
    const text = String(sql).trim();
    if (text.startsWith('SHOW')) throw Error('near SHOW: syntax error');
    if (text.startsWith('SELECT')) return [db.prepare(text).all(...values)];
    return [{affectedRows: Number(db.prepare(text).run(...values).changes)}];
  }};
}

function sqliteDb(sql) {
  return {prepare(query) {
    let args = [];
    return {
      bind(...values) { args = values; return this; },
      async all() { return {results: sql.prepare(query).all(...args)}; },
      async first() { return sql.prepare(query).get(...args) ?? null; },
      async run() { return {meta: {changes: Number(sql.prepare(query).run(...args).changes)}}; },
    };
  }};
}

try {
  await build({
    entryPoints: ['lib/admin-assistant.ts'],
    outfile: join(out, 'assistant.cjs'),
    bundle: true,
    platform: 'node',
    format: 'cjs',
  });
  const assistant = createRequire(import.meta.url)(join(out, 'assistant.cjs'));
  const now = new Date('2026-09-20T00:00:00.000Z');
  const leads = [
    {id: 'late', name: 'عميل_سري', phone: '0551112233', stage: 'new', source: 'meta', notes: 'حملة: الربيع', assignedTo: 'sales', fieldAssignedTo: '', createdAt: '2026-09-01T00:00:00.000Z', updatedAt: '2026-09-10T00:00:00.000Z'},
    {id: 'edge', name: 'عميل_حد', phone: '0552223344', stage: 'contacted', source: 'manual', notes: '', assignedTo: 'sales', fieldAssignedTo: '', createdAt: '2026-09-17T00:00:00.000Z', updatedAt: '2026-09-17T00:00:00.000Z'},
    {id: 'fresh', name: 'عميل_حديث', phone: '0553334455', stage: 'negotiation', source: 'website', notes: '', assignedTo: 'sales', fieldAssignedTo: '', createdAt: '2026-09-19T00:00:00.000Z', updatedAt: '2026-09-19T00:00:00.000Z'},
    {id: 'won', name: 'عميل_عقد', phone: '0554445566', stage: 'contract_signed', source: 'excel', notes: '', assignedTo: 'sales', fieldAssignedTo: '', createdAt: '2026-08-01T00:00:00.000Z', updatedAt: '2026-08-01T00:00:00.000Z'},
    {id: 'paid', name: 'عميل_عربون', phone: '0555556677', stage: 'deposit_paid', source: 'manual', notes: '', assignedTo: 'sales', fieldAssignedTo: '', createdAt: '2026-08-02T00:00:00.000Z', updatedAt: '2026-08-02T00:00:00.000Z'},
    {id: 'hand', name: 'عميل_افراغ', phone: '0556667788', stage: 'transferred', source: 'manual', notes: '', assignedTo: 'sales', fieldAssignedTo: '', createdAt: '2026-08-03T00:00:00.000Z', updatedAt: '2026-08-03T00:00:00.000Z'},
    {id: 'shut', name: 'عميل_مغلق', phone: '0557778899', stage: 'closed', source: 'manual', notes: '', assignedTo: 'sales', fieldAssignedTo: '', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z'},
    {id: 'field', name: 'عميل_ميدان', phone: '0558889900', stage: 'field_dispatch', source: 'manual', notes: 'الحملة: معرض الرياض', assignedTo: '', fieldAssignedTo: 'field', createdAt: '2026-09-18T00:00:00.000Z', updatedAt: '2026-09-18T00:00:00.000Z'},
    {id: 'loose', name: 'عميل_بلا', phone: '0559990011', stage: 'postponed', source: 'manual', notes: '', assignedTo: '', fieldAssignedTo: '', createdAt: '2026-09-01T00:00:00.000Z', updatedAt: '2026-09-01T00:00:00.000Z'},
  ];
  const users = [
    {id: 'sales', name: 'نورة', role: 'sales', active: true, lastLoginAt: '2026-09-18T00:00:00.000Z'},
    {id: 'field', name: 'خالد', role: 'field', active: true, lastLoginAt: null},
    {id: 'idle', name: 'ليان', role: 'sales', active: true, lastLoginAt: '2026-09-01T00:00:00.000Z'},
  ];
  const activityAt = new Map([
    ['fresh', Date.parse('2026-09-19T00:00:00.000Z')],
    ['field', Date.parse('2026-09-18T00:00:00.000Z')],
  ]);
  const snapshot = assistant.assembleSnapshot({
    leads, users, activityAt, propertyIds: ['p1', 'p1', 'p2'], spend: {available: false, total: 0}, now,
  });
  assert.equal(snapshot.kpis.overdue, 2, 'only open leads with no activity for more than 3 days');
  assert.equal(snapshot.alerts.some(alert => alert.id === 'edge'), false, 'exactly 3 days is not overdue');
  assert.equal(snapshot.alerts.some(alert => alert.id === 'fresh' || alert.id === 'shut' || alert.id === 'won'), false);
  assert.equal(snapshot.kpis.conversions, 3, 'contract, payment, and handover');
  assert.equal(snapshot.kpis.properties, 2);
  assert.equal(snapshot.kpis.campaignSpend.available, false);
  assert.equal(snapshot.alerts[0].id, 'loose');
  assert.equal(snapshot.alerts[0].days > snapshot.alerts[1].days, true);
  assert.equal(snapshot.unassignedOverdue, 1);
  assert.equal(snapshot.field.inStage, 1);
  assert.equal(snapshot.field.assigned, 1);
  assert.equal(snapshot.field.unassigned, 0);
  assert.deepEqual(snapshot.campaigns.map(row => row.label).sort(), ['الربيع', 'معرض الرياض'].sort());
  const nora = snapshot.employees.find(employee => employee.name === 'نورة');
  const khaled = snapshot.employees.find(employee => employee.name === 'خالد');
  const layan = snapshot.employees.find(employee => employee.name === 'ليان');
  assert.ok(nora && khaled && layan);
  assert.equal(nora.leads, 7);
  assert.equal(nora.overdue, 1);
  assert.equal(nora.conversions, 3);
  assert.equal(nora.conversionPct, 43);
  assert.equal(nora.lastLoginDays, 2);
  assert.equal(khaled.lastLoginDays, null);
  assert.equal(assistant.employeeLine(nora), 'نورة: 7 عميل، 1 متأخر، تحويل 43%، آخر دخول 2 يوم');
  assert.equal(assistant.employeeLine(khaled), 'خالد: 1 عميل، 0 متأخر، تحويل 0%، آخر دخول غير مسجل');
  for (const question of ['حلل أداء الموظفين', 'ملخص الفريق']) {
    const answer = assistant.answerDeterministic(question, snapshot);
    for (const employee of snapshot.employees) assert.match(answer, new RegExp(assistant.employeeLine(employee).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    assert.match(answer, /أسباب القصور/);
    assert.match(answer, /إجراءات مقترحة/);
    assert.equal(answer.includes('عميل_سري'), false);
    assert.equal(answer.includes('0551112233'), false);
  }
  const facts = JSON.stringify(assistant.modelFacts(snapshot));
  assert.equal(facts.includes('عميل_سري'), false);
  assert.equal(facts.includes('055'), false);
  assert.equal(facts.includes('نورة'), true);
  assert.equal(facts.includes('phone'), false);
  assert.match(assistant.answerDeterministic('ما توزيع المراحل؟', snapshot), /وقع عقد/);
  assert.match(assistant.answerDeterministic('المصادر والحملات', snapshot), /الربيع/);
  assert.match(assistant.answerDeterministic('المصادر والحملات', snapshot), /غير مسجّل في قاعدة البيانات/);
  assert.match(assistant.answerDeterministic('حالة التفويج الميداني', snapshot), /خالد: 1 عميل في التفويج/);
  assert.match(assistant.redactPhones('اتصل 0551112233 الآن'), /\[رقم\]/);
  console.log('PASS admin assistant aggregates, overdue rule, team lines, and model payload privacy');

  await build({
    entryPoints: ['lib/admin-assistant-data.ts'],
    outfile: join(out, 'data.cjs'),
    bundle: true,
    platform: 'node',
    format: 'cjs',
    plugins: [alias],
  });
  const data = createRequire(import.meta.url)(join(out, 'data.cjs'));
  const mem = new DatabaseSync(':memory:');
  mem.exec(`CREATE TABLE leads(id TEXT PRIMARY KEY, name TEXT, phone TEXT, stage TEXT, source TEXT, notes TEXT, assigned_to TEXT, field_assigned_to TEXT, created_at TEXT, updated_at TEXT);
    CREATE TABLE crm_users(id TEXT PRIMARY KEY, name TEXT, role TEXT, active INTEGER, last_login_at TEXT);
    CREATE TABLE lead_activity(lead_id TEXT, created_at TEXT);
    CREATE TABLE site_properties(id TEXT);`);
  mem.prepare('INSERT INTO leads VALUES (?,?,?,?,?,?,?,?,?,?)').run('late', 'عميل_سري', '0551112233', 'new', 'meta', 'حملة: الربيع', 'sales', '', '2026-09-01T00:00:00.000Z', '2026-09-10T00:00:00.000Z');
  mem.prepare('INSERT INTO leads VALUES (?,?,?,?,?,?,?,?,?,?)').run('fresh', 'عميل_حديث', '0553334455', 'new', 'manual', '', 'sales', '', '2026-09-19T00:00:00.000Z', '2026-09-19T00:00:00.000Z');
  mem.prepare('INSERT INTO crm_users VALUES (?,?,?,?,?)').run('sales', 'نورة', 'sales', 1, '2026-09-18T00:00:00.000Z');
  mem.prepare('INSERT INTO lead_activity VALUES (?,?)').run('fresh', '2026-09-19T00:00:00.000Z');
  mem.prepare('INSERT INTO site_properties VALUES (?)').run('assistant-only-property');
  const loaded = await data.loadAssistantSnapshot(sqliteDb(mem), now);
  assert.equal(loaded.kpis.overdue, 1);
  assert.equal(loaded.kpis.campaignSpend.available, false);
  assert.equal(loaded.kpis.campaignSpend.total, 0);
  assert.equal(loaded.alerts[0].name, 'عميل_سري');
  assert.equal(loaded.alerts[0].phone, '0551112233');
  assert.ok(loaded.kpis.properties >= 1);
  assert.equal(JSON.stringify(assistant.modelFacts(loaded)).includes('0551112233'), false);
  mem.exec('CREATE TABLE campaign_spend(amount REAL)');
  mem.prepare('INSERT INTO campaign_spend VALUES (?)').run(1250.5);
  const withSpend = await data.loadAssistantSnapshot(sqliteDb(mem), now);
  assert.equal(withSpend.kpis.campaignSpend.available, true);
  assert.equal(withSpend.kpis.campaignSpend.total, 1250.5);
  mem.close();
  console.log('PASS assistant SQL loader uses real rows and hides spend when the table is absent');

  await build({
    entryPoints: ['lib/lead-schema.ts'],
    outfile: join(out, 'schema.cjs'),
    bundle: true,
    platform: 'node',
    format: 'cjs',
    external: ['mysql2/promise'],
  });
  const schema = createRequire(import.meta.url)(join(out, 'schema.cjs'));
  const schemaDb = new DatabaseSync(':memory:');
  schemaDb.exec("CREATE TABLE leads(id TEXT PRIMARY KEY, stage TEXT, created_at TEXT); CREATE TABLE lead_activity(id TEXT PRIMARY KEY, lead_id TEXT, user_id TEXT, action TEXT, details TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP); CREATE TABLE crm_users(id TEXT PRIMARY KEY, email TEXT);");
  schema.resetLeadSchemaCache();
  await schema.ensureLeadSchema(sqliteExecutor(schemaDb));
  const settingsCols = schemaDb.prepare("SELECT name FROM pragma_table_info('ai_settings')").all().map(row => row.name);
  for (const column of ['id', 'provider', 'model', 'encrypted_key', 'updated_at']) assert.ok(settingsCols.includes(column), column);
  assert.equal(schemaDb.prepare("SELECT name FROM pragma_table_info('crm_users') WHERE name='last_login_at'").get().name, 'last_login_at');
  schema.resetLeadSchemaCache();
  await schema.ensureLeadSchema(sqliteExecutor(schemaDb));
  assert.equal(schemaDb.prepare("SELECT COUNT(*) AS n FROM pragma_table_info('crm_users') WHERE name='last_login_at'").get().n, 1);
  assert.equal(schemaDb.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE name='ai_settings'").get().n, 1);
  schemaDb.close();
  console.log('PASS runtime schema creates ai_settings and last_login_at once');

  globalThis.assistantUser = null;
  globalThis.assistantWrites = [];
  globalThis.assistantConfig = null;
  const scriptedLeads = [{
    id: 'late', name: 'عميل_سري', phone: '0551112233', stage: 'new', source: 'meta', notes: 'حملة: الربيع',
    assigned_to: 'sales', field_assigned_to: '', created_at: '2020-01-01T00:00:00.000Z', updated_at: '2020-01-01T00:00:00.000Z',
  }];
  const scriptedUsers = [{id: 'sales', name: 'نورة', role: 'sales', active: 1, last_login_at: '2026-09-28T00:00:00.000Z'}];
  const boundaries = {name: 'assistant-boundaries', setup(b) {
    b.onResolve({filter: /^server-only$/}, () => ({path: 'guard', namespace: 'guard'}));
    b.onLoad({filter: /.*/, namespace: 'guard'}, () => ({contents: '', loader: 'js'}));
    b.onResolve({filter: /[\\/]admin$/}, () => ({path: 'auth', namespace: 'test'}));
    b.onResolve({filter: /[\\/]crm-db$/}, () => ({path: 'db', namespace: 'test'}));
    b.onLoad({filter: /.*/, namespace: 'test'}, args => ({loader: 'js', contents: args.path === 'auth'
      ? 'export async function getCrmUser(){return globalThis.assistantUser}'
      : `export function crmDb(){return {prepare(sql){let args=[];return {bind(...v){args=v;return this},async all(){if(sql.includes('lead_activity'))return {results:[]};if(sql.includes('FROM crm_users'))return {results:globalThis.assistantUsers||[]};if(sql.includes('site_properties'))return {results:[]};if(sql.includes('FROM leads'))return {results:globalThis.assistantLeads||[]};return {results:[]}},async first(){if(sql.includes('SUM('))throw Error('no spend column');if(sql.includes('ai_settings'))return globalThis.assistantConfig;if(sql.includes('ai_usage'))return {requests:1};return null},async run(){if(globalThis.assistantDbError&&String(sql).includes('ai_settings'))throw globalThis.assistantDbError;globalThis.assistantWrites.push({sql,args});return {meta:{changes:1}}}}}}}; export async function crmTransaction(fn){return fn(crmDb())}`}));
  }};
  process.env.NEXTAUTH_URL = 'https://sas.test';
  globalThis.assistantLeads = scriptedLeads;
  globalThis.assistantUsers = scriptedUsers;
  await build({
    entryPoints: ['app/api/ai/assistant/route.ts'],
    outfile: join(out, 'route.cjs'),
    bundle: true,
    platform: 'node',
    format: 'cjs',
    plugins: [boundaries, alias],
  });
  await build({
    entryPoints: ['lib/secrets.server.ts'],
    outfile: join(out, 'secrets.cjs'),
    bundle: true,
    platform: 'node',
    format: 'cjs',
    plugins: [serverOnly],
  });
  const route = createRequire(import.meta.url)(join(out, 'route.cjs'));
  const {seal} = createRequire(import.meta.url)(join(out, 'secrets.cjs'));
  const request = (body, origin = 'https://sas.test') => new Request('https://sas.test/api/ai/assistant', {
    method: 'POST',
    headers: {origin, 'content-type': 'application/json'},
    body: JSON.stringify(body),
  });
  assert.equal((await route.GET()).status, 401);
  globalThis.assistantUser = {userId: 'sales-user', role: 'sales', name: 'مندوب'};
  assert.equal((await route.GET()).status, 403);
  assert.equal((await route.POST(request({question: 'ملخص الفريق'}))).status, 403);
  globalThis.assistantUser = {userId: 'supervisor-user', role: 'supervisor', name: 'مشرف'};
  const supervisor = await route.GET();
  assert.equal(supervisor.status, 200);
  const supervisorBody = await supervisor.json();
  assert.equal(supervisorBody.alerts[0].phone, '0551112233');
  assert.match(supervisorBody.alerts[0].line, /العميل عميل_سري دون متابعة منذ \d+ أيام/);
  assert.equal(supervisorBody.kpis.overdue, 1);
  assert.equal(supervisorBody.kpis.campaignSpend.available, false);
  delete process.env.OPENAI_API_KEY;
  delete process.env.OPENAI_MODEL;
  delete process.env.AI_PROVIDER;
  process.env.APP_ENCRYPTION_KEY = Buffer.alloc(32, 9).toString('base64');
  globalThis.assistantConfig = {provider: 'openai', model: 'test-model', encrypted_key: seal('test-provider-key-not-real', 'openai')};
  let captured = '';
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (_url, init) => {
    captured = String(init?.body || '');
    return new Response(JSON.stringify({choices: [{message: {content: 'راجع 0551112233'}}]}), {status: 200, headers: {'content-type': 'application/json'}});
  };
  globalThis.assistantUser = {userId: 'admin-user', role: 'admin', name: 'إدارة'};
  const modeled = await (await route.POST(request({question: 'ملخص الفريق 0551112233'}))).json();
  assert.equal(modeled.source, 'model');
  assert.equal(modeled.answer.includes('0551112233'), false);
  assert.match(modeled.answer, /\[رقم\]/);
  assert.equal(captured.includes('0551112233'), false);
  assert.equal(captured.includes('عميل_سري'), false);
  assert.equal(captured.includes('[رقم]'), true);
  assert.equal(captured.includes('نورة'), true);
  globalThis.fetch = async () => new Response('no', {status: 502});
  const fallback = await (await route.POST(request({question: 'حلل أداء الموظفين'}))).json();
  assert.equal(fallback.source, 'local');
  assert.match(fallback.answer, /نورة: \d+ عميل، \d+ متأخر، تحويل \d+%، آخر دخول \d+ يوم/);
  assert.equal(fallback.answer.includes('عميل_سري'), false);
  assert.equal(fallback.answer.includes('0551112233'), false);
  globalThis.fetch = originalFetch;
  delete process.env.APP_ENCRYPTION_KEY;
  globalThis.assistantConfig = null;
  const localOnly = await (await route.POST(request({question: 'ملخص الفريق'}))).json();
  assert.equal(localOnly.source, 'local');
  assert.match(localOnly.answer, /نورة:/);
  console.log('PASS assistant API is admin/supervisor only and sends aggregates without client phones');

  await build({
    entryPoints: ['app/api/ai/settings/route.ts'],
    outfile: join(out, 'settings.cjs'),
    bundle: true,
    platform: 'node',
    format: 'cjs',
    plugins: [boundaries, alias],
  });
  const settings = createRequire(import.meta.url)(join(out, 'settings.cjs'));
  globalThis.assistantUser = {userId: 'sales-user', role: 'sales', name: 'مندوب'};
  assert.equal((await settings.GET()).status, 403);
  globalThis.assistantUser = {userId: 'admin-user', role: 'admin', name: 'إدارة'};
  delete process.env.APP_ENCRYPTION_KEY;
  const missingKey = await settings.POST(request({provider: 'openai', model: 'sas_althra_ai', apiKey: 'test-provider-key-not-real'}));
  const missingBody = await missingKey.json();
  assert.equal(missingKey.status, 503);
  assert.match(missingBody.error, /APP_ENCRYPTION_KEY/);
  assert.equal(missingBody.error.includes('لم يتم تأكيد الحفظ'), false);
  process.env.APP_ENCRYPTION_KEY = Buffer.alloc(32, 4).toString('base64');
  globalThis.assistantWrites = [];
  assert.equal((await settings.POST(request({provider: 'openai', model: 'sas_althra_ai', apiKey: 'test-provider-key-not-real'}))).status, 200);
  const secretWrite = globalThis.assistantWrites.find(write => write.sql.includes('INSERT INTO ai_settings'));
  assert.ok(secretWrite);
  assert.equal(secretWrite.args.includes('test-provider-key-not-real'), false);
  delete process.env.APP_ENCRYPTION_KEY;
  console.log('PASS provider save names a missing encryption key and still stores ciphertext');

  process.env.APP_ENCRYPTION_KEY = Buffer.alloc(32, 4).toString('base64');
  globalThis.assistantUser = {userId: 'admin-user', role: 'admin', name: 'إدارة'};
  globalThis.assistantDbError = Object.assign(new Error("Table 'synthetic.ai_settings' doesn't exist"), {
    code: 'ER_NO_SUCH_TABLE',
    errno: 1146,
    sqlMessage: "Table 'synthetic.ai_settings' doesn't exist",
    sql: 'INSERT INTO ai_settings secret',
  });
  const dbFail = await settings.POST(request({provider: 'openai', model: 'sas_althra_ai', apiKey: 'test-provider-key-not-real'}));
  const dbBody = await dbFail.json();
  assert.equal(dbFail.status, 503);
  assert.match(dbBody.error, /ER_NO_SUCH_TABLE/);
  assert.match(dbBody.error, /ai_settings/);
  assert.equal(dbBody.error.includes('لم يتم تأكيد الحفظ'), false);
  assert.equal(dbBody.error.includes('secret'), false);
  globalThis.assistantUser = {userId: 'sales-user', role: 'sales', name: 'مندوب'};
  const hidden = await settings.POST(request({provider: 'openai', model: 'sas_althra_ai', apiKey: 'test-provider-key-not-real'}));
  const hiddenBody = await hidden.json();
  assert.equal(hidden.status, 403);
  assert.equal(hiddenBody.error.includes('ER_NO_SUCH_TABLE'), false);
  globalThis.assistantDbError = null;
  globalThis.assistantUser = {userId: 'admin-user', role: 'admin', name: 'إدارة'};
  delete process.env.APP_ENCRYPTION_KEY;
  console.log('PASS provider save shows the database code to an admin only');

  const envKey = 'sk-env-test-key-not-real';
  const warnings = [];
  const originalWarn = console.warn;
  console.warn = (...args) => { warnings.push(args.map(String).join(' ')); };
  process.env.OPENAI_API_KEY = envKey;
  process.env.OPENAI_MODEL = 'sas_althra_ai';
  delete process.env.AI_PROVIDER;
  delete process.env.APP_ENCRYPTION_KEY;
  globalThis.assistantConfig = {provider: 'openai', model: 'db-model', encrypted_key: 'not-a-real-sealed-key'};
  globalThis.assistantWrites = [];
  const envSettings = await (await settings.GET()).json();
  assert.equal(envSettings.source, 'env');
  assert.equal(envSettings.formEnabled, false);
  assert.equal(envSettings.model, 'gpt-4o-mini');
  assert.equal(envSettings.provider, 'openai');
  assert.equal(JSON.stringify(envSettings).includes(envKey), false);
  assert.equal('apiKey' in envSettings, false);
  assert.equal(warnings.some(line => line.includes(envKey)), false);
  assert.match(warnings.join('\n'), /sas_althra_ai/);
  assert.match(warnings.join('\n'), /gpt-4o-mini/);
  const blocked = await settings.POST(request({provider: 'openai', model: 'gpt-4o-mini', apiKey: 'posted-key-should-not-store'}));
  const blockedBody = await blocked.json();
  assert.equal(blocked.status, 409);
  assert.match(blockedBody.error, /إعدادات الخادم/);
  assert.equal(JSON.stringify(blockedBody).includes('posted-key-should-not-store'), false);
  assert.equal(JSON.stringify(blockedBody).includes(envKey), false);
  assert.equal(globalThis.assistantWrites.some(write => JSON.stringify(write).includes('posted-key-should-not-store')), false);
  globalThis.assistantUser = {userId: 'admin-user', role: 'admin', name: 'إدارة'};
  const envStatus = await (await route.GET()).json();
  assert.equal(envStatus.configured, true);
  assert.equal(envStatus.providerSource, 'env');
  assert.equal(envStatus.model, 'gpt-4o-mini');
  assert.equal(JSON.stringify(envStatus).includes(envKey), false);
  let calls = [];
  globalThis.fetch = async (url, init) => {
    const headers = init?.headers || {};
    calls.push({url: String(url), model: JSON.parse(init.body).model, authorization: headers.Authorization || '', apiKeyHeader: headers['x-api-key'] || ''});
    const model = calls.at(-1).model;
    if (model !== 'gpt-4o-mini') {
      return new Response(JSON.stringify({error: {code: 'model_not_found', message: 'The model does not exist or you do not have access to it.'}}), {status: 404, headers: {'content-type': 'application/json'}});
    }
    return new Response(JSON.stringify({choices: [{message: {content: 'إجابة من الخادم'}}]}), {status: 200, headers: {'content-type': 'application/json'}});
  };
  const envAnswer = await (await route.POST(request({question: 'ملخص الفريق'}))).json();
  assert.equal(envAnswer.source, 'model');
  assert.equal(envAnswer.answer, 'إجابة من الخادم');
  assert.deepEqual(calls.map(call => call.model), ['gpt-4o-mini']);
  assert.equal(calls[0].authorization, `Bearer ${envKey}`);
  assert.equal(JSON.stringify(envAnswer).includes(envKey), false);
  assert.equal(JSON.stringify(globalThis.assistantWrites).includes(envKey), false);
  process.env.OPENAI_MODEL = 'gpt-4.1-preview';
  calls = [];
  const retried = await (await route.POST(request({question: 'ملخص الفريق'}))).json();
  assert.equal(retried.source, 'model');
  assert.deepEqual(calls.map(call => call.model), ['gpt-4.1-preview', 'gpt-4o-mini']);
  assert.match(warnings.join('\n'), /model_not_found/);
  assert.equal(warnings.join('\n').includes(envKey), false);
  globalThis.fetch = async () => new Response(JSON.stringify({error: {message: 'LEAKED_PROVIDER_BODY', code: 'invalid_api_key'}}), {status: 401, headers: {'content-type': 'application/json'}});
  const invalidKey = await (await route.POST(request({question: 'ملخص الفريق'}))).json();
  assert.equal(invalidKey.source, 'local');
  assert.match(invalidKey.answer, /مفتاح المزود غير صالح/);
  assert.match(invalidKey.notice, /مفتاح المزود غير صالح/);
  assert.match(invalidKey.answer, /نورة:/);
  assert.equal(invalidKey.answer.includes('LEAKED_PROVIDER_BODY'), false);
  assert.equal(JSON.stringify(invalidKey).includes(envKey), false);
  globalThis.fetch = async () => new Response(JSON.stringify({error: {message: 'LEAKED_PROVIDER_BODY', code: 'insufficient_quota'}}), {status: 429, headers: {'content-type': 'application/json'}});
  const quota = await (await route.POST(request({question: 'حلل أداء الموظفين'}))).json();
  assert.match(quota.answer, /حصة الاستخدام/);
  assert.match(quota.answer, /نورة:/);
  assert.equal(quota.answer.includes('LEAKED_PROVIDER_BODY'), false);
  globalThis.fetch = async () => { throw new TypeError('fetch failed'); };
  const offline = await (await route.POST(request({question: 'ملخص الفريق'}))).json();
  assert.match(offline.answer, /مشكلة في الشبكة/);
  assert.match(offline.answer, /نورة:/);
  assert.equal(offline.source, 'local');
  console.warn = originalWarn;
  globalThis.fetch = originalFetch;
  delete process.env.OPENAI_API_KEY;
  delete process.env.OPENAI_MODEL;
  delete process.env.AI_PROVIDER;
  console.log('PASS env provider ignores the database key, hides invalid models, and keeps Arabic fallbacks');

  const panelSource = readFileSync('app/crm/ai-panel.tsx', 'utf8');
  const css = readFileSync('app/crm/crm.css', 'utf8');
  const assistantCss = css.slice(css.indexOf('.admin-assistant'));
  assert.match(panelSource, /المساعد الإداري/);
  assert.match(panelSource, /مدير عمليات وتسويق مساعد مبني على بيانات النظام الحالية/);
  assert.match(panelSource, /اسأل عن أداء الشركة/);
  assert.match(panelSource, /تنبيهات تحتاج تدخل/);
  assert.match(panelSource, /إعدادات المزود/);
  assert.match(panelSource, /sessionStorage/);
  assert.match(assistantCss, /#3F1A44/);
  assert.match(assistantCss, /#111/);
  assert.match(assistantCss, /#d1d5db/);
  assert.doesNotMatch(assistantCss, /#(?:0d9488|14b8a6|0f766e|10b981|16a34a|22c55e|d4af37|c9a227|b45309)/i);
  await build({
    stdin: {
      contents: `import React from 'react';import {renderToStaticMarkup} from 'react-dom/server';import AiPanel from './app/crm/ai-panel';import CRM from './app/crm/workspace';export const panel=renderToStaticMarkup(<AiPanel admin={true}/>);export const supervisorPanel=renderToStaticMarkup(<AiPanel admin={false}/>);export const envPanel=renderToStaticMarkup(<AiPanel admin envModel="gpt-4o-mini"/>);export const envStaff=renderToStaticMarkup(<AiPanel admin={false} envModel="gpt-4o-mini"/>);export const admin=renderToStaticMarkup(<CRM role="admin"/>);export const supervisor=renderToStaticMarkup(<CRM role="supervisor"/>);export const sales=renderToStaticMarkup(<CRM role="sales"/>);`,
      resolveDir: process.cwd(),
      loader: 'tsx',
    },
    outfile: join(out, 'ui.cjs'),
    bundle: true,
    platform: 'node',
    format: 'cjs',
    plugins: [alias],
  });
  const ui = createRequire(import.meta.url)(join(out, 'ui.cjs'));
  assert.match(ui.panel, /المساعد الإداري/);
  assert.match(ui.panel, /اسأل عن أداء الشركة/);
  assert.match(ui.panel, /حلل أداء الموظفين/);
  assert.match(ui.panel, /ملخص الفريق/);
  assert.match(ui.panel, /إعدادات المزود/);
  assert.match(ui.panel, /assistant-badge/);
  assert.doesNotMatch(ui.supervisorPanel, /إعدادات المزود/);
  assert.match(ui.envPanel, /المزود مضبوط من إعدادات الخادم \(env\) — الطراز: gpt-4o-mini/);
  assert.doesNotMatch(ui.envPanel, /type="password"/);
  assert.doesNotMatch(ui.envPanel, /حفظ الإعدادات والمفتاح/);
  assert.doesNotMatch(ui.envPanel, /APP_ENCRYPTION_KEY/);
  assert.doesNotMatch(ui.envStaff, /إعدادات الخادم \(env\)/);
  assert.match(ui.envStaff, /اسأل عن أداء الشركة/);
  assert.match(ui.admin, /المساعد الإداري/);
  assert.match(ui.supervisor, /المساعد الإداري/);
  assert.doesNotMatch(ui.sales, /المساعد الإداري/);
  console.log('PASS admin assistant markup is RTL-branded and hidden from sales');
} finally {
  rmSync(out, {recursive: true, force: true});
}
