import assert from 'node:assert/strict';
import {assertCollationSafe} from './sqlite-report-sql.mjs';
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
    entryPoints: ['lib/telegram-parse.ts', 'lib/telegram-export.ts', 'lib/telegram-ids.ts', 'lib/telegram-bot.ts', 'lib/telegram-updates.ts', 'lib/telegram-sql.ts', 'lib/telegram-offers.ts', 'lib/property-price.ts'],
    outdir: output,
    bundle: true,
    platform: 'node',
    format: 'cjs',
    outExtension: {'.js': '.cjs'},
  });
  const {parseOffer} = require(join(output, 'telegram-parse.cjs'));
  const {groupExportMessages, messageText} = require(join(output, 'telegram-export.cjs'));
  const {normalizeChatId, sourceKeyFor, sourceKeyHash, propertyIdFor, exportChatId, offerPropertyId, offerSourceKey} = require(join(output, 'telegram-ids.cjs'));
  const {webhookAuthorized} = require(join(output, 'telegram-bot.cjs'));
  const {parseTelegramUpdate, groupIncomingMessages, collapseAlbum, chatAllowed} = require(join(output, 'telegram-updates.cjs'));
  const {readExportChats, supportedExportType} = require(join(output, 'telegram-export.cjs'));
  const {propertyLookupSql, propertyByOfferSql, messageLookupSql, messagesByChatSql, redirectLookupSql, deletePropertySql, recentSyncSql, seenChatLookupSql, seenChatUpdateSql, telegramDbError} = require(join(output, 'telegram-sql.cjs'));
  const {groupChatOffers, brandingFileIds, galleryPhotos, planOfferMerges, isDetailsText, OFFER_GAP_SECONDS} = require(join(output, 'telegram-offers.cjs'));
  const {exportMessageKind} = require(join(output, 'telegram-export.cjs'));
  const {formatListedPrice} = require(join(output, 'property-price.cjs'));

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
  assert.match(parsedVilla.description, /فيل/);
  assert.match(parsedVilla.description, /1,170,000/);
  assert.doesNotMatch(parsedVilla.description, /♦️/);
  assert.equal(parsedVilla.projectNumber, null);
  assert.equal(parsedVilla.priceFrom, false);
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

  const projectExample = `
مشروع sh / 1083
شقة
📌
📍 الموقع : حي التيسير .
📝 مواصفات الشقة :
◾️ عدد الوحدات : 7
◾️ عدد الغرف : 4
◾️ عدد الصالات : 1
◾️ دورات المياه : 3
◾️ المطبخ : 1
◾️ مساحة الشقة : 125
◾️ السعر الاماميه: 430,000
◾️ السعر الخلفيه : 420,000
`;
  const parsedProject = parseOffer(projectExample);
  assert.equal(parsedProject.title, 'شقة حي التيسير جدة مشروع رقم 1083');
  assert.equal(parsedProject.type, 'شقق');
  assert.equal(parsedProject.address, 'التيسير');
  assert.equal(parsedProject.city, 'جدة');
  assert.equal(parsedProject.projectNumber, '1083');
  assert.equal(parsedProject.beds, '4');
  assert.equal(parsedProject.baths, '3');
  assert.equal(parsedProject.area, 125);
  assert.equal(parsedProject.price, 420000);
  assert.equal(parsedProject.priceFrom, true);
  assert.match(parsedProject.description, /430,000/);
  assert.match(parsedProject.description, /420,000/);
  assert.match(parsedProject.description, /عدد الغرف/);
  assert.doesNotMatch(parsedProject.description, /📌|📍/);
  assert.equal(parseOffer('مشروع رقم 102\nفيلا\n📍 الموقع : حي الرياض').title, 'فيلا حي الرياض جدة مشروع رقم 102');
  assert.equal(parseOffer('مشروع رقم ١٠٢\nفيلا\nالموقع: حي الرياض').projectNumber, '102');
  assert.equal(parseOffer('شقة\nحي النعيم\nالسعر: ٢٠٠ ألف').price, 200000);
  assert.equal(parseOffer('شقة\nحي النعيم\nالسعر: ٢٠٠ ألف').city, 'جدة');
  assert.equal(parseOffer('روف للبيع\nحي الشاطئ جدة\nالسعر مليون').type, 'روف');
  assert.equal(parseOffer('تاون هاوس\nحي الحمدانية\nالسعر 900,000').type, 'تاون هاوس');
  assert.match(formatListedPrice(420000, true), /^يبدأ من /);
  assert.equal(formatListedPrice(null, true), 'عند الطلب');
  assert.doesNotMatch(formatListedPrice(420000, false), /يبدأ من/);

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
  assert.equal(normalizeChatId('-4815162342'), '-4815162342');
  assert.equal(sourceKeyFor('1', '5', 'abc'), '-1001:g:abc');
  assert.equal(sourceKeyFor('1', '5', null), '-1001:m:5');
  assert.equal(propertyIdFor('1', '5', null), 'tg-1001-m-5');
  assert.equal(exportChatId('555', 'private_supergroup'), '-100555');
  assert.equal(exportChatId('777', 'public_supergroup'), '-100777');
  assert.equal(exportChatId('-100777', 'public_supergroup'), '-100777');
  assert.equal(exportChatId('42', 'private_group'), '-42');
  assert.equal(exportChatId('-42', 'public_group'), '-42');
  assert.equal(sourceKeyHash('-1001:m:9'), sourceKeyHash('-1001:m:9'));
  assert.equal(sourceKeyHash('-1001:m:9').length, 64);

  const supergroupExport = {name: 'عروض الجروب', type: 'private_supergroup', id: 555, messages: [{id: 1, type: 'message', text: 'شقة للبيع', photo: 'photos/a.jpg'}]};
  const supergroupChats = readExportChats(supergroupExport);
  assert.equal(supergroupChats.length, 1);
  assert.equal(supergroupChats[0].type, 'private_supergroup');
  assert.equal(exportChatId(supergroupChats[0].id, supergroupChats[0].type), '-100555');
  assert.equal(supportedExportType('public_supergroup'), true);
  assert.equal(supportedExportType('private_supergroup'), true);
  assert.equal(supportedExportType('personal_chat'), false);
  const wrappedExport = readExportChats({chats: {list: [
    {type: 'public_supergroup', id: 42, name: 'جروب عام', messages: [{id: 8, type: 'message', text: 'فيلا'}]},
    {type: 'personal_chat', id: 9, messages: [{id: 1, type: 'message', text: 'خاص'}]},
  ]}});
  assert.equal(wrappedExport.length, 2);
  assert.equal(wrappedExport.filter(chat => supportedExportType(chat.type)).length, 1);
  assert.equal(exportChatId(wrappedExport[0].id, wrappedExport[0].type), '-10042');

  const groupUpdates = [
    {message: {message_id: 10, media_group_id: '555', chat: {id: -100999, type: 'supergroup', title: 'عروض ساس'}, caption: 'فيلا للبيع', photo: [{file_id: 'small', file_unique_id: 'ua', width: 90, height: 90}, {file_id: 'large', file_unique_id: 'ub', width: 800, height: 600}]}},
    {message: {message_id: 12, chat: {id: -100999, type: 'supergroup', title: 'عروض ساس'}, text: 'رسالة بين الألبوم'}},
    {message: {message_id: 11, media_group_id: '555', chat: {id: -100999, type: 'supergroup', title: 'عروض ساس'}, photo: [{file_id: 'c', file_unique_id: 'uc', file_size: 20}]}},
    {edited_message: {message_id: 11, media_group_id: '555', chat: {id: -100999, type: 'supergroup', title: 'عروض ساس'}, caption: 'فيلا للبيع حي الرياض جدة'}},
  ];
  const parsedGroup = groupUpdates.map(parseTelegramUpdate);
  assert.ok(parsedGroup.every(Boolean));
  assert.equal(parsedGroup[0].accepted, true);
  assert.equal(parsedGroup[0].chatType, 'supergroup');
  assert.equal(parsedGroup[0].chatTitle, 'عروض ساس');
  assert.equal(parsedGroup[0].photo.fileUniqueId, 'ub');
  assert.equal(parsedGroup[0].text, 'فيلا للبيع');
  assert.equal(parsedGroup[3].edited, true);
  const albumGroups = groupIncomingMessages(parsedGroup);
  assert.equal(albumGroups.length, 2);
  assert.deepEqual(albumGroups[0].map(item => item.messageId), ['10', '11', '11']);
  const album = collapseAlbum(albumGroups[0]);
  assert.deepEqual(album.messageIds, ['10', '11']);
  assert.equal(album.photos.length, 2);
  assert.equal(album.text, 'فيلا للبيع حي الرياض جدة');
  assert.equal(album.edited, true);
  assert.equal(sourceKeyFor(album.chatId, album.messageIds[0], album.mediaGroupId), sourceKeyFor(album.chatId, '11', '555'));
  assert.deepEqual(albumGroups[1].map(item => item.messageId), ['12']);

  const chat = '-1003903377074';
  const details = 'مشروع sh / 1083\nشقة\nالموقع : حي التيسير\nعدد الغرف : 4\nالسعر الاماميه: 430,000\nالسعر الخلفيه : 420,000';
  const brand = {fileId: 'brand', fileUniqueId: 'brand-card'};
  const photo = (id, unique) => ({fileId: unique, fileUniqueId: unique});
  const msg = (messageId, kind, extra = {}) => ({
    chatId: chat,
    messageId,
    date: extra.date ?? 1_700_000_000,
    mediaGroupId: extra.mediaGroupId ?? null,
    kind,
    text: extra.text ?? '',
    files: extra.files ?? [],
    edited: extra.edited ?? false,
  });
  const grouped = groupChatOffers([
    msg('10791', 'photo', {files: [photo('10791', 'real-a')], date: 1_700_000_100}),
    msg('10786', 'text', {text: details, date: 1_700_000_000}),
    msg('10792', 'photo', {files: [photo('10792', 'real-b')], mediaGroupId: '14331668265179332', date: 1_700_000_120}),
    msg('10793', 'photo', {files: [photo('10793', 'real-c')], mediaGroupId: '14331668265179332', date: 1_700_000_121}),
    msg('10794', 'sticker', {files: [brand], date: 1_700_000_200}),
    msg('10810', 'text', {text: 'مشروع رقم 102\nفيلا\nالموقع : حي الرياض\nالسعر : 900,000', date: 1_700_000_300}),
  ]);
  assert.equal(grouped.length, 2);
  assert.deepEqual(grouped[0].messageIds, ['10786', '10791', '10792', '10793']);
  assert.equal(grouped[0].firstMessageId, '10786');
  assert.equal(grouped[0].text.includes('مشروع'), true);
  assert.equal(grouped[0].photos.map(item => item.file.fileUniqueId).join(','), 'real-a,real-b,real-c');
  assert.equal(grouped[0].closed, true);
  assert.equal(grouped[1].messageIds.join(','), '10810');
  assert.equal(grouped[1].closed, false);
  assert.equal(offerPropertyId(chat, grouped[0].firstMessageId), 'tg-1003903377074-o-10786');
  assert.equal(offerSourceKey(chat, '10786'), '-1003903377074:o:10786');
  const edited = groupChatOffers([
    msg('5', 'text', {text: 'شقة\nالموقع: حي الصفا\nالسعر 1'}),
    msg('5', 'text', {text: 'شقة\nالموقع: حي الصفا\nعدد الغرف : 5\nالسعر 680,000', edited: true}),
    msg('6', 'photo', {files: [photo('6', 'room')]}),
  ]);
  assert.equal(edited.length, 1);
  assert.match(edited[0].text, /680,000/);
  assert.equal(edited[0].firstMessageId, '5');
  const gap = groupChatOffers([
    msg('1', 'text', {text: details, date: 1_000}),
    msg('2', 'photo', {files: [photo('2', 'late-photo')], date: 1_000 + OFFER_GAP_SECONDS + 5}),
    msg('3', 'text', {text: 'مشروع رقم 7\nدور\nالموقع: حي السلامة\nالسعر 300,000', date: 1_000 + (OFFER_GAP_SECONDS * 2) + 20}),
  ]);
  assert.equal(gap.length, 2, 'details text after 45 minutes opens a new offer');
  assert.deepEqual(gap[0].messageIds, ['1', '2']);
  assert.deepEqual(gap[1].messageIds, ['3']);
  assert.equal(isDetailsText('صورة فقط'), false);
  const offersForBrand = [0, 1, 2].map(index => ({
    key: String(index),
    fileUniqueIds: ['brand-card', `room-${index}`],
  }));
  const branding = brandingFileIds(offersForBrand);
  assert.equal(branding.has('brand-card'), true);
  assert.equal(branding.has('room-0'), false);
  const cover = galleryPhotos([
    {fileUniqueId: 'brand-card', path: '/media/brand.jpg'},
    {fileUniqueId: 'room-0', path: '/media/room.jpg'},
  ], branding);
  assert.equal(cover.length, 1);
  assert.equal(cover[0].fileUniqueId, 'room-0');
  assert.equal(exportMessageKind({id: 9, type: 'message', media_type: 'sticker', text: ''}), 'sticker');
  const legacy = planOfferMerges({
    messages: [],
    logs: [
      {chatId: chat, messageId: '10780', createdAt: 1_700_000_000, note: 'رسالة بلا نص ولا صورة', action: 'skipped', propertyId: null},
      {chatId: chat, messageId: '10820', createdAt: 1_700_000_900, note: 'رسالة بلا نص ولا صورة', action: 'skipped', propertyId: null},
    ],
    fragments: [
      {id: 'tg-1003903377074-m-10786', chatId: chat, messageIds: ['10786'], mediaGroupId: null, title: 'شقة حي الصفا جدة', description: details, images: [], createdAt: 1_700_000_100},
      {id: 'tg-1003903377074-m-10791', chatId: chat, messageIds: ['10791'], mediaGroupId: null, title: 'عرض عقاري', description: '', images: [{messageId: '10791', fileUniqueId: 'real-a', path: '/media/a.jpg'}], createdAt: 1_700_000_160},
      {id: 'tg-1003903377074-g-14331668265179332', chatId: chat, messageIds: ['10792', '10793'], mediaGroupId: '14331668265179332', title: 'عرض عقاري', description: '', images: [{messageId: '10792', fileUniqueId: 'real-b', path: '/media/b.jpg'}], createdAt: 1_700_000_180},
    ],
  });
  assert.equal(legacy.length, 1);
  assert.equal(legacy[0].targetId, 'tg-1003903377074-o-10786');
  assert.deepEqual(legacy[0].fragments.map(item => item.id).sort(), [
    'tg-1003903377074-g-14331668265179332',
    'tg-1003903377074-m-10786',
    'tg-1003903377074-m-10791',
  ].sort());
  assert.equal(legacy[0].title, 'شقة حي التيسير جدة مشروع رقم 1083');
  assert.equal(legacy[0].photoCount, 2);
  const split = planOfferMerges({
    messages: [],
    logs: [{chatId: chat, messageId: '10790', createdAt: 1_700_000_140, note: 'رسالة بلا نص ولا صورة', action: 'skipped', propertyId: null}],
    fragments: [
      {id: 'tg-1003903377074-m-10786', chatId: chat, messageIds: ['10786'], mediaGroupId: null, title: 'أ', description: details, images: [], createdAt: 1_700_000_100},
      {id: 'tg-1003903377074-m-10791', chatId: chat, messageIds: ['10791'], mediaGroupId: null, title: 'ب', description: details, images: [], createdAt: 1_700_000_160},
    ],
  });
  assert.equal(split.length, 0);
  assert.equal(planOfferMerges({messages: [], logs: [], fragments: legacy[0] ? [] : []}).length, 0);

  const basicGroup = parseTelegramUpdate({message: {message_id: 3, chat: {id: -42, type: 'group', title: 'جروب صغير'}, text: 'أرض للبيع'}});
  assert.equal(basicGroup.chatId, '-42');
  assert.equal(basicGroup.accepted, true);
  assert.equal(basicGroup.edited, false);
  const channelPost = parseTelegramUpdate({channel_post: {message_id: 4, chat: {id: -1005, type: 'channel', title: 'قناة'}, text: 'شقة للبيع'}});
  assert.equal(channelPost.accepted, true);
  assert.equal(channelPost.edited, false);
  assert.equal(channelPost.chatId, '-1005');
  const editedChannel = parseTelegramUpdate({edited_channel_post: {message_id: 4, chat: {id: -1005, type: 'channel', title: 'قناة'}, text: 'شقة للبيع معدلة'}});
  assert.equal(editedChannel.edited, true);
  assert.equal(editedChannel.accepted, true);
  const privateMessage = parseTelegramUpdate({message: {message_id: 1, chat: {id: 99, type: 'private', title: ''}, text: 'hi'}});
  assert.equal(privateMessage.accepted, false);
  assert.equal(privateMessage.chatId, '99');
  const service = parseTelegramUpdate({message: {message_id: 2, chat: {id: -100999, type: 'supergroup', title: 'عروض ساس'}, new_chat_members: [{id: 1}], text: ''}});
  assert.equal(service.service, true);
  assert.equal(service.accepted, true);
  assert.equal(parseTelegramUpdate({update_id: 1}), null);
  assert.equal(chatAllowed('-42', '-42'), true);
  assert.equal(chatAllowed('-10042', '-10042'), true);
  assert.equal(chatAllowed('-10042', '42'), true);
  assert.equal(chatAllowed('-42', '-10042'), false);
  assert.equal(chatAllowed('-10042', ''), true);

  for (const sql of [propertyLookupSql(0), propertyLookupSql(2), propertyByOfferSql(), messageLookupSql(), messagesByChatSql(), redirectLookupSql(), deletePropertySql(), recentSyncSql(40), seenChatLookupSql()]) {
    assertCollationSafe(sql);
  }
  const seenUpdate = seenChatUpdateSql();
  assert.match(seenUpdate, /WHERE CAST\(chat_id AS BINARY\) = CAST\(\? AS BINARY\)/);
  assert.doesNotMatch(seenUpdate, /HEX\s*\(|CONVERT_TZ\s*\(/i);
  assertCollationSafe(seenUpdate.slice(seenUpdate.indexOf('WHERE')));
  assert.match(propertyLookupSql(1), /telegram_message_ids/);
  assert.doesNotMatch(readFileSync('lib/telegram-sync.ts', 'utf8'), /HEX\s*\(|CONVERT_TZ\s*\(/i);
  const dbFailure = Object.assign(new Error("BLOB/TEXT column 'id' used in key specification without a key length"), {code: 'ER_BLOB_KEY_WITHOUT_LENGTH', errno: 1170});
  assert.match(telegramDbError(dbFailure), /ER_BLOB_KEY_WITHOUT_LENGTH/);
  assert.match(telegramDbError(dbFailure), /1170/);
  assert.match(telegramDbError(dbFailure), /تعذر قراءة سجل المزامنة/);
  assert.doesNotMatch(telegramDbError(dbFailure), /BLOB\/TEXT/);
  const panel = readFileSync('app/crm/telegram-panel.tsx', 'utf8');
  assert.match(panel, /قناة أو جروب/);
  assert.match(panel, /setprivacy/);
  assert.match(panel, /#3F1A44/);
  assert.match(panel, /lastChat/);
  assert.match(panel, /seenChats/);
  assert.match(panel, /private_supergroup/);
  assert.match(panel, /إعادة تجميع العروض/);
  assert.match(panel, /تطبيق التجميع/);
  assert.match(panel, /فاصل بين العروض/);
  assert.match(readFileSync('app/properties/[id]/page.tsx', 'utf8'), /redirectPermanent/);
  assert.match(readFileSync('proxy.ts', 'utf8'), /NextResponse\.redirect\([\s\S]*301/);
  assert.match(readFileSync('app/properties/listings-client.tsx', 'utf8'), /formatListedPrice/);
  assert.match(readFileSync('lib/telegram-sync.ts', 'utf8'), /فاصل بين العروض|SEPARATOR_NOTE/);
  const botSource = readFileSync('lib/telegram-bot.ts', 'utf8');
  assert.match(botSource, /channel_post/);
  assert.match(botSource, /edited_channel_post/);
  assert.match(botSource, /'message'/);
  assert.match(botSource, /edited_message/);

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
  const {
    ensureLeadSchema,
    resetLeadSchemaCache,
    lastTelegramSchemaError,
    SITE_PROPERTIES_DDL,
    TELEGRAM_SYNC_LOG_DDL,
    TELEGRAM_SEEN_CHATS_DDL,
    TELEGRAM_MESSAGES_DDL,
    TELEGRAM_REDIRECTS_DDL,
    TELEGRAM_MESSAGES_INDEX_DDL,
    TELEGRAM_SOURCE_INDEX_DDL,
    TELEGRAM_SOURCE_INDEX_ALTER,
  } = require(join(output, 'lead-schema.cjs'));
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
  for (const name of ['beds', 'baths', 'telegram_chat_id', 'telegram_message_id', 'telegram_media_group_id', 'telegram_source_key', 'telegram_source_hash']) {
    assert.ok(byName.has(name), name);
    assert.equal(byName.get(name).required, 0, `${name} stays nullable`);
  }
  assert.equal(mem.prepare("SELECT name FROM sqlite_master WHERE name='telegram_sync_log'").get().name, 'telegram_sync_log');
  assert.equal(mem.prepare("SELECT name FROM sqlite_master WHERE name='telegram_seen_chats'").get().name, 'telegram_seen_chats');
  assert.equal(mem.prepare("SELECT name FROM sqlite_master WHERE name='telegram_messages'").get().name, 'telegram_messages');
  assert.equal(mem.prepare("SELECT name FROM sqlite_master WHERE name='telegram_redirects'").get().name, 'telegram_redirects');
  const hash = sourceKeyHash('-1001:m:9');
  mem.prepare("INSERT INTO site_properties (id, title, beds, baths, status, telegram_chat_id, telegram_message_id, telegram_source_key, telegram_source_hash, created_at, updated_at) VALUES (?, ?, NULL, NULL, 'published', ?, ?, ?, ?, ?, ?)").run('tg-1', 'عرض', '-1001', '9', '-1001:m:9', hash, '2026-01-01', '2026-01-01');
  assert.equal(mem.prepare("SELECT beds FROM site_properties WHERE id='tg-1'").get().beds, null);
  assert.equal(mem.prepare("SELECT baths FROM site_properties WHERE id='tg-1'").get().baths, null);
  assert.equal(mem.prepare("SELECT status FROM site_properties WHERE id='tg-1'").get().status, 'published');
  assert.throws(() => mem.prepare("INSERT INTO site_properties (id, telegram_source_hash) VALUES ('tg-2', ?)").run(hash));
  resetLeadSchemaCache();
  await ensureLeadSchema(sqliteExecutor(mem));
  assert.equal(mem.prepare("SELECT COUNT(*) AS n FROM pragma_table_info('site_properties') WHERE name='beds'").get().n, 1);
  assert.equal(mem.prepare("SELECT beds FROM site_properties WHERE id='tg-1'").get().beds, null);
  mem.close();

  const ddl = [SITE_PROPERTIES_DDL, TELEGRAM_SYNC_LOG_DDL, TELEGRAM_SEEN_CHATS_DDL, TELEGRAM_MESSAGES_DDL, TELEGRAM_REDIRECTS_DDL, TELEGRAM_MESSAGES_INDEX_DDL, TELEGRAM_SOURCE_INDEX_DDL].join('\n');
  assert.doesNotMatch(ddl, /TEXT\s+PRIMARY\s+KEY/i);
  assert.doesNotMatch(ddl, /\bJSON\b/);
  assert.doesNotMatch(ddl, /\bDATETIME\b/i);
  assert.match(SITE_PROPERTIES_DDL, /id VARCHAR\(191\)/);
  assert.match(SITE_PROPERTIES_DDL, /telegram_source_hash CHAR\(64\)/);
  assert.match(TELEGRAM_SYNC_LOG_DDL, /id VARCHAR\(40\)/);
  assert.match(TELEGRAM_SEEN_CHATS_DDL, /chat_id VARCHAR\(64\)/);
  assert.match(TELEGRAM_MESSAGES_DDL, /id VARCHAR\(96\)/);
  assert.match(TELEGRAM_MESSAGES_DDL, /raw_body LONGTEXT/);
  assert.match(TELEGRAM_REDIRECTS_DDL, /id VARCHAR\(191\)/);
  assert.match(TELEGRAM_MESSAGES_INDEX_DDL, /\(chat_id, message_id\)/);
  assert.doesNotMatch(TELEGRAM_MESSAGES_DDL, /\bJSON\b/);
  assert.ok(96 * 4 < 767);
  assert.match(TELEGRAM_SOURCE_INDEX_DDL, /\(telegram_source_hash\)/);
  assert.doesNotMatch(TELEGRAM_SOURCE_INDEX_DDL, /telegram_source_key\)/);
  assert.ok(191 * 4 < 767);
  resetLeadSchemaCache();
  const mysqlCalls = [];
  const mysqlish = {async execute(sql) {
    const text = String(sql).trim();
    mysqlCalls.push(text);
    if (/TEXT\s+PRIMARY\s+KEY/i.test(text) || /\bJSON\b/.test(text) || /UNIQUE\s+INDEX[^\n]*\(telegram_source_key\)/i.test(text)) {
      const error = new Error("BLOB/TEXT column 'id' used in key specification without a key length");
      error.code = 'ER_BLOB_KEY_WITHOUT_LENGTH';
      error.errno = 1170;
      throw error;
    }
    if (/CREATE\s+(UNIQUE\s+)?INDEX\s+IF\s+NOT\s+EXISTS/i.test(text)) {
      const error = new Error('You have an error in your SQL syntax');
      error.code = 'ER_PARSE_ERROR';
      error.errno = 1064;
      throw error;
    }
    if (text.startsWith('SHOW')) return [[]];
    if (text.startsWith('SELECT')) return [[]];
    return [{affectedRows: 0}];
  }};
  await ensureLeadSchema(mysqlish);
  assert.equal(lastTelegramSchemaError(), null);
  assert.ok(mysqlCalls.some(sql => sql.startsWith('CREATE TABLE IF NOT EXISTS site_properties') && /VARCHAR\(191\)/.test(sql)));
  assert.ok(mysqlCalls.some(sql => sql.startsWith('CREATE TABLE IF NOT EXISTS telegram_sync_log') && /VARCHAR\(40\)/.test(sql)));
  assert.ok(mysqlCalls.some(sql => sql.startsWith('CREATE TABLE IF NOT EXISTS telegram_seen_chats')));
  assert.ok(mysqlCalls.some(sql => sql.startsWith('CREATE TABLE IF NOT EXISTS telegram_messages') && /VARCHAR\(96\)/.test(sql)));
  assert.ok(mysqlCalls.some(sql => sql.startsWith('CREATE TABLE IF NOT EXISTS telegram_redirects')));
  assert.ok(mysqlCalls.some(sql => sql === 'ALTER TABLE telegram_messages ADD UNIQUE INDEX telegram_messages_chat_message (chat_id, message_id)'));
  assert.ok(mysqlCalls.some(sql => sql === TELEGRAM_SOURCE_INDEX_ALTER));
  assert.equal(mysqlCalls.some(sql => /TEXT\s+PRIMARY\s+KEY/i.test(sql)), false);
  resetLeadSchemaCache();

  console.log('PASS Arabic offer parser, group updates, album grouping, webhook secret, nullable beds/baths, telegram source columns');
} finally {
  rmSync(output, {recursive: true, force: true});
}
