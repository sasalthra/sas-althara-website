import type {Metadata} from 'next';
import SiteHeader from '../site-header';
import LoanCalculator from './loan-calculator';

export const metadata: Metadata = {
  title: 'احسب تمويلك | ساس الثراء',
  description:
    'احسب القسط الشهري التقريبي لتمويلك العقاري وأرسل طلبك لفريق ساس الثراء ليتواصل معك.',
};

export default function CalculateLoanPage() {
  return (
    <main className="loan-page">
      <SiteHeader />
      <div className="loan-hero">
        <p className="loan-kicker">التمويل العقاري</p>
        <h1>احسب تمويلك</h1>
        <p>
          أداة سريعة لتقدير القسط الشهري، مع إرسال بياناتك مباشرة إلى فريق المبيعات
          في ساس الثراء.
        </p>
      </div>
      <LoanCalculator />
    </main>
  );
}
