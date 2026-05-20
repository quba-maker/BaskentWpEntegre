import { NextRequest } from 'next/server';
import { PipelineOrchestrator } from '@/lib/domain/ingestion/orchestrator/pipeline-orchestrator';
import { GeminiAdapter } from '@/lib/domain/ai/providers/gemini-adapter';

export const runtime = 'edge';
export const dynamic = 'force-dynamic';

/**
 * Enterprise SSE Route for Realtime Pipeline Status
 * Supports Last-Event-ID for resumability, AbortSignal for cancellation, and Heartbeat.
 */
export async function GET(req: NextRequest) {
  const encoder = new TextEncoder();
  const lastEventId = req.headers.get('Last-Event-ID') || req.nextUrl.searchParams.get('lastEventId');
  const signal = req.signal;

  const readable = new ReadableStream({
    async start(controller) {
      // Send an initial connected message
      controller.enqueue(encoder.encode(`id: 0\nevent: connected\ndata: ${JSON.stringify({ status: 'connected', resumable: !!lastEventId })}\n\n`));

      // 10s Heartbeat Ping to prevent proxy timeouts
      const pingInterval = setInterval(() => {
        controller.enqueue(encoder.encode(`event: ping\ndata: ${JSON.stringify({ status: 'ping' })}\n\n`));
      }, 10000);

      const aiProvider = new GeminiAdapter();
      const orchestrator = new PipelineOrchestrator(aiProvider);

      const url = new URL(req.url);
      const scenario = url.searchParams.get('scenario') || 'normal';

      // Tenant Validation: In a real system, pull this from JWT or SSE Ticket.
      // For now, using query or default to 'demo_tenant_id'
      const tenantId = url.searchParams.get('tenantId') || 'demo_tenant_id';

      const mockRawData = scenario === 'review_needed' 
        ? JSON.stringify({ FullName: 'Mustafa K.', Contact: 'No phone given, email is musti@test', Note: 'Wants an appointment ASAP but didn\'t say which branch' })
        : JSON.stringify({ "Ad Soyad": "Ahmet Yılmaz", "Telefon": "05554443322", "Email": "ahmet@test.com", "İlgi": "Kardiyoloji" });

      const expectedSchema = [
        { name: 'firstName', type: 'string', required: true },
        { name: 'lastName', type: 'string', required: true },
        { name: 'phone', type: 'string', required: true }
      ];

      try {
        await orchestrator.runPipeline(tenantId, mockRawData, expectedSchema, signal, (event: any) => {
          // Skip events we've already processed (Resumability logic)
          if (lastEventId && event.eventId <= lastEventId) {
            return;
          }
          const ssePayload = `id: ${event.eventId}\nevent: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`;
          controller.enqueue(encoder.encode(ssePayload));
        });
        
        // Final close event
        controller.enqueue(encoder.encode(`event: done\ndata: ${JSON.stringify({ status: 'done' })}\n\n`));
      } catch (err: any) {
        if (err.name === 'AbortError' || signal.aborted) {
          console.log('[SSE] Client disconnected, pipeline aborted gracefully');
        } else {
          console.error('[SSE] Pipeline error:', err);
          controller.enqueue(encoder.encode(`event: error\ndata: ${JSON.stringify({ status: 'error', message: err.message })}\n\n`));
        }
      } finally {
        clearInterval(pingInterval);
        controller.close();
      }
    },
  });

  return new Response(readable, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
    },
  });
}
