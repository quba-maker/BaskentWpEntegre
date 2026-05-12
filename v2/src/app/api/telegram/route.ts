import { NextRequest, NextResponse } from "next/server";

export async function POST(req: NextRequest) {
  try {
    const telegramModule = await import("../../../../../api/telegram.js");
    const body = await req.json();
    
    const result = await new Promise<{ status: number; data: any }>((resolve) => {
      const fakeReq = { method: "POST", body, query: {}, headers: {} };
      const fakeRes = {
        status: (code: number) => ({
          json: (data: any) => resolve({ status: code, data }),
          send: (msg: any) => resolve({ status: code, data: msg }),
        }),
        json: (data: any) => resolve({ status: 200, data }),
        send: (msg: any) => resolve({ status: 200, data: msg }),
      };
      telegramModule.default(fakeReq, fakeRes).catch((e: any) =>
        resolve({ status: 500, data: { error: e.message } })
      );
    });

    return NextResponse.json(result.data, { status: result.status });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
