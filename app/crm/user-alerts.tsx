'use client';

import {useEffect, useState} from 'react';
import {FIELD_REPORT_RESOLVED_EVENT, readFieldReportResolved} from '@/lib/field-report';

type UserAlert = {
  id: string;
  kind: string;
  leadId: string;
  message: string;
  createdAt: string;
};

export default function UserAlerts() {
  const [alerts, setAlerts] = useState<UserAlert[]>([]);

  useEffect(() => {
    const controller = new AbortController();
    const load = () => {
      fetch('/api/alerts', {cache: 'no-store', signal: controller.signal})
        .then(async response => {
          const data = await response.json();
          if (!response.ok) return;
          setAlerts(Array.isArray(data.alerts) ? data.alerts : []);
        })
        .catch(() => {});
    };
    const dropLead = (leadId: string) => {
      if (!leadId) return;
      setAlerts(current => current.filter(alert => alert.leadId !== leadId));
      load();
    };
    const onResolved = (event: Event) => {
      const detail = (event as CustomEvent<{leadId?: string}>).detail;
      dropLead(detail?.leadId || '');
    };
    const onStorage = (event: StorageEvent) => {
      if (event.key !== FIELD_REPORT_RESOLVED_EVENT) return;
      dropLead(readFieldReportResolved(event.newValue)?.leadId || '');
    };
    const onVisible = () => {
      if (document.visibilityState === 'visible') load();
    };
    load();
    const timer = window.setInterval(onVisible, 8000);
    window.addEventListener(FIELD_REPORT_RESOLVED_EVENT, onResolved);
    window.addEventListener('storage', onStorage);
    window.addEventListener('focus', onVisible);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      controller.abort();
      window.clearInterval(timer);
      window.removeEventListener(FIELD_REPORT_RESOLVED_EVENT, onResolved);
      window.removeEventListener('storage', onStorage);
      window.removeEventListener('focus', onVisible);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, []);

  if (!alerts.length) return null;

  return (
    <section className="crm-user-alerts mb-4 rounded-2xl border border-amber-300 bg-amber-50 p-4" aria-label="تنبيهات التقارير الميدانية">
      <h2 className="mb-2 text-sm font-bold text-amber-950">تنبيهات</h2>
      <ul className="space-y-2">
        {alerts.map(alert => {
          const href = alert.leadId ? `/crm/leads/${encodeURIComponent(alert.leadId)}` : '/crm?tab=leads';
          return (
            <li key={alert.id}>
              <a href={href} className="text-sm font-medium text-amber-950 underline underline-offset-4">
                {alert.message}
              </a>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
