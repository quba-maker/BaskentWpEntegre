import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth/session";

// Root "/" → Eğer giriş yapılmışsa dashboard'a, yapılmamışsa login'e git
export default async function RootPage() {
  const session = await getSession();
  
  if (session) {
    redirect("/inbox"); // Dashboard ana sayfası
  } else {
    redirect("/login");
  }
}
