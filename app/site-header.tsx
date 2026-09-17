type SiteHeaderProps = {
  variant?: 'overlay' | 'solid';
};

export default function SiteHeader({variant = 'solid'}: SiteHeaderProps) {
  const overlay = variant === 'overlay';
  return (
    <header className={`sas-header${overlay ? ' is-overlay' : ''}`}>
      <a href="/" aria-label="ساس الثراء الرئيسية" className="sas-logo">
        <img src="/brand/logo.png" alt="ساس الثراء للتسويق العقاري" />
      </a>
      <nav aria-label="القائمة الرئيسية">
        <a href="/">الرئيسية</a>
        <a href="/#about">من نحن</a>
        <a href="/#services">خدماتنا</a>
        <a href="/#properties">عروضنا</a>
        <a href="/calculate-loan">احسب تمويلك</a>
        <a href="/#contact">تواصل</a>
      </nav>
      <a className="sas-header-search" href="/#properties" aria-label="البحث في العروض">
        بحث
      </a>
    </header>
  );
}
