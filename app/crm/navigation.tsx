"use client";
import { useSyncExternalStore, type MouseEvent } from "react";

function subscribe(change: () => void) {
  window.addEventListener("popstate", change);
  window.addEventListener("crm:navigate", change);
  return () => {
    window.removeEventListener("popstate", change);
    window.removeEventListener("crm:navigate", change);
  };
}
export function useCrmQuery() {
  const search = useSyncExternalStore(
    subscribe,
    () => window.location.search,
    () => "",
  );
  return new URLSearchParams(search);
}
export function CrmLink({
  href,
  children,
  onNavigate,
  ...props
}: React.AnchorHTMLAttributes<HTMLAnchorElement> & {
  href: string;
  onNavigate?: () => void;
}) {
  function follow(event: MouseEvent<HTMLAnchorElement>) {
    if (
      event.defaultPrevented ||
      event.button !== 0 ||
      event.metaKey ||
      event.ctrlKey ||
      event.shiftKey ||
      event.altKey
    )
      return;
    event.preventDefault();
    const target = new URL(href, window.location.origin);
    // Retain unrelated query state, replace only CRM navigation parameters.
    const current = new URL(window.location.href);
    for (const key of ["tab", "hr", "employee", "lead"])
      current.searchParams.delete(key);
    target.searchParams.forEach((value, key) =>
      current.searchParams.set(key, value),
    );
    window.history.pushState(null, "", current.pathname + current.search);
    window.dispatchEvent(new Event("crm:navigate"));
    onNavigate?.();
  }
  return (
    <a {...props} href={href} onClick={follow}>
      {children}
    </a>
  );
}
export const workspaceItems = [
  {
    id: "leads",
    label: "العملاء والمتابعات",
    group: "إدارة الأعمال",
    roles: ["admin", "supervisor", "sales", "field"],
  },
  {
    id: "properties",
    label: "العقارات",
    group: "إدارة الأعمال",
    roles: ["admin", "supervisor", "sales", "field"],
  },
  {
    id: "transactions",
    label: "المعاملات والمالية",
    group: "إدارة الأعمال",
    roles: ["admin"],
  },
  {
    id: "hr",
    label: "الموظفون والحضور",
    group: "مساحة الموظف",
    roles: ["admin", "supervisor", "sales", "field"],
  },
  {
    id: "ai",
    label: "المساعد الداخلي",
    group: "مساحة الموظف",
    roles: ["admin", "supervisor", "sales", "field"],
  },
  {
    id: "users",
    label: "المستخدمون والصلاحيات",
    group: "إدارة النظام",
    roles: ["admin"],
  },
  {
    id: "import",
    label: "استيراد Excel",
    group: "إدارة النظام",
    roles: ["admin", "supervisor"],
  },
  {
    id: "sheets",
    label: "إعدادات Google Sheets",
    group: "إدارة النظام",
    roles: ["admin"],
  },
];
