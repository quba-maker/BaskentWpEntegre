import { redirect } from "next/navigation";

// ==========================================
// AI Modules page → Redirects to unified Bot Management
// All module management is now in /bot page
// ==========================================
export default function AIModulesRedirect() {
  redirect("../bot");
}
