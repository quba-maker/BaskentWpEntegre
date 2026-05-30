import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Destek & İletişim — Quba AI",
  description: "Quba AI kurumsal destek talebi, demo başvuruları ve müşteri yardım kanalları.",
  alternates: {
    canonical: "https://ai.qubamedya.com/support",
  },
};

export default function SupportLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
