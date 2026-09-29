import type {Metadata} from 'next';
import {notFound} from 'next/navigation';
import {
  Bath,
  BedDouble,
  Building2,
  Car,
  CheckCircle2,
  Heart,
  MapPin,
  Maximize2,
  MessageCircle,
  Phone,
  Share2,
  ShieldAlert,
} from 'lucide-react';
import {getAdmin} from '@/lib/admin';
import {loadPublishedProperty} from '@/lib/property-catalog';
import type {CatalogProperty} from '@/lib/property-types';
import PublicLeadForm from '@/components/public-lead-form';
import LeadForm from '../../lead-form';
import SiteHeader from '../../site-header';
import '../properties.css';

export const dynamic = 'force-dynamic';

type Property = CatalogProperty;

export async function generateMetadata({
  params,
}: {
  params: Promise<{id: string}>;
}): Promise<Metadata> {
  const {id} = await params;
  const property = await loadPublishedProperty(id);
  if (!property) return {title: 'عقار | ساس الثراء'};
  return {
    title: `${property.title} | ساس الثراء`,
    description: property.description?.slice(0, 140) || property.title,
  };
}

function money(value: number | null) {
  if (value == null) return 'عند الطلب';
  return value.toLocaleString('ar-SA');
}

function internalFacilities(property: Property) {
  return [
    {label: 'الغرف', value: property.beds || '—', Icon: BedDouble},
    {label: 'الحمامات', value: property.baths || '—', Icon: Bath},
    {label: 'المساحة', value: property.area == null ? '—' : `${property.area} م²`, Icon: Maximize2},
    {label: 'المطبخ', value: 'متوفر', Icon: CheckCircle2},
    {label: 'الصالة', value: 'متوفرة', Icon: Building2},
    {label: 'التكييف', value: 'متوفر', Icon: CheckCircle2},
  ];
}

const externalFacilities = [
  {label: 'موقف سيارات', value: 'متوفر', Icon: Car},
  {label: 'مصعد', value: 'حسب العقار', Icon: Building2},
  {label: 'حراسة', value: 'حسب العقار', Icon: ShieldAlert},
];

