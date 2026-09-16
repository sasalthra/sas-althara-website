import {notFound} from 'next/navigation';
import data from '@/data/properties.json';
import {getAdmin} from '@/lib/admin';
import LeadForm from '@/app/lead-form';
import SiteHeader from '@/app/site-header';

export default async function PropertyDetailPage({
  params,
}: {
  params: Promise<{id: string}>;
}) {
  const admin = await getAdmin();
  const {id} = await params;
  const property = data.find(item => item.id === id);
  if (!property) notFound();

  return (
    <main className="property-detail">
      <SiteHeader />
      <div className="page-wrap">
        <p className="subtle">
          {property.city} / {property.address} · معروض حالياً
        </p>
        <h1 className="detail-title">{property.title}</h1>

        <div className="detail-grid">
          <div>
            <div className="gallery" aria-label="معرض صور العقار">
              {property.images.map((image, index) => (
                <img
                  key={image}
                  src={image}
                  alt={`${property.title} — صورة ${index + 1}`}
                  loading={index ? 'lazy' : 'eager'}
                />
              ))}
            </div>
            <p className="subtle">معرض يضم {property.images.length} صورة</p>

            <div className="detail-panel" style={{marginTop: 16}}>
              <h2>{property.price.toLocaleString('ar-SA')} ر.س</h2>
              <div className="specs">
                <span>{property.area} م²</span>
                <span>{property.beds || '—'} غرف</span>
                <span>{property.baths || '—'} حمامات</span>
              </div>
              <h3>تفاصيل العقار</h3>
              <p className="description">{property.description}</p>
            </div>
          </div>

          <aside className="detail-panel cta-aside">
            <h2>مهتم بهذا العقار؟</h2>
            <p className="subtle">
              تواصل مع فريق ساس الثراء مباشرة، أو اترك بياناتك وسنعاود الاتصال بك.
            </p>
            <a
              className="primary"
              href={`mailto:info@sasalthra.sa?subject=${encodeURIComponent(property.title)}`}
            >
              تواصل عبر البريد
            </a>
            {admin ? (
              <>
                <h3>تسجيل اهتمام داخلي</h3>
                <LeadForm propertyId={property.id} />
              </>
            ) : null}
          </aside>
        </div>
      </div>
    </main>
  );
}

