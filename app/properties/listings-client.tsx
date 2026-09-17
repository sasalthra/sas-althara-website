'use client';

import {useEffect, useMemo, useState} from 'react';
import {
  Bath,
  BedDouble,
  Heart,
  MapPin,
  Maximize2,
  Search,
  X,
} from 'lucide-react';
import SiteHeader from '../site-header';

export type ListingProperty = {
  id: string;
  title: string;
  price: number;
  area: number;
  beds: string | null;
  baths: string | null;
  city: string;
  address: string;
  type: string;
  description: string;
  images: string[];
};

function money(value: number) {
  return value.toLocaleString('ar-SA');
}

function PropertyCard({property}: {property: ListingProperty}) {
  const available = true;
  return (
    <a className="offer-card" href={`/properties/${property.id}`}>
      <div className="offer-card-media">
        <img
          src={property.images[0]}
          alt={property.title}
          loading="lazy"
        />
        <span className={`offer-badge ${available ? 'is-available' : ''}`}>
          متاح
        </span>
        <button
          type="button"
          className="offer-fav"
          aria-label="إضافة للمفضلة"
          onClick={event => event.preventDefault()}
        >
          <Heart size={16} />
        </button>
      </div>
      <div className="offer-card-body">
        <h3>{property.title}</h3>
        <p className="offer-location">
          <MapPin size={14} />
          <span>
            {property.address || property.city}
            {property.address && property.city ? `، ${property.city}` : ''}
          </span>
        </p>
        <div className="offer-specs" aria-label="مواصفات العقار">
          <div>
            <span>عدد الغرف</span>
            <strong>
              {property.beds || '—'} <BedDouble size={16} />
            </strong>
          </div>
          <div>
            <span>الحمامات</span>
            <strong>
              {property.baths || '—'} <Bath size={16} />
            </strong>
          </div>
          <div>
            <span>المساحة</span>
            <strong>
              {property.area} م² <Maximize2 size={16} />
            </strong>
          </div>
        </div>
        <div className="offer-price">
          <strong>{money(property.price)}</strong>
          <small>ر.س</small>
        </div>
      </div>
    </a>
  );
}

export default function ListingsClient({
  properties,
}: {
  properties: ListingProperty[];
}) {
  const types = useMemo(
    () => [...new Set(properties.map(p => p.type).filter(Boolean))],
    [properties],
  );
  const cities = useMemo(
    () => [...new Set(properties.map(p => p.city).filter(Boolean))],
    [properties],
  );
  const districts = useMemo(
    () => [...new Set(properties.map(p => p.address).filter(Boolean))],
    [properties],
  );

  const [query, setQuery] = useState('');
  const [type, setType] = useState('all');
  const [city, setCity] = useState('all');
  const [district, setDistrict] = useState('all');
  const [priceFrom, setPriceFrom] = useState('');
  const [priceTo, setPriceTo] = useState('');
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const q = params.get('q') || params.get('keyword') || '';
    const nextType = params.get('type') || 'all';
    const nextCity = params.get('city') || 'all';
    if (q) setQuery(q);
    if (nextType !== 'all') setType(nextType);
    if (nextCity !== 'all') setCity(nextCity);
  }, []);

  const filtered = useMemo(() => {
    const from = Number(priceFrom) || 0;
    const to = Number(priceTo) || Number.POSITIVE_INFINITY;
    const q = query.trim();
    return properties.filter(property => {
      if (type !== 'all' && property.type !== type) return false;
      if (city !== 'all' && property.city !== city) return false;
      if (district !== 'all' && property.address !== district) return false;
      if (property.price < from || property.price > to) return false;
      if (!q) return true;
      const haystack = `${property.title} ${property.city} ${property.address} ${property.type}`;
      return haystack.includes(q);
    });
  }, [properties, query, type, city, district, priceFrom, priceTo]);

  function clearFilters() {
    setQuery('');
    setType('all');
    setCity('all');
    setDistrict('all');
    setPriceFrom('');
    setPriceTo('');
  }

  return (
    <main className="offers-page">
      <SiteHeader />
      <section className="offers-hero">
        <p className="offers-kicker">عروض ساس الثراء</p>
        <h1>عروضنا العقارية</h1>
        <p>تصفح أحدث العقارات المتاحة مع فلترة سريعة حسب النوع والموقع والسعر.</p>
      </section>

      <section className="offers-filters" aria-label="فلاتر البحث">
        <label>
          اسم / كلمة
          <input
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="ابحث عن عرض..."
          />
        </label>
        <label>
          نوع العقار
          <select value={type} onChange={e => setType(e.target.value)}>
            <option value="all">الكل</option>
            {types.map(item => (
              <option key={item} value={item}>
                {item}
              </option>
            ))}
          </select>
        </label>
        <label>
          المدينة
          <select value={city} onChange={e => setCity(e.target.value)}>
            <option value="all">الكل</option>
            {cities.map(item => (
              <option key={item} value={item}>
                {item}
              </option>
            ))}
          </select>
        </label>
        <label>
          الحي
          <select value={district} onChange={e => setDistrict(e.target.value)}>
            <option value="all">الكل</option>
            {districts.map(item => (
              <option key={item} value={item}>
                {item}
              </option>
            ))}
          </select>
        </label>
        <label>
          السعر من
          <input
            type="number"
            min={0}
            value={priceFrom}
            onChange={e => setPriceFrom(e.target.value)}
            placeholder="مثلاً 500000"
          />
        </label>
        <label>
          السعر إلى
          <input
            type="number"
            min={0}
            value={priceTo}
            onChange={e => setPriceTo(e.target.value)}
            placeholder="مثلاً 2000000"
          />
        </label>
        <button type="button" className="offers-search-btn" aria-label="بحث">
          <Search size={18} />
          بحث
        </button>
        <button type="button" className="offers-clear-btn" onClick={clearFilters}>
          <X size={16} />
          مسح الكل
        </button>
      </section>

      <section className="offers-results">
        <p className="offers-count">{filtered.length} عرض متاح</p>
        <div className="offers-grid">
          {filtered.map(property => (
            <PropertyCard key={property.id} property={property} />
          ))}
        </div>
        {!filtered.length ? (
          <p className="offers-empty">لا توجد عروض مطابقة للفلاتر الحالية.</p>
        ) : null}
      </section>
    </main>
  );
}
