import { NextRequest, NextResponse } from "next/server";
import { headers } from "next/headers";
import crypto from "crypto";

// Helper to generate Meta signature
function generateSignature(payload: string, secret: string) {
  return "sha256=" + crypto.createHmac("sha256", secret).update(payload).digest("hex");
}

export async function POST(req: NextRequest) {
  try {
    const { tenantSlug, providerMessageId, provider, duplicateCount = 3 } = await req.json();

    if (!tenantSlug || !providerMessageId) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
    }

    const appSecret = process.env.META_APP_SECRET || "dummy"; // Fallback to dummy for tests

    // Simulate Whatsapp Payload
    const payload = JSON.stringify({
      object: provider === "messenger" ? "page" : "whatsapp_business_account",
      entry: [
        {
          id: "TEST_PAGE_ID",
          changes: [
            {
              value: {
                messaging_product: "whatsapp",
                metadata: {
                  display_phone_number: "15551234567",
                  phone_number_id: "TEST_PHONE_ID"
                },
                contacts: [{ profile: { name: "Test User" }, wa_id: "15550001111" }],
                messages: [
                  {
                    from: "15550001111",
                    id: providerMessageId,
                    timestamp: Math.floor(Date.now() / 1000).toString(),
                    text: { body: "This is a simulated test message" },
                    type: "text"
                  }
                ]
              }
            }
          ]
        }
      ]
    });

    const signature = generateSignature(payload, appSecret);

    const results = [];

    // Fire identical webhooks sequentially (or in parallel) to test deduplication
    for (let i = 0; i < duplicateCount; i++) {
      const start = Date.now();
      const origin = new URL(req.url).origin;
      
      const res = await fetch(`${origin}/api/webhooks/meta`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-hub-signature-256": signature,
          "x-tenant-slug": tenantSlug // Pass tenant explicitly for ApiGuard resolution
        },
        body: payload
      });

      results.push({
        attempt: i + 1,
        status: res.status,
        text: await res.text(),
        latencyMs: Date.now() - start
      });
    }

    return NextResponse.json({
      message: `Simulated ${duplicateCount} identical webhooks`,
      results
    });

  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
