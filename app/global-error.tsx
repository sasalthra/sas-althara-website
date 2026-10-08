'use client';

import {useEffect, useState} from 'react';

const brand = '#3F1A44';

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & {digest?: string};
  reset: () => void;
}) {
  const [adminMessage, setAdminMessage] = useState<string | null>(null);

  useEffect(() => {
    console.error(error);
    const digest = error.digest;
    if (!digest) return;
    const controller = new AbortController();
    fetch(`/api/diagnostics/render-error?digest=${encodeURIComponent(digest)}`, {
      signal: controller.signal,
      cache: 'no-store',
    })
      .then(async response => {
        if (!response.ok) return null;
        const body = await response.json() as {message?: unknown};
        return typeof body.message === 'string' ? body.message : null;
      })
      .then(message => {
        if (message) setAdminMessage(message);
      })
      .catch(() => {});
    return () => controller.abort();
  }, [error]);

  return (
    <html lang="ar" dir="rtl">
      <body style={{margin: 0, minHeight: '100vh', display: 'grid', placeItems: 'center', padding: 24, background: '#f7f4f8', color: '#1c1220', fontFamily: 'Tahoma, sans-serif'}}>
        <main style={{width: 'min(36rem, 100%)', background: '#fff', border: `1px solid ${brand}`, borderRadius: 16, padding: 28}}>
          <p style={{margin: 0, color: brand, fontWeight: 700}}>ساس الثراء</p>
          <h1 style={{margin: '12px 0 8px', color: brand, fontSize: 28}}>تعذر تحميل الصفحة</h1>
          <p style={{margin: 0, lineHeight: 1.7}}>حدث خطأ في الخادم. أعد تحميل الصفحة أو حاول مرة أخرى.</p>
          {error.digest ? (
            <p style={{marginTop: 16}}>
              مرجع الخطأ: <code dir="ltr" style={{color: brand}}>{error.digest}</code>
            </p>
          ) : null}
          {adminMessage ? (
            <p style={{marginTop: 12, padding: 12, background: '#f7f4f8', borderRadius: 8}}>
              تفاصيل للمسؤول: {adminMessage}
            </p>
          ) : null}
          <button
            type="button"
            onClick={() => reset()}
            style={{marginTop: 20, background: brand, color: '#fff', border: 0, borderRadius: 10, padding: '10px 18px', cursor: 'pointer'}}
          >
            إعادة المحاولة
          </button>
        </main>
      </body>
    </html>
  );
}
