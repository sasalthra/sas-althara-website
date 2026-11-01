import {
  OFFICE_EMAIL,
  OFFICE_PHONE_DISPLAY,
  OFFICE_PHONE_TEL,
} from '@/lib/public-contact';

export default function SiteFooter() {
  return (
    <footer className="sas-footer">
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
        <a className="sas-phone-link" href={OFFICE_PHONE_TEL}>
          {OFFICE_PHONE_DISPLAY}
        </a>
        <a href={`mailto:${OFFICE_EMAIL}`}>{OFFICE_EMAIL}</a>
        <a href="/contact-us">بيانات التواصل</a>
      </div>
      <p className="copyright">
        جميع الحقوق محفوظة | ساس الثراء © {new Date().getFullYear()}
      </p>
    </footer>
  );
}
