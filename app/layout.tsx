import type { Metadata } from "next";
import "./globals.css";
import "./site.css";
import "./sas-brand.css";

export const metadata: Metadata = {
  title: "ساس الثراء | العقارات وإدارة العملاء",
  description: "استكشف العقارات والمساحات مع ساس الثراء.",
  other: {

  },
  icons: {
    icon: "/brand/logo.png",
    shortcut: "/brand/logo.png",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ar" dir="rtl">
      <body className="antialiased">{children}</body>
    </html>
  );
}
