import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Kullanım Koşulları — Quba AI",
  description: "Quba AI kullanım koşulları ve hizmet şartları.",
};

export default function TermsLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
