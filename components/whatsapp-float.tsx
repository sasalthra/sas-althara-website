'use client';

import {usePathname} from 'next/navigation';
import {OFFICE_WHATSAPP_URL} from '@/lib/public-contact';

export default function WhatsAppFloat() {
  const pathname = usePathname() || '';
  if (pathname === '/crm' || pathname.startsWith('/crm/')) return null;

  return (
    <a
      className="whatsapp-float"
      href={OFFICE_WHATSAPP_URL}
      target="_blank"
      rel="noopener noreferrer"
      aria-label="تواصل عبر واتساب"
    >
      <svg viewBox="0 0 32 32" width="32" height="32" aria-hidden="true">
        <path
          fill="currentColor"
          d="M16.01 3.2C9.4 3.2 4.03 8.55 4.03 15.14c0 2.1.55 4.15 1.6 5.96L4 28.8l7.86-2.06a12.1 12.1 0 0 0 4.15.73h.01c6.61 0 11.98-5.35 11.98-11.94 0-3.19-1.25-6.19-3.52-8.45A11.9 11.9 0 0 0 16.01 3.2zm6.95 16.95c-.29.82-1.45 1.5-2.36 1.7-.63.13-1.45.24-4.22-.9-3.54-1.46-5.82-5.05-6-5.29-.17-.24-1.42-1.89-1.42-3.6 0-1.72.9-2.56 1.22-2.91.32-.35.7-.44.93-.44.23 0 .47 0 .67.01.22.01.5-.08.79.6.29.7.99 2.41 1.08 2.59.09.17.15.38.03.61-.12.23-.18.38-.35.58-.17.2-.36.45-.52.6-.17.16-.35.34-.15.66.2.32.89 1.46 1.91 2.37 1.31 1.17 2.42 1.53 2.76 1.7.35.17.55.15.75-.09.2-.23.87-1.01 1.1-1.36.23-.35.47-.29.79-.17.32.12 2.04.96 2.39 1.14.35.17.58.26.67.41.08.14.08.84-.21 1.66z"
        />
      </svg>
    </a>
  );
}
