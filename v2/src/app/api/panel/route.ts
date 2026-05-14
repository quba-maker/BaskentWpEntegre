import { NextResponse } from "next/server";

// ==========================================
// QUBA AI — Legacy Panel API (DEPRECATED)
// Tüm işlevler v2 Server Actions'a taşındı.
// Bu endpoint artık kullanılmıyor.
// ==========================================

export async function GET() {
  return NextResponse.json({
    error: "Bu endpoint kullanımdan kaldırıldı. Lütfen yeni panel'i kullanın.",
    deprecated: true,
    migration: {
      dashboard: "actions/dashboard.ts",
      conversations: "actions/inbox.ts",
      settings: "actions/bot.ts + actions/settings.ts",
      forms: "actions/forms.ts",
      users: "actions/users.ts",
    },
  }, { status: 410 });
}

export async function POST() {
  return NextResponse.json({
    error: "Bu endpoint kullanımdan kaldırıldı.",
    deprecated: true,
  }, { status: 410 });
}
