import type {Metadata} from 'next';
import {loadPublishedProperties} from '@/lib/property-catalog';
import ListingsClient from './listings-client';
import './properties.css';

export const metadata: Metadata = {
  title: 'عروضنا العقارية | ساس الثراء',
  description: 'تصفح عروض ساس الثراء العقارية مع فلترة حسب النوع والحي والسعر.',
};

export const dynamic = 'force-dynamic';

export default async function PropertiesPage() {
  const properties = await loadPublishedProperties();
  return <ListingsClient properties={properties} />;
}
