'use client';

import {useEffect, useState} from 'react';

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
    fetch('/api/alerts', {cache: 'no-store', signal: controller.signal})
      .then(async response => {
        const data = await response.json();
        if (!response.ok) return;
        setAlerts(Array.isArray(data.alerts) ? data.alerts : []);
      })
      .catch(() => {});
    return () => controller.abort();
  }, []);

  if (!alerts.length) return null;

  return (
    <section className="mb-4 rounded-2xl border border-amber-300 bg-amber-50 p-4" aria-label="تنبيهات التقارير الميدانية">
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
