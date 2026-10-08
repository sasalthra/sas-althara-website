export type ParsedOffer = {
  title: string;
  type: string | null;
  purpose: 'بيع' | 'إيجار' | null;
  price: number | null;
  area: number | null;
  city: string | null;
  address: string | null;
  beds: string | null;
  baths: string | null;
  streetWidth: string | null;
  facade: string | null;
  age: string | null;
  projectNumber: string | null;
  /** True when the post lists more than one price. The stored price is the lowest. */
  priceFrom: boolean;
  description: string;
};

const INDIC = '٠١٢٣٤٥٦٧٨٩';
const PERSIAN = '۰۱۲۳۴۵۶۷۸۹';

const CITIES: {test: RegExp; label: string}[] = [
  {test: /جده/, label: 'جدة'},
  {test: /مكه/, label: 'مكة'},
  {test: /المدينه/, label: 'المدينة'},
  {test: /الدمام/, label: 'الدمام'},
  {test: /الخبر/, label: 'الخبر'},
  {test: /الظهران/, label: 'الظهران'},
  {test: /الطائف/, label: 'الطائف'},
  {test: /ينبع/, label: 'ينبع'},
  {test: /ابها/, label: 'أبها'},
  {test: /تبوك/, label: 'تبوك'},
  {test: /جازان/, label: 'جازان'},
  {test: /نجران/, label: 'نجران'},
  {test: /حايل/, label: 'حائل'},
  {test: /بريده/, label: 'بريدة'},
  {test: /الجبيل/, label: 'الجبيل'},
  {test: /رابغ/, label: 'رابغ'},
  {test: /الرياض/, label: 'الرياض'},
];

const TYPES: {re: RegExp; type: string}[] = [
  {re: /تاون\s*هاوس|تاونهاوس/, type: 'تاون هاوس'},
  {re: /(?<![ا-ي])روف(?![ا-ي])/, type: 'روف'},
  {re: /شقق|شقه/, type: 'شقق'},
  {re: /فلل|فيلا/, type: 'فلل'},
  {re: /(?<![ا-ي])ارض(?![ا-ي])|اراضي/, type: 'أرض'},
  {re: /عماره|عمائر/, type: 'عمارة'},
  {re: /(?<![ا-ي])محل(?![ا-ي])|محلات/, type: 'محل'},
  {re: /دوبلكس/, type: 'دوبلكس'},
  {re: /استراحه/, type: 'استراحة'},
  {re: /(?<![ا-ي])مكتب(?![ا-ي])/, type: 'مكتب'},
  {re: /مستودع/, type: 'مستودع'},
  {re: /مزرعه/, type: 'مزرعة'},
];

export function normalizeDigits(input: string): string {
  return input
    .replace(/[٠-٩]/g, digit => String(INDIC.indexOf(digit)))
    .replace(/[۰-۹]/g, digit => String(PERSIAN.indexOf(digit)))
    .replace(/٫/g, '.')
    .replace(/[٬،]/g, ',');
}

/** Match Arabic offers after alef/ta marbuta/diacritic differences. */
export function foldArabic(input: string): string {
  return normalizeDigits(input)
    .replace(/[\u064B-\u065F\u0670]/g, '')
    .replace(/ـ/g, '')
    .replace(/[أإآ]/g, 'ا')
    .replace(/ة/g, 'ه')
    .replace(/ى/g, 'ي');
}

function stripThousands(value: string): string {
  let current = value;
  for (let pass = 0; pass < 4; pass += 1) {
    const next = current.replace(/(\d)[.,\s](?=\d{3}(?:\D|$))/g, '$1');
    if (next === current) break;
    current = next;
  }
  return current;
}

function parseAmount(segment: string): number | null {
  const text = foldArabic(segment).replace(/الاف/g, 'الف');
  if (text.includes('مليون')) {
    const match = text.match(/(\d+(?:\.\d+)?)?\s*مليون(?:\s*و\s*(\d+(?:\.\d+)?)\s*الف)?/);
    const base = match?.[1] ? Number(match[1]) : 1;
    if (!Number.isFinite(base) || base <= 0) return null;
    let total = base * 1_000_000;
    if (match?.[2]) total += Number(match[2]) * 1000;
    else if (/مليون\s*و?\s*نص/.test(text)) total += 500_000;
    return Math.round(total);
  }
  const thousand = text.match(/(\d+(?:\.\d+)?)\s*الف/);
  if (thousand) {
    const amount = Number(thousand[1]) * 1000;
    return Number.isFinite(amount) && amount > 0 ? Math.round(amount) : null;
  }
  const plain = stripThousands(text).match(/\d+(?:\.\d+)?/);
  if (!plain) return null;
  const amount = Number(plain[0]);
  if (!Number.isFinite(amount) || amount <= 0) return null;
  return Math.round(amount);
}

