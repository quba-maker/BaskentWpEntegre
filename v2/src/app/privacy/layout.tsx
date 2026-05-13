import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Gizlilik Politikası — Quba AI",
  description: "Quba AI gizlilik politikası ve kişisel verilerin korunması.",
};

export default function PrivacyLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
