import { NextRequest } from 'next/server';
import { PipelineOrchestrator } from '@/lib/domain/ingestion/orchestrator/pipeline-orchestrator';
import { GeminiAdapter } from '@/lib/domain/ai/providers/gemini-adapter';
import { redis } from '@/lib/redis';

export const runtime = 'edge';
export const dynamic = 'force-dynamic';

/**
 * Enterprise SSE Route for Realtime Pipeline Status
 * Uses Ticket-based Auth for robust tenant isolation without complex middleware hooks.
 */
export async function GET(req: NextRequest) {
  const encoder = new TextEncoder();
  const url = new URL(req.url);
  const lastEventId = req.headers.get('Last-Event-ID') || url.searchParams.get('lastEventId');
  const ticket = url.searchParams.get('ticket');
  const signal = req.signal;

  let tenantSlug = 'demo_tenant_slug'; // fallback for dev without Redis

  if (redis) {
    if (!ticket) {
      return new Response('Missing Ticket', { status: 401 });
    }
    
    // Validate ticket and pop it (single-use)
    const sessionData = await redis.get(`sse_ticket:${ticket}`);
    if (!sessionData) {
      return new Response('Invalid or Expired Ticket', { status: 403 });
    }
    
    // Single-use guarantee
    await redis.del(`sse_ticket:${ticket}`);

    const parsedSession = typeof sessionData === 'string' ? JSON.parse(sessionData) : sessionData;
    tenantSlug = (parsedSession as any).tenantSlug;
  }

  const readable = new ReadableStream({
    async start(controller) {
      // Send an initial connected message
      controller.enqueue(encoder.encode(`id: 0\nevent: connected\ndata: ${JSON.stringify({ status: 'connected', resumable: !!lastEventId, tenantSlug })}\n\n`));

      // 10s Heartbeat Ping to prevent proxy timeouts
      const pingInterval = setInterval(() => {
        controller.enqueue(encoder.encode(`event: ping\ndata: ${JSON.stringify({ status: 'ping' })}\n\n`));
      }, 10000);

      const aiProvider = new GeminiAdapter();
      const orchestrator = new PipelineOrchestrator(aiProvider);

      const scenario = url.searchParams.get('scenario') || 'normal';

      const mockRawData = scenario === 'review_needed' 
        ? JSON.stringify({ FullName: 'Mustafa K.', Contact: 'No phone given, email is musti@test', Note: 'Wants an appointment ASAP but didn\'t say which branch' })
        : JSON.stringify({ "Ad Soyad": "Ahmet Yılmaz", "Telefon": "05554443322", "Email": "ahmet@test.com", "İlgi": "Kardiyoloji" });

      const expectedSchema = [
        { name: 'firstName', type: 'string', required: true },
        { name: 'lastName', type: 'string', required: true },
        { name: 'phone', type: 'string', required: true }
      ];

      try {
        await orchestrator.runPipeline(tenantSlug, mockRawData, expectedSchema, signal, (event: any) => {
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
