import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {mkdtempSync, readFileSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createRequire} from 'node:module';
import {DatabaseSync} from 'node:sqlite';

const output = mkdtempSync(join(tmpdir(), 'sas-telegram-'));
const require = createRequire(import.meta.url);
try {
  await build({
    entryPoints: ['lib/telegram-parse.ts', 'lib/telegram-export.ts', 'lib/telegram-ids.ts', 'lib/telegram-bot.ts'],
    outdir: output,
    bundle: true,
    platform: 'node',
    format: 'cjs',
    outExtension: {'.js': '.cjs'},
  });
  const {parseOffer} = require(join(output, 'telegram-parse.cjs'));
  const {groupExportMessages, messageText} = require(join(output, 'telegram-export.cjs'));
  const {normalizeChatId, sourceKeyFor, propertyIdFor} = require(join(output, 'telegram-ids.cjs'));
  const {webhookAuthorized} = require(join(output, 'telegram-bot.cjs'));

  const villa = `
♦️ فيلًا .

📍 الموقع : حي الرياض جدة
📝 مواصفات الفيلا :-

▪️المساحه : 320
▪️السعر : 1,170,000
▪️ عدد الفلل :1

📌 الدور الارضي :-
▪️عدد المجالس : 2
▪️ دورات المياه : 2

📌دور الاول
▪️عدد الغرف :3
▪️دورات المياه:2

📌 الدور الملحق
▪️عدد الغرف : 1
▪️ دورات المياه : 1
`;
  const parsedVilla = parseOffer(villa);
  assert.equal(parsedVilla.type, 'فلل');
  assert.equal(parsedVilla.purpose, null);
  assert.equal(parsedVilla.price, 1170000);
  assert.equal(parsedVilla.area, 320);
  assert.equal(parsedVilla.city, 'جدة');
  assert.equal(parsedVilla.address, 'الرياض');
  assert.equal(parsedVilla.beds, '4');
  assert.equal(parsedVilla.baths, '5');
  assert.equal(parsedVilla.streetWidth, null);
  assert.equal(parsedVilla.facade, null);
  assert.equal(parsedVilla.age, null);
  assert.equal(parsedVilla.description, villa);
  assert.equal(parsedVilla.title, 'فيلا حي الرياض جدة');

  const apartment = 'شقة للبيع في حي الزهراء بجدة\n4 غرف\n3 دورات مياه\nالمساحة 180م\nالسعر ٢٫٥ مليون';
  const parsedApartment = parseOffer(apartment);
  assert.equal(parsedApartment.type, 'شقق');
  assert.equal(parsedApartment.purpose, 'بيع');
  assert.equal(parsedApartment.price, 2500000);
  assert.equal(parsedApartment.area, 180);
  assert.equal(parsedApartment.beds, '4');
  assert.equal(parsedApartment.baths, '3');
  assert.equal(parsedApartment.city, 'جدة');
  assert.equal(parsedApartment.address, 'الزهراء');
  assert.equal(parsedApartment.description, apartment);

  const land = 'أرض للإيجار\nحي النعيم — جدة\nالمساحة: ٢٬٥٠٠ م²\nالسعر: ٤٥ ألف ريال سنوياً\nعرض الشارع: 20 متر\nواجهة شمالية\nعمر العقار: 8 سنوات';
  const parsedLand = parseOffer(land);
  assert.equal(parsedLand.type, 'أرض');
  assert.equal(parsedLand.purpose, 'إيجار');
  assert.equal(parsedLand.price, 45000);
  assert.equal(parsedLand.area, 2500);
  assert.equal(parsedLand.city, 'جدة');
  assert.equal(parsedLand.address, 'النعيم');
  assert.equal(parsedLand.streetWidth, '20');
  assert.equal(parsedLand.facade, 'شمالية');
  assert.equal(parsedLand.age, '8');
  assert.equal(parsedLand.beds, null);
  assert.equal(parsedLand.baths, null);

  const shop = 'محل تجاري للإيجار\nالموقع: حي الصفا، مكة\nالسعر: مليون و200 ألف\nعرض الشارع 15م\nالواجهة: غربية\nالعمر: جديد';
  const parsedShop = parseOffer(shop);
  assert.equal(parsedShop.type, 'محل');
  assert.equal(parsedShop.purpose, 'إيجار');
  assert.equal(parsedShop.price, 1200000);
  assert.equal(parsedShop.streetWidth, '15');
  assert.equal(parsedShop.facade, 'غربية');
  assert.equal(parsedShop.age, 'جديد');
  assert.equal(parsedShop.city, 'مكة');
  assert.equal(parsedShop.address, 'الصفا');
  assert.equal(parsedShop.beds, null);
  assert.equal(parsedShop.baths, null);
  assert.equal(parsedShop.area, null);

  const bare = 'السلام عليكم عندنا عرض مناسب تواصلوا خاص';
  const parsedBare = parseOffer(bare);
  assert.equal(parsedBare.type, null);
  assert.equal(parsedBare.purpose, null);
  assert.equal(parsedBare.price, null);
  assert.equal(parsedBare.area, null);
  assert.equal(parsedBare.city, null);
  assert.equal(parsedBare.address, null);
  assert.equal(parsedBare.beds, null);
  assert.equal(parsedBare.baths, null);
  assert.equal(parsedBare.streetWidth, null);
  assert.equal(parsedBare.facade, null);
  assert.equal(parsedBare.age, null);
  assert.equal(parsedBare.description, bare);
  assert.equal(parsedBare.title, bare);
  for (const key of ['beds', 'baths', 'price', 'type', 'purpose']) assert.equal(parsedBare[key], null, key);

  const floor = 'دور للإيجار\nحي السلامة جدة\nدورات المياه كثيرة لكن بلا عدد';
  const parsedFloor = parseOffer(floor);
  assert.equal(parsedFloor.type, 'دور');
  assert.equal(parsedFloor.purpose, 'إيجار');
  assert.equal(parsedFloor.address, 'السلامة');
  assert.equal(parsedFloor.city, 'جدة');
  assert.equal(parsedFloor.baths, null);

  assert.equal(parseOffer('فيلا للبيع\nالسعر: 580').price, 580);
  assert.equal(parseOffer('أرض للبيع\nالسعر مليون').price, 1000000);
  assert.equal(parseOffer('فيلا للبيع\nالسعر: 2,500,000').price, 2500000);
  assert.equal(parseOffer('فيلا للبيع\nالسعر: ١٬١٧٠٬٠٠٠').price, 1170000);
  assert.equal(parseOffer('شقة للبيع\nالسعر: 1.170.000').price, 1170000);
  assert.equal(parseOffer('عمارة للبيع في حي الشاطئ جدة\nالسعر 3 مليون').type, 'عمارة');

  const messages = [
    {id: 1, type: 'message', date_unixtime: '10', photo: 'photos/a.jpg', text: ''},
    {id: 2, type: 'message', date_unixtime: '10', photo: 'photos/b.jpg', text: [{type: 'plain', text: 'شقة للبيع'}]},
    {id: 3, type: 'message', date_unixtime: '10', text: 'رسالة مستقلة'},
    {id: 4, type: 'message', date_unixtime: '11', photo: 'photos/c.jpg', text: 'واحد', media_group_id: '99'},
    {id: 5, type: 'message', date_unixtime: '12', photo: 'photos/d.jpg', text: '', media_group_id: '99'},
    {id: 6, type: 'service', date_unixtime: '13', text: 'joined'},
  ];
  const groups = groupExportMessages(messages);
  assert.equal(groups.length, 3);
  assert.deepEqual(groups[0].map(item => item.id), [1, 2]);
  assert.equal(messageText(groups[0][1]), 'شقة للبيع');
  assert.deepEqual(groups[1].map(item => item.id), [3]);
  assert.deepEqual(groups[2].map(item => item.id), [4, 5]);

  assert.equal(normalizeChatId('123456'), '-100123456');
  assert.equal(normalizeChatId('-100123456'), '-100123456');
  assert.equal(sourceKeyFor('1', '5', 'abc'), '-1001:g:abc');
  assert.equal(sourceKeyFor('1', '5', null), '-1001:m:5');
  assert.equal(propertyIdFor('1', '5', null), 'tg-1001-m-5');

  process.env.TELEGRAM_WEBHOOK_SECRET = 'abcDEF12_-';
  assert.equal(webhookAuthorized('abcDEF12_-'), true);
  assert.equal(webhookAuthorized('abcDEF12_-x'), false);
  assert.equal(webhookAuthorized('abcDEF12_'), false);
  assert.equal(webhookAuthorized(null), false);
  delete process.env.TELEGRAM_WEBHOOK_SECRET;
  assert.equal(webhookAuthorized('abcDEF12_-'), false);

  const sync = readFileSync('lib/telegram-sync.ts', 'utf8');
  assert.match(sync, /PUBLISHED_STATUS = 'published'/);
  assert.doesNotMatch(sync, /['"]draft['"]/);
  assert.match(sync, /nullable\(parsed\.beds\)/);
  assert.match(sync, /nullable\(parsed\.baths\)/);
  const schema = readFileSync('lib/lead-schema.ts', 'utf8');
  for (const column of ['telegram_chat_id', 'telegram_message_id', 'telegram_media_group_id', 'beds', 'baths']) {
    assert.match(schema, new RegExp(column));
  }

  await build({
    entryPoints: ['lib/lead-schema.ts'],
    outfile: join(output, 'lead-schema.cjs'),
    bundle: true,
    platform: 'node',
    format: 'cjs',
    external: ['mysql2/promise'],
  });
  const {ensureLeadSchema, resetLeadSchemaCache} = require(join(output, 'lead-schema.cjs'));
  const mem = new DatabaseSync(':memory:');
  mem.exec("CREATE TABLE leads(id TEXT PRIMARY KEY, stage TEXT, created_at TEXT); CREATE TABLE lead_activity(id TEXT PRIMARY KEY, lead_id TEXT, user_id TEXT, action TEXT, details TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP); CREATE TABLE crm_users(id TEXT PRIMARY KEY, email TEXT);");
  function sqliteExecutor(db) {
    return {async execute(sql, values = []) {
      const text = String(sql).trim();
      if (text.startsWith('SHOW')) throw Error('near SHOW: syntax error');
      if (text.startsWith('SELECT')) return [db.prepare(text).all(...values)];
      return [{affectedRows: Number(db.prepare(text).run(...values).changes)}];
    }};
  }
  resetLeadSchemaCache();
  await ensureLeadSchema(sqliteExecutor(mem));
  const columns = mem.prepare("SELECT name, [notnull] AS required FROM pragma_table_info('site_properties')").all();
  const byName = new Map(columns.map(column => [column.name, column]));
  for (const name of ['beds', 'baths', 'telegram_chat_id', 'telegram_message_id', 'telegram_media_group_id', 'telegram_source_key']) {
    assert.ok(byName.has(name), name);
    assert.equal(byName.get(name).required, 0, `${name} stays nullable`);
  }
  assert.equal(mem.prepare("SELECT name FROM sqlite_master WHERE name='telegram_sync_log'").get().name, 'telegram_sync_log');
  mem.prepare("INSERT INTO site_properties (id, title, beds, baths, status, telegram_chat_id, telegram_message_id, telegram_source_key, created_at, updated_at) VALUES (?, ?, NULL, NULL, 'published', ?, ?, ?, ?, ?)").run('tg-1', 'عرض', '-1001', '9', '-1001:m:9', '2026-01-01', '2026-01-01');
  assert.equal(mem.prepare("SELECT beds FROM site_properties WHERE id='tg-1'").get().beds, null);
  assert.equal(mem.prepare("SELECT baths FROM site_properties WHERE id='tg-1'").get().baths, null);
  assert.equal(mem.prepare("SELECT status FROM site_properties WHERE id='tg-1'").get().status, 'published');
  assert.throws(() => mem.prepare("INSERT INTO site_properties (id, telegram_source_key) VALUES ('tg-2', '-1001:m:9')").run());
  resetLeadSchemaCache();
  await ensureLeadSchema(sqliteExecutor(mem));
  assert.equal(mem.prepare("SELECT COUNT(*) AS n FROM pragma_table_info('site_properties') WHERE name='beds'").get().n, 1);
  assert.equal(mem.prepare("SELECT beds FROM site_properties WHERE id='tg-1'").get().beds, null);
  mem.close();

  console.log('PASS Arabic offer parser, album grouping, webhook secret, nullable beds/baths, telegram source columns');
} finally {
  rmSync(output, {recursive: true, force: true});
}
