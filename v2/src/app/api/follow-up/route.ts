import { NextResponse } from "next/server";

// Follow-up cron job
export async function GET() {
  try {
    // Dynamic import
    const followUpModule = await import("../../../../../api/follow-up.js");
    
    // Simulate req/res for the old handler
    const result = await new Promise<string>((resolve) => {
      const fakeReq = { method: "GET" };
      const fakeRes = {
        status: (code: number) => ({
          json: (data: any) => resolve(JSON.stringify(data)),
          send: (msg: string) => resolve(msg),
        }),
        json: (data: any) => resolve(JSON.stringify(data)),
      };
      followUpModule.default(fakeReq, fakeRes).catch((e: any) => resolve("Error: " + e.message));
    });

    return NextResponse.json({ success: true, result });
  } catch (e: any) {
    console.error("Follow-up cron hatası:", e);
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
