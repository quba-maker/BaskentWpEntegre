import { redirect } from "next/navigation";

// Dashboard root → Inbox'a yönlendir
export default function DashboardPage() {
  redirect("/inbox");
}
