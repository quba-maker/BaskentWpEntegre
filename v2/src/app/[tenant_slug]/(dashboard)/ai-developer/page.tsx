import { getSession } from "@/lib/auth/session";
import { redirect } from "next/navigation";
import { AiDeveloperConsole } from "@/components/features/ai-developer/AiDeveloperConsole";

export const metadata = {
  title: "AI Geliştirici Konsolu | Quba AI",
  description: "AI Sistem Logları, Karar Takibi ve Sağlık Durumu",
};

export default async function AiDeveloperPage() {
  const session = await getSession();

  // Yalnızca admin ve owner erişebilir
  if (session?.role !== "admin" && session?.role !== "owner") {
    redirect(`/${session?.tenantSlug}`);
  }

  return (
    <div className="p-6 md:p-8 max-w-7xl mx-auto">
      <AiDeveloperConsole />
    </div>
  );
}
