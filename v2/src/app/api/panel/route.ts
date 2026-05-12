import { NextRequest, NextResponse } from "next/server";

// Eski panel.js API'sini Next.js route olarak proxy et
// Bu endpoint /api/panel?action=xxx şeklinde çağrılır
export async function GET(req: NextRequest) {
  return handlePanelRequest(req);
}

export async function POST(req: NextRequest) {
  return handlePanelRequest(req);
}

async function handlePanelRequest(req: NextRequest) {
  try {
    const panelModule = await import("../../../../../api/panel.js");
    
    // URL params al
    const url = new URL(req.url);
    const query: Record<string, string> = {};
    url.searchParams.forEach((val, key) => { query[key] = val; });

    // Body al (POST için)
    let body = null;
    if (req.method === "POST") {
      try { body = await req.json(); } catch { body = {}; }
    }

    // Eski handler'ı simüle et
    const result = await new Promise<{ status: number; data: any }>((resolve) => {
      const fakeReq = {
        method: req.method,
        query,
        body,
        headers: Object.fromEntries(req.headers.entries()),
      };
      const fakeRes = {
        status: (code: number) => ({
          json: (data: any) => resolve({ status: code, data }),
          send: (msg: any) => resolve({ status: code, data: msg }),
        }),
        json: (data: any) => resolve({ status: 200, data }),
        send: (msg: any) => resolve({ status: 200, data: msg }),
        setHeader: () => {},
      };
      panelModule.default(fakeReq, fakeRes).catch((e: any) => 
        resolve({ status: 500, data: { error: e.message } })
      );
    });

    return NextResponse.json(result.data, { status: result.status });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
