import type { Metadata } from "next";
import { QueryProvider } from "@/components/providers/query-provider";
import "./globals.css";

export const metadata: Metadata = {
  title: "Quba AI — Yapay Zeka İletişim Platformu",
  description: "Quba AI ile işletmenizin müşteri iletişimini otomatikleştirin.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="tr" className="h-full antialiased font-sans">
      <body className="h-full bg-[--q-bg-tertiary] text-[--q-text-primary]">
        <QueryProvider>
          {children}
        </QueryProvider>
      </body>
    </html>
  );
}