/** Drop decorative emoji. The Arabic text, digits, and price lines stay. */
export function cleanOfferText(input: string): string {
  const stripped = input
    .replace(/\p{Extended_Pictographic}/gu, '')
    .replace(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}\u{200D}]/gu, '')
    .replace(/[\u2500-\u257F\u25A0-\u25FF]/g, '')
    .replace(/[•●▪▫◦‣⁃◽◾◼◻■□◆◇♦▲▼►◄★☆✅✔️]/g, '');
  const lines = stripped
    .split('\n')
    .map(line => line.replace(/[ \t]{2,}/g, ' ').trim());
  const compacted: string[] = [];
  for (const line of lines) {
    if (!line && compacted[compacted.length - 1] === '') continue;
    compacted.push(line);
  }
  return compacted.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

/** Digits after مشروع. A letter prefix such as «sh /» is not part of the number. */
export function parseProjectNumber(original: string): string | null {
  const folded = foldArabic(original);
  const match = folded.match(/مشروع(?:\s*رقم)?\s*[:\-]?\s*(?:[a-z]+\s*[\/\\\-]\s*)?(\d+)/i);
  if (!match?.[1]) return null;
  return match[1].replace(/^0+(?=\d)/, '');
}

function parsePriceInfo(original: string): {price: number | null; priceFrom: boolean} {
  const amounts: number[] = [];
  for (const line of original.split(/\n/)) {
    if (!/سعر/.test(foldArabic(line))) continue;
    const amount = parseAmount(line);
    if (amount != null) amounts.push(amount);
  }
  if (!amounts.length) {
    const folded = foldArabic(original);
    if (!/مليون|الف/.test(folded) || /سعر/.test(folded)) return {price: null, priceFrom: false};
    const window = folded.match(/([^\n]{0,48}(?:مليون|الف))/);
    const amount = window ? parseAmount(window[1]) : null;
    return {price: amount, priceFrom: false};
  }
  const unique = new Set(amounts);
  return {price: Math.min(...amounts), priceFrom: unique.size > 1};
}

function parseArea(original: string): number | null {
  const folded = stripThousands(foldArabic(original));
  const labeled = folded.match(/(?:المساحه|مساحه)[^\d\n]{0,40}(\d+(?:\.\d+)?)/);
  if (labeled) {
    const area = Number(labeled[1]);
    if (area > 0 && area < 1_000_000) return area;
  }
  const withoutStreet = folded.replace(/عرض\s*الشارع\s*[:\-]?\s*\d+(?:\.\d+)?(?:\s*متر)?/g, ' ');
  const unit = withoutStreet.match(/(\d+(?:\.\d+)?)\s*(?:م2|م²|متر مربع|متر\b|م(?![ا-ي\d]))/);
  if (!unit) return null;
  const area = Number(unit[1]);
  if (!(area > 0 && area < 100_000)) return null;
  return area;
}

function sumMatches(text: string, pattern: RegExp): number | null {
  const expression = new RegExp(pattern.source, pattern.flags.includes('g') ? pattern.flags : `${pattern.flags}g`);
  let total = 0;
  let found = false;
  for (const match of text.matchAll(expression)) {
    total += Number(match[1]);
    found = true;
  }
  return found ? total : null;
}

function parseBeds(folded: string): string | null {
  const labeled = sumMatches(folded, /(?:عدد\s*الغرف|عدد\s*غرفه\s*النوم|غرفه\s*النوم|غرف\s*النوم)\s*[:\-]?\s*(\d+)/);
  if (labeled != null && labeled > 0) return String(labeled);
  const bare = folded.match(/(?:^|[^\d])(\d+)\s*غرف(?:ه)?(?:\s*نوم)?(?![ا-ي])/);
  return bare ? bare[1] : null;
}

function parseBaths(folded: string): string | null {
  const cycles = sumMatches(folded, /دورات\s*(?:ال)?مياه\s*[:\-]?\s*(\d+)/);
  if (cycles != null && cycles > 0) return String(cycles);
  const leadingCycles = sumMatches(folded, /(\d+)\s*دورات\s*(?:ال)?مياه/);
  if (leadingCycles != null && leadingCycles > 0) return String(leadingCycles);
  const labeled = sumMatches(folded, /(?:عدد\s*الحمامات|حمامات)\s*[:\-]?\s*(\d+)/);
  if (labeled != null && labeled > 0) return String(labeled);
  const bare = folded.match(/(?:^|[^\d])(\d+)\s*حمام(?:ات)?(?![ا-ي])/);
  return bare ? bare[1] : null;
}

