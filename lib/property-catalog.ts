import {cache} from 'react';
import properties from '@/data/properties.json';
import {crmDb} from './crm-db';
import {ensureTelegramTables} from './lead-schema';
import {asBinary} from './sql-collation';
import {redirectLookupSql} from './telegram-sql';
import type {CatalogProperty} from './property-types';

type StaticProperty = (typeof properties)[number];

function textOrNull(value: unknown): string | null {
  if (value == null) return null;
  const text = String(value).trim();
  return text ? text : null;
}

function numberOrNull(value: unknown): number | null {
  if (value == null || value === '') return null;
  const amount = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(amount) ? amount : null;
}

function imageList(value: unknown): string[] {
  if (typeof value === 'string') {
    try {
      return imageList(JSON.parse(value));
    } catch {
      return [];
    }
  }
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === 'string' && item.startsWith('/'));
}

export function staticCatalog(): CatalogProperty[] {
  return (properties as StaticProperty[]).map(property => ({
    id: String(property.id),
    title: property.title,
    price: numberOrNull(property.price),
    priceFrom: false,
    area: numberOrNull(property.area),
    beds: textOrNull(property.beds),
    baths: textOrNull(property.baths),
    city: textOrNull(property.city),
    address: textOrNull(property.address),
    type: textOrNull(property.type),
    purpose: null,
    streetWidth: null,
    facade: null,
    age: null,
    description: property.description || '',
    images: property.images?.length ? [...property.images] : [],
    ...(textOrNull((property as {status?: unknown}).status) ? {status: textOrNull((property as {status?: unknown}).status) as string} : {}),
  }));
}

function fromRow(row: Record<string, unknown>): CatalogProperty {
  return {
    id: String(row.id ?? ''),
    title: textOrNull(row.title) || 'عرض عقاري',
    price: numberOrNull(row.price),
    priceFrom: row.price_from === 1 || row.price_from === true || String(row.price_from) === '1',
    area: numberOrNull(row.area),
    beds: textOrNull(row.beds),
    baths: textOrNull(row.baths),
    city: textOrNull(row.city),
    address: textOrNull(row.address),
    type: textOrNull(row.type),
    purpose: textOrNull(row.purpose),
    streetWidth: textOrNull(row.street_width),
    facade: textOrNull(row.facade),
    age: textOrNull(row.age),
    description: row.description == null ? '' : String(row.description),
    images: imageList(row.images),
    status: 'published',
  };
}

const PUBLISHED_COLUMNS = 'id, title, price, area, beds, baths, city, address, type, purpose, street_width, facade, age, description, images, status';

function publishedSelect(withPriceFrom: boolean) {
  const columns = withPriceFrom ? PUBLISHED_COLUMNS.replace('price,', 'price, price_from,') : PUBLISHED_COLUMNS;
  return `SELECT ${columns}
         FROM site_properties WHERE ${asBinary('status')} = ${asBinary('?')} ORDER BY updated_at DESC, id DESC`;
}

async function readPublished(): Promise<CatalogProperty[]> {
  const base = staticCatalog();
  try {
    let result;
    try {
      result = await crmDb().prepare(publishedSelect(true)).bind('published').all();
    } catch (error) {
      if (!/price_from|unknown column|no such column|ER_BAD_FIELD_ERROR/i.test(error instanceof Error ? error.message : String(error))) {
        throw error;
      }
      console.error('published catalog omitted price_from; the column is not on this database yet', error);
      result = await crmDb().prepare(publishedSelect(false)).bind('published').all();
    }
    const live = result.results.map(row => fromRow(row)).filter(item => item.id);
    const replaced = new Set(live.map(item => item.id));
    return [...live, ...base.filter(item => !replaced.has(item.id))];
  } catch (error) {
    console.error('published property catalog fell back to the static file', error);
    return base;
  }
}

export const loadPublishedProperties = cache(readPublished);

export async function loadPublishedProperty(id: string) {
  const properties = await loadPublishedProperties();
  return properties.find(item => item.id === id) ?? null;
}

/** Follow fragment → merged listing redirects. Returns null when this id is not a redirect. */
export async function loadPropertyRedirect(id: string): Promise<string | null> {
  if (!/^[A-Za-z0-9_-]{1,191}$/.test(id)) return null;
  try {
    await ensureTelegramTables();
    let current = id;
    const seen = new Set<string>();
    for (let hop = 0; hop < 5; hop += 1) {
      if (seen.has(current)) return null;
      seen.add(current);
      const row = await crmDb().prepare(redirectLookupSql()).bind(current).first<{target_id?: unknown}>();
      const target = row?.target_id == null ? '' : String(row.target_id);
      if (!target || target === current || !/^[A-Za-z0-9_-]{1,191}$/.test(target)) {
        return hop === 0 ? null : current;
      }
      current = target;
    }
    return current === id ? null : current;
  } catch (error) {
    console.error('property redirect was not read', error);
    return null;
  }
}
