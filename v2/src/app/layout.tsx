import type { Metadata } from "next";
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
      <body className="h-full bg-[#F2F2F7] text-[#1D1D1F]">
        {children}
      </body>
    </html>
  );
}