function parseType(folded: string): string | null {
  let best: {index: number; type: string} | null = null;
  for (const rule of TYPES) {
    const match = folded.match(rule.re);
    if (!match || match.index == null) continue;
    if (!best || match.index < best.index) best = {index: match.index, type: rule.type};
  }
  if (best) return best.type;
  if (/(?<![ا-ي])دور(?!ات)/.test(folded)) return 'دور';
  return null;
}

function parsePurpose(folded: string): 'بيع' | 'إيجار' | null {
  const sale = folded.search(/للبيع|تمليك|(?<![ا-ي])بيع(?![ا-ي])/);
  const rent = folded.search(/للايجار|(?<![ا-ي])ايجار(?![ا-ي])/);
  if (sale < 0 && rent < 0) return null;
  if (sale >= 0 && (rent < 0 || sale <= rent)) return 'بيع';
  return 'إيجار';
}

function cityOfToken(token: string): string | null {
  const folded = foldArabic(token);
  for (const city of CITIES) {
    if (!city.test.test(folded)) continue;
    const rest = folded.replace(city.test, '').replace(/^[بفيوال]+/g, '').trim();
    if (!rest) return city.label;
  }
  return null;
}

function parsePlace(original: string, folded: string): {city: string | null; address: string | null} {
  let address: string | null = null;
  let hinted: string | null = null;
  const district = original.match(/(?:حي|حى)\s*[:\-]?\s*([^\n،,\.|]{2,48})/);
  if (district) {
    let parts = district[1].replace(/[—\-–]+/g, ' ').replace(/\s+/g, ' ').trim().split(' ').filter(Boolean);
    while (parts.length > 1) {
      const last = cityOfToken(parts[parts.length - 1] ?? '');
      if (!last) break;
      hinted = last;
      parts = parts.slice(0, -1);
    }
    address = parts.join(' ').trim() || null;
  }
  let scan = folded;
  if (address) scan = scan.replace(foldArabic(address), ' ');
  scan = scan.replace(/حي\s+\S+/g, ' ');
  for (const city of CITIES) {
    if (city.test.test(scan)) return {city: city.label, address};
  }
  return {city: hinted, address};
}

function parseStreet(folded: string): string | null {
  const match = folded.match(/عرض\s*الشارع\s*[:\-]?\s*(\d+(?:\.\d+)?)/);
  return match ? match[1] : null;
}

function parseFacade(original: string): string | null {
  const match = original.match(/واجه[ةه]\s*[:\-]?\s*([^\n،,\.]{2,40})/u);
  if (!match?.[1]) return null;
  const value = match[1].replace(/\s+/g, ' ').trim();
  return value || null;
}

function parseAge(original: string, folded: string): string | null {
  const match = original.match(/(?:عمر\s*(?:العقار)?|العمر)\s*[:\-]?\s*(جديد|\d+)/u);
  if (match?.[1]) return match[1];
  if (/عقار\s*جديد/.test(folded)) return 'جديد';
  return null;
}

function buildTitle(
  fields: Pick<ParsedOffer, 'type' | 'address' | 'city' | 'projectNumber'>,
  original: string,
): string {
  const typeWord = fields.type === 'فلل' ? 'فيلا' : fields.type === 'شقق' ? 'شقة' : fields.type;
  const district = fields.address ? `حي ${fields.address}` : '';
  const project = fields.projectNumber ? `مشروع رقم ${fields.projectNumber}` : '';
  const parts = [typeWord, district, fields.city, project].filter(part => part && part !== 'حي undefined');
  if (parts.length && (typeWord || district || project)) return parts.join(' ').replace(/\s+/g, ' ').trim().slice(0, 180);
  const line = original
    .split(/\n/)
    .map(item => item.trim())
    .find(item => item.replace(/[^\p{L}\p{N}]+/gu, '').length >= 2);
  return (line || 'عرض عقاري').replace(/\s+/g, ' ').trim().slice(0, 180);
}

export function parseOffer(original: string): ParsedOffer {
  const text = typeof original === 'string' ? original : '';
  const folded = foldArabic(text);
  const place = parsePlace(text, folded);
  const projectNumber = parseProjectNumber(text);
  const type = parseType(folded);
  const priced = parsePriceInfo(text);
  const city = place.city || (type || place.address || projectNumber ? 'جدة' : null);
  const fields: ParsedOffer = {
    title: '',
    type,
    purpose: parsePurpose(folded),
    price: priced.price,
    area: parseArea(text),
    city,
    address: place.address,
    beds: parseBeds(folded),
    baths: parseBaths(folded),
    streetWidth: parseStreet(folded),
    facade: parseFacade(text),
    age: parseAge(text, folded),
    projectNumber,
    priceFrom: priced.priceFrom,
    description: cleanOfferText(text) || text.trim(),
  };
  fields.title = buildTitle(fields, text);
  return fields;
}
