import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Giriş Yap — Quba AI",
  description: "Quba AI yapay zeka iletişim platformuna giriş yapın.",
};

export default function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <>{children}</>;
}
