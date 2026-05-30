import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Veri Silme Talimatları — Quba AI",
  description: "Quba AI Meta App uyumlu veri silme talimatları ve adımları.",
  alternates: {
    canonical: "https://ai.qubamedya.com/data-deletion",
  },
};

export default function DataDeletionLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
