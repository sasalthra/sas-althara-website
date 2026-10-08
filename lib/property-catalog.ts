import {cache} from 'react';
import properties from '@/data/properties.json';
import {crmDb} from './crm-db';
import {asBinary} from './sql-collation';
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

async function readPublished(): Promise<CatalogProperty[]> {
  const base = staticCatalog();
  try {
    const result = await crmDb()
      .prepare(
        `SELECT id, title, price, area, beds, baths, city, address, type, purpose, street_width, facade, age, description, images, status
         FROM site_properties WHERE ${asBinary('status')} = ${asBinary('?')} ORDER BY updated_at DESC, id DESC`
      )
      .bind('published')
      .all();
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