export default async function PropertyDetailPage({
  params,
}: {
  params: Promise<{id: string}>;
}) {
  const admin = await getAdmin();
  const {id} = await params;
  const property = await loadPublishedProperty(id);
  if (!property) notFound();

  const images = property.images?.length ? property.images : ['/brand/logo.png'];
  const thumbs = images.slice(0, 5);
  const purpose = property.purpose === 'إيجار' ? 'للإيجار' : property.purpose === 'بيع' ? 'للبيع' : property.type === 'فلل' ? 'للبيع' : 'عرض عقاري';
  const extra = [
    property.purpose ? {label: 'الغرض', value: property.purpose === 'إيجار' ? 'للإيجار' : 'للبيع'} : null,
    property.streetWidth ? {label: 'عرض الشارع', value: `${property.streetWidth} م`} : null,
    property.facade ? {label: 'الواجهة', value: property.facade} : null,
    property.age ? {label: 'العمر', value: property.age === 'جديد' ? 'جديد' : `${property.age} سنوات`} : null,
  ].filter((item): item is {label: string; value: string} => item != null);

  return (
    <main className="listing-detail">
      <SiteHeader />
      <div className="listing-wrap">
        <nav className="listing-breadcrumbs" aria-label="مسار الصفحة">
          <a href="/">الرئيسية</a>
          <span>/</span>
          <a href="/properties">عروضنا العقارية</a>
          <span>/</span>
          <span>{property.address || property.city}</span>
        </nav>

        <div className="listing-title-row">
          <div>
            <p className="listing-license">رقم الإعلان: {property.id}</p>
            <h1>{property.title}</h1>
            <p className="listing-place">
              <MapPin size={16} />
              {property.address || property.city}
              {property.address && property.city ? `، ${property.city}` : ''}
            </p>
          </div>
          <a className="listing-back" href="/properties" aria-label="العودة للعروض">
            ←
          </a>
        </div>

        <div className="listing-top-grid">
          <div className="listing-gallery">
            <div className="listing-thumbs" aria-label="صور مصغرة">
              {thumbs.map((image, index) => (
                <img
                  key={`${image}-${index}`}
                  src={image}
                  alt={`${property.title} صورة ${index + 1}`}
                  loading={index ? 'lazy' : 'eager'}
                />
              ))}
            </div>
            <div className="listing-hero-image">
              <img src={images[0]} alt={property.title} />
              <span className="listing-purpose">{purpose}</span>
            </div>
          </div>

          <aside className="listing-agent-card">
            <div className="listing-agent-head">
              <div className="listing-agent-avatar">س</div>
              <div>
                <h2>ساس الثراء للعقارات</h2>
                <p>@sasalthra</p>
              </div>
            </div>
            <div className="listing-license-box">رقم رخصة فال: —</div>
            <a className="listing-follow" href="mailto:info@sasalthra.sa">
              تواصل مع المكتب
            </a>
            <div className="listing-side-actions">
              <a href={`mailto:info@sasalthra.sa?subject=${encodeURIComponent(property.title)}`}>
                <MessageCircle size={16} /> محادثة
              </a>
              <a href="tel:+966">
                <Phone size={16} /> اتصال
              </a>
            </div>
            <PublicLeadForm
              source="property-inquiry"
              propertyId={property.id}
              propertyTitle={property.title}
              heading="استفسار عن هذا العقار"
              intro="أدخل جوالك بأي صيغة، ويصل الطلب إلى ملف العميل في النظام."
              submitLabel="أرسل الاستفسار"
            />
            {admin ? (
              <div className="listing-admin-lead">
                <h3>تسجيل اهتمام داخلي</h3>
                <LeadForm propertyId={property.id} />
              </div>
            ) : null}
          </aside>
        </div>

        <div className="listing-meta-bar">
          <div className="listing-meta-info">
            <span>معرض يضم {images.length} صورة</span>
            <strong>
              {purpose} {money(property.price)} ر.س
            </strong>
          </div>
          <div className="listing-meta-actions">
            <button type="button">
              <ShieldAlert size={15} /> بلاغ
            </button>
            <button type="button">
              <Share2 size={15} /> مشاركة
            </button>
            <a href={`mailto:info@sasalthra.sa?subject=${encodeURIComponent(property.title)}`}>
              <MessageCircle size={15} /> محادثة
            </a>
            <a href="tel:+966">
              <Phone size={15} /> اتصال
            </a>
            <button type="button">
              <Heart size={15} /> إعجاب
            </button>
          </div>
        </div>

        <div className="listing-tools">
          <button type="button">الفحص الفني</button>
          <button type="button">مخطط البناء</button>
          <button type="button">عرض ثلاثي الأبعاد</button>
        </div>

        {extra.length ? (
          <section className="listing-section">
            <h2>تفاصيل إضافية</h2>
            <div className="listing-facilities">
              {extra.map(item => (
                <article key={item.label}>
                  <MapPin size={22} />
                  <span>{item.label}</span>
                  <strong>{item.value}</strong>
                </article>
              ))}
            </div>
          </section>
        ) : null}

        <section className="listing-section">
          <h2>الوصف</h2>
          <div className="listing-description">
            <p>{property.description || 'لا يوجد وصف إضافي لهذا العقار حالياً.'}</p>
          </div>
        </section>

        <section className="listing-section">
          <h2>المرافق الداخلية</h2>
          <div className="listing-facilities">
            {internalFacilities(property).map(item => (
              <article key={item.label}>
                <item.Icon size={22} />
                <span>{item.label}</span>
                <strong>{item.value}</strong>
              </article>
            ))}
          </div>
        </section>

        <section className="listing-section">
          <h2>المرافق الخارجية</h2>
          <div className="listing-facilities">
            {externalFacilities.map(item => (
              <article key={item.label}>
                <item.Icon size={22} />
                <span>{item.label}</span>
                <strong>{item.value}</strong>
              </article>
            ))}
          </div>
        </section>
      </div>
    </main>
  );
}
