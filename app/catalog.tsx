'use client';

import {useMemo, useState} from 'react';
import {useRouter} from 'next/navigation';
import data from '@/data/properties.json';
import SiteHeader from './site-header';
import SearchAgent from './search-agent';
import {
  BadgeCheck,
  Building2,
  Calculator,
  Handshake,
  Heart,
  MapPin,
  BedDouble,
  Bath,
  Maximize2,
  Search,
  ShieldCheck,
  Sparkles,
  Users,
} from 'lucide-react';

const propertyTypes = [...new Set(data.map(p => p.type).filter(Boolean))];
const cities = [...new Set(data.map(p => p.city).filter(Boolean))];

const stats: [string, string][] = [
  ['350', 'وحدة معروضة'],
  ['532', 'وحدة مباعة'],
  ['610', 'عميل راضي'],
  ['10', 'سنوات خبرة'],
];

const values = [
  {
    title: 'خبرة موثوقة',
    text: 'سنوات من العمل في سوق جدة العقاري بعلاقات واسعة ونتائج ملموسة.',
    icon: BadgeCheck,
  },
  {
    title: 'شفافية كاملة',
    text: 'نلتزم بالوضوح في العروض والأسعار وتفاصيل الصفقات من البداية للنهاية.',
    icon: ShieldCheck,
  },
  {
    title: 'حلول تمويلية',
    text: 'نساعد عملاءنا على اختيار التمويل المناسب بالتعاون مع جهات معتمدة.',
    icon: Calculator,
  },
  {
    title: 'خدمة عملاء',
    text: 'فريق متخصص يرافقك في كل خطوة حتى إتمام الصفقة براحة وثقة.',
    icon: Users,
  },
];

const services = [
  {
    title: 'التسويق العقاري',
    text: 'عرض وتسويق العقارات عبر قنوات متنوعة لجذب العملاء والمستثمرين.',
    icon: Sparkles,
  },
  {
    title: 'الوساطة العقارية',
    text: 'التوسط بين البائع والمشتري لإتمام الصفقات بكفاءة واحترافية.',
    icon: Handshake,
  },
  {
    title: 'الحلول التمويلية',
    text: 'مساعدة العملاء في الحصول على التمويل المناسب بالتعاون مع جهات تمويلية معتمدة.',
    icon: Calculator,
  },
  {
    title: 'التقييم العقاري',
    text: 'إعداد تقارير دقيقة تحدد القيمة السوقية الحقيقية للعقار.',
    icon: Building2,
  },
];

function money(value: number) {
  return value.toLocaleString('ar-SA');
}

