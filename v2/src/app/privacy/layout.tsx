import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Gizlilik Politikası — Quba AI",
  description: "Quba AI gizlilik politikası ve kişisel verilerin korunması.",
  alternates: {
    canonical: "https://ai.qubamedya.com/privacy",
  },
};

export default function PrivacyLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
