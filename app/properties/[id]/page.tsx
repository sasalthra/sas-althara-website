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
import data from '@/data/properties.json';
import {getAdmin} from '@/lib/admin';
import LeadForm from '../../lead-form';
import SiteHeader from '../../site-header';
import '../properties.css';

type Property = (typeof data)[number];

export async function generateMetadata({
  params,
}: {
  params: Promise<{id: string}>;
}): Promise<Metadata> {
  const {id} = await params;
  const property = data.find(item => item.id === id);
  if (!property) return {title: 'عقار | ساس الثراء'};
  return {
    title: `${property.title} | ساس الثراء`,
    description: property.description?.slice(0, 140) || property.title,
  };
}

function money(value: number) {
  return value.toLocaleString('ar-SA');
}

function internalFacilities(property: Property) {
  return [
    {label: 'الغرف', value: property.beds || '—', Icon: BedDouble},
    {label: 'الحمامات', value: property.baths || '—', Icon: Bath},
    {label: 'المساحة', value: `${property.area} م²`, Icon: Maximize2},
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
  const property = data.find(item => item.id === id);
  if (!property) notFound();

  const images = property.images?.length ? property.images : ['/brand/logo.png'];
  const thumbs = images.slice(0, 5);
  const purpose = property.type === 'فلل' ? 'للبيع' : 'عرض عقاري';

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
