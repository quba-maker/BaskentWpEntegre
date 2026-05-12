import { NextResponse } from "next/server";

// Cron appointments job
export async function GET() {
  try {
    const cronModule = await import("../../../../../api/cron-appointments.js");

    const result = await new Promise<string>((resolve) => {
      const fakeReq = { method: "GET" };
      const fakeRes = {
        status: (code: number) => ({
          json: (data: any) => resolve(JSON.stringify(data)),
          send: (msg: string) => resolve(msg),
        }),
        json: (data: any) => resolve(JSON.stringify(data)),
      };
      cronModule.default(fakeReq, fakeRes).catch((e: any) => resolve("Error: " + e.message));
    });

    return NextResponse.json({ success: true, result });
  } catch (e: any) {
    console.error("Cron appointments hatası:", e);
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
