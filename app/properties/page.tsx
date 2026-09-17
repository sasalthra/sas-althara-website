import type {Metadata} from 'next';
import data from '@/data/properties.json';
import ListingsClient from './listings-client';
import './properties.css';

export const metadata: Metadata = {
  title: 'عروضنا العقارية | ساس الثراء',
  description: 'تصفح عروض ساس الثراء العقارية مع فلترة حسب النوع والحي والسعر.',
};

export default function PropertiesPage() {
  return <ListingsClient properties={data} />;
}
