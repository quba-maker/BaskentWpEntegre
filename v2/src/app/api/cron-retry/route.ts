import { NextResponse } from "next/server";
import { processRetryQueue } from "@/lib/retry";

// ==========================================
// QUBA AI — Message Retry Cron Job
// Vercel Cron: her 5 dakikada bir çalışır
// vercel.json → { "path": "/api/cron-retry", "schedule": "*/5 * * * *" }
// ==========================================

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  // Vercel cron güvenliği
  const authHeader = req.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    // CRON_SECRET tanımlı değilse development'ta izin ver
    if (process.env.CRON_SECRET) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

  try {
    const stats = await processRetryQueue();
    return NextResponse.json({
      success: true,
      ...stats,
      timestamp: new Date().toISOString(),
    });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