export default function Catalog() {
  const router = useRouter();
  const [q, setQ] = useState('');
  const [type, setType] = useState('all');
  const [city, setCity] = useState('all');
  const [limit] = useState(8);

  const filtered = useMemo(
    () =>
      data.filter(p => {
        if (type !== 'all' && p.type !== type) return false;
        if (city !== 'all' && p.city !== city) return false;
        if (!q.trim()) return true;
        return (p.title + p.city + p.address + p.type).includes(q.trim());
      }),
    [q, type, city],
  );

  const offers = filtered.slice(0, limit);

  function goSearch(e: React.FormEvent) {
    e.preventDefault();
    const params = new URLSearchParams();
    if (q.trim()) params.set('q', q.trim());
    if (type !== 'all') params.set('type', type);
    if (city !== 'all') params.set('city', city);
    const qs = params.toString();
    router.push(qs ? `/properties?${qs}` : '/properties');
  }

  return (
    <>
      <SearchAgent onSearch={setQ} />
      <div className="sas-home">
        <SiteHeader variant="overlay" />

        <main>
          <section className="sas-hero-bleed" aria-label="الواجهة الرئيسية">
            <img
              className="sas-hero-media"
              src="/brand/villas.webp"
              alt=""
              aria-hidden="true"
            />
            <div className="sas-hero-shade" />
            <div className="sas-hero-copy">
              <p className="sas-hero-kicker">ساس الثراء للتسويق العقاري</p>
              <h1>اعثر على عقارك المثالي في جدة بثقة واحترافية</h1>
              <p>
                نقدّم حلول تسويق ووساطة عقارية متكاملة، بعروض حقيقية وخدمة شفافة
                تساعدك على اتخاذ قرار الشراء بثقة.
              </p>
              <a className="sas-hero-cta" href="/properties">
                تصفح العروض العقارية
              </a>
            </div>
          </section>

          <section className="sas-search-overlap" aria-label="بحث العقارات">
            <div className="sas-search-card">
              <div className="sas-search-tabs" role="tablist" aria-label="نوع العرض">
                <button type="button" className="is-active" role="tab" aria-selected="true">
                  للبيع
                </button>
              </div>
              <form className="sas-search-form" onSubmit={goSearch}>
                <label>
                  كلمة البحث
                  <input
                    value={q}
                    onChange={e => setQ(e.target.value)}
                    placeholder="ابحث بالاسم أو الحي"
                    aria-label="كلمة البحث"
                  />
                </label>
                <label>
                  نوع العقار
                  <select
                    value={type}
                    onChange={e => setType(e.target.value)}
                    aria-label="نوع العقار"
                  >
                    <option value="all">الكل</option>
                    {propertyTypes.map(item => (
                      <option key={item} value={item}>
                        {item}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  المدينة
                  <select
                    value={city}
                    onChange={e => setCity(e.target.value)}
                    aria-label="المدينة"
                  >
                    <option value="all">الكل</option>
                    {cities.map(item => (
                      <option key={item} value={item}>
                        {item}
                      </option>
                    ))}
                  </select>
                </label>
                <button type="submit" className="sas-search-submit">
                  <Search size={18} />
                  بحث
                </button>
              </form>
            </div>
          </section>

          <section id="properties" className="sas-section sas-offers">
            <div className="sas-section-head">
              <div>
                <h2>عروضنا العقارية</h2>
                <p>شاهد أحدث العروض المتاحة واختر ما يناسب احتياجك</p>
              </div>
              <a className="sas-link-all" href="/properties">
                عرض الكل
              </a>
            </div>
            <div className="offers-grid">
              {offers.map(p => (
                <a className="offer-card" href={'/properties/' + p.id} key={p.id}>
                  <div className="offer-card-media">
                    <img loading="lazy" src={p.images[0]} alt={p.title} />
                    <span className="offer-badge is-available">متاح</span>
                    <button
                      type="button"
                      className="offer-fav"
                      aria-label="إضافة للمفضلة"
                      onClick={e => e.preventDefault()}
                    >
                      <Heart size={16} />
                    </button>
                  </div>
                  <div className="offer-card-body">
                    <h3>{p.title}</h3>
                    <p className="offer-location">
                      <MapPin size={14} />
                      <span>
                        {p.address || p.city}
                        {p.address && p.city ? `، ${p.city}` : ''}
                      </span>
                    </p>
                    <div className="offer-specs" aria-label="مواصفات العقار">
                      <div>
                        <span>عدد الغرف</span>
                        <strong>
                          {p.beds || '—'} <BedDouble size={16} />
                        </strong>
                      </div>
                      <div>
                        <span>الحمامات</span>
                        <strong>
                          {p.baths || '—'} <Bath size={16} />
                        </strong>
                      </div>
                      <div>
                        <span>المساحة</span>
                        <strong>
                          {p.area} م² <Maximize2 size={16} />
                        </strong>
                      </div>
                    </div>
                    <div className="offer-price">
                      <strong>{money(p.price)}</strong>
                      <small>ر.س</small>
                    </div>
                  </div>
                </a>
              ))}
            </div>
            {!offers.length ? (
              <p className="empty">لا توجد عروض مطابقة حالياً في البيانات المعتمدة.</p>
            ) : null}
          </section>

          <section className="sas-stats-strip" aria-label="أرقام ساس الثراء">
            {stats.map(([n, s]) => (
              <article key={s}>
                <span className="sas-stat-icon" aria-hidden="true">
                  <Building2 size={22} />
                </span>
                <strong>{n}+</strong>
                <span>{s}</span>
              </article>
            ))}
          </section>

          <section className="sas-loan-band" aria-label="احسب تمويلك">
            <div className="sas-loan-copy">
              <h2>احسب تمويلك العقاري</h2>
              <p>
                تعرّف بسرعة على القسط التقريبي وخيارات التمويل المناسبة قبل اتخاذ
                قرار الشراء.
              </p>
              <a className="sas-loan-cta" href="/calculate-loan">
                انتقل إلى حاسبة التمويل
              </a>
            </div>
            <form
              className="sas-loan-teaser"
              action="/calculate-loan"
              method="get"
              aria-label="معاينة حاسبة التمويل"
            >
              <label>
                قيمة العقار (ر.س)
                <input name="price" type="number" min={0} placeholder="مثلاً 900000" />
              </label>
              <label>
                الدفعة المقدمة (ر.س)
                <input name="down" type="number" min={0} placeholder="مثلاً 100000" />
              </label>
              <label>
                مدة التمويل (سنوات)
                <input name="years" type="number" min={1} max={30} placeholder="مثلاً 20" />
              </label>
              <button type="submit">احسب الآن</button>
            </form>
          </section>

          <section id="services" className="sas-section sas-services-lite">
            <h2>خدماتنا</h2>
            <p>حلول عقارية متكاملة تساعدك من البحث حتى إتمام الصفقة</p>
            <div className="sas-services-grid">
              {services.map(s => (
                <article key={s.title}>
                  <span className="sas-value-icon" aria-hidden="true">
                    <s.icon size={26} strokeWidth={1.6} />
                  </span>
                  <h3>{s.title}</h3>
                  <p>{s.text}</p>
                </article>
              ))}
            </div>
          </section>

          <section id="about" className="sas-section sas-why">
            <div className="sas-why-grid">
              <img src="/brand/about.webp" alt="ساس الثراء العقارية" />
              <div>
                <span className="eyebrow">من نحن</span>
                <h2>لماذا ساس الثراء؟</h2>
                <p>
                  ساس الثراء للتسويق العقاري هي شركة رائدة في مدينة جدة، متخصصة في
                  تقديم حلول متكاملة في مجال التسويق العقاري. نعمل بخبرة طويلة
                  وعلاقات واسعة تتيح لنا الوصول إلى العملاء والفرص الاستثمارية
                  بسرعة واحترافية، مع التركيز على المصداقية والشفافية في جميع
                  تعاملاتنا.
                </p>
                <div className="sas-values">
                  {values.map(v => (
                    <article key={v.title}>
                      <span className="sas-value-icon" aria-hidden="true">
                        <v.icon size={22} strokeWidth={1.7} />
                      </span>
                      <div>
                        <h3>{v.title}</h3>
                        <p>{v.text}</p>
                      </div>
                    </article>
                  ))}
                </div>
                <a className="primary" href="https://sasalthra.sa/about-us/">
                  المزيد عن ساس الثراء
                </a>
              </div>
            </div>
          </section>
        </main>

        <footer className="sas-footer" id="contact">
          <div>
            <img src="/brand/logo.png" alt="ساس الثراء" width={180} />
            <p>
              ساس الثراء للتسويق العقاري هي شركة رائدة في مدينة جدة، متخصصة في
              تقديم حلول متكاملة في مجال التسويق العقاري.
            </p>
          </div>
          <div>
            <h3>الأقسام</h3>
            <a href="/">الرئيسية</a>
            <a href="/#about">من نحن</a>
            <a href="/#services">خدماتنا</a>
            <a href="/#properties">عروضنا العقارية</a>
            <a href="/calculate-loan">احسب تمويلك</a>
          </div>
          <div>
            <h3>روابط تهمك</h3>
            <a href="https://sasalthra.sa/سياسة-الخصوصية/">سياسة الخصوصية</a>
            <a href="https://sasalthra.sa/wp-content/uploads/2025/09/brofile_sas.pdf">
              تحميل البروفايل
            </a>
            <a href="/crm">دخول النظام الداخلي</a>
            <a href="https://sasalthra.sa/blog/">المدونة</a>
          </div>
          <div>
            <h3>تواصل معنا</h3>
            <a href="mailto:info@sasalthra.sa">info@sasalthra.sa</a>
            <a href="https://sasalthra.sa/contact-us/">بيانات التواصل</a>
          </div>
          <p className="copyright">
            جميع الحقوق محفوظة | ساس الثراء © {new Date().getFullYear()}
          </p>
        </footer>
      </div>
    </>
  );
}
