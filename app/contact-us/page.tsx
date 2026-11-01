import type {Metadata} from 'next';
import {MapPin, Phone} from 'lucide-react';
import PublicLeadForm from '@/components/public-lead-form';
import {
  OFFICE_EMAIL,
  OFFICE_MAP_EMBED_URL,
  OFFICE_MAPS_URL,
  OFFICE_PHONE_DISPLAY,
  OFFICE_PHONE_TEL,
} from '@/lib/public-contact';
import SiteFooter from '../site-footer';
import SiteHeader from '../site-header';

export const metadata: Metadata = {
  title: 'تواصل معنا | ساس الثراء',
  description: 'هاتف مكتب ساس الثراء 056 300 0556 وموقع المكتب في جدة.',
};

export default function ContactUsPage() {
  return (
    <div className="contact-page">
      <SiteHeader />
      <main>
        <section className="contact-hero">
          <p className="contact-kicker">ساس الثراء للتسويق العقاري</p>
          <h1>تواصل معنا</h1>
          <p>يسعدنا استقبال اتصالك أو زيارتك في مكتبنا بجدة.</p>
        </section>

        <section className="contact-grid" aria-label="بيانات التواصل">
          <article className="contact-card">
            <span className="contact-card-icon" aria-hidden="true">
              <Phone size={22} strokeWidth={1.7} />
            </span>
            <h2>رقم الهاتف</h2>
            <a className="contact-phone" href={OFFICE_PHONE_TEL}>
              {OFFICE_PHONE_DISPLAY}
            </a>
            <p>اضغط على الرقم للاتصال مباشرة.</p>
          </article>

          <article className="contact-card">
            <span className="contact-card-icon" aria-hidden="true">
              <MapPin size={22} strokeWidth={1.7} />
            </span>
            <h2>موقع المكتب</h2>
            <p>مكتب ساس الثراء العقارية في جدة.</p>
            <a
              className="contact-map-btn"
              href={OFFICE_MAPS_URL}
              target="_blank"
              rel="noopener noreferrer"
            >
              موقع المكتب
            </a>
            <a className="contact-mail" href={`mailto:${OFFICE_EMAIL}`}>
              {OFFICE_EMAIL}
            </a>
          </article>
        </section>

        <section className="contact-map" aria-label="خريطة موقع المكتب">
          <h2>الخريطة</h2>
          <iframe
            title="موقع مكتب ساس الثراء على خرائط جوجل"
            src={OFFICE_MAP_EMBED_URL}
            loading="lazy"
            referrerPolicy="no-referrer-when-downgrade"
            allowFullScreen
          />
        </section>

        <section className="public-lead-band" aria-label="أرسل رسالة">
          <PublicLeadForm
            source="contact"
            heading="أرسل رسالة"
            intro="اترك اسمك ورقم جوالك، ويسجّل الطلب مباشرة في نظام العملاء."
            submitLabel="أرسل رسالة"
          />
        </section>
      </main>
      <SiteFooter />
    </div>
  );
}
