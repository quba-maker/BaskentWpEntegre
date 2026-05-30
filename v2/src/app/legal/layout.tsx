import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Yasal Bilgiler — Quba AI",
  description: "Quba AI resmi yasal firma bilgileri, vergi dairesi ve vergi kimlik numarası.",
  alternates: {
    canonical: "https://ai.qubamedya.com/legal",
  },
};

export default function LegalLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
