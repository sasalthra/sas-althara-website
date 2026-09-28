import Catalog from './catalog';
import {loadPublishedProperties} from '@/lib/property-catalog';
import './properties/properties.css';

export const dynamic = 'force-dynamic';

export default async function Home() {
  const properties = await loadPublishedProperties();
  return <Catalog properties={properties} />;
}
