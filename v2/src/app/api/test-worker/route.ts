import { NextResponse } from 'next/server';
import { queueWorkerEngine } from '@/lib/queue/worker';
import { sql } from '@/lib/db';

export async function GET() {
  try {
    console.log("Fetching a tenant...");
    const tenants = await sql`SELECT id, slug FROM tenants LIMIT 1`;
    if (tenants.length === 0) {
      return NextResponse.json({ error: "No tenants found" }, { status: 400 });
    }
    const tenantId = tenants[0].id;

    const mockPayload = {
      object: "whatsapp_business_account",
      entry: [{
        id: "123456789",
        changes: [{
          value: {
            messaging_product: "whatsapp",
            metadata: {
              display_phone_number: "905551234567",
              phone_number_id: "123456789"
            },
            contacts: [{
              profile: { name: "Test User" },
              wa_id: "905551234567"
            }],
            messages: [{
              from: "905551234567",
              id: "wamid.HBgMOTA1MzIzNDU2Nzg5FQIAEhgUM0EwQTM1MUYxQTA5MzhDMTE5NEYA_" + Date.now(),
              timestamp: Math.floor(Date.now() / 1000).toString(),
              text: { body: "Hello World" },
              type: "text"
            }]
          },
          field: "messages"
        }]
      }]
    };

    console.log("Simulating queue processing...");
    await queueWorkerEngine.processEvent(
      "whatsapp.message.received",
      tenantId,
      mockPayload,
      { messageId: "test-trace-id", isRetry: false, retriedCount: 0 }
    );
    
    return NextResponse.json({ success: true, message: "Worker simulated successfully" });
  } catch (e: any) {
    console.error("Worker error:", e);
    return NextResponse.json({ error: e.message || String(e) }, { status: 500 });
  }
}
