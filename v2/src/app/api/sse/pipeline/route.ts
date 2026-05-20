import { NextRequest } from 'next/server';
import { PipelineOrchestrator } from '@/lib/domain/ingestion/orchestrator/pipeline-orchestrator';
import { GeminiAdapter } from '@/lib/domain/ai/providers/gemini-adapter';
import { PipelineRealtimeEvent } from '@/lib/core/events/pipeline-events';

export const runtime = 'edge';

/**
 * Enterprise SSE Route for Realtime Pipeline Status
 * Supports Last-Event-ID for resumability and AbortSignal for cancellation.
 */
export async function GET(req: NextRequest) {
  const encoder = new TextEncoder();
  const lastEventId = req.headers.get('Last-Event-ID');
  const signal = req.signal; // Abort signal when client disconnects

  const readable = new ReadableStream({
    async start(controller) {
      // Send an initial connected message
      controller.enqueue(encoder.encode(`id: 0\nevent: connected\ndata: ${JSON.stringify({ status: 'connected', resumable: !!lastEventId })}\n\n`));

      const aiProvider = new GeminiAdapter();
      const orchestrator = new PipelineOrchestrator(aiProvider);

      const url = new URL(req.url);
      const scenario = url.searchParams.get('scenario') || 'normal';

      const mockRawData = scenario === 'review_needed' 
        ? JSON.stringify({ FullName: 'Mustafa K.', Contact: 'No phone given, email is musti@test', Note: 'Wants an appointment ASAP but didn\'t say which branch' })
        : JSON.stringify({ "Ad Soyad": "Ahmet Yılmaz", "Telefon": "05554443322", "Email": "ahmet@test.com", "İlgi": "Kardiyoloji" });

      const expectedSchema = [
        { name: 'firstName', type: 'string', required: true },
        { name: 'lastName', type: 'string', required: true },
        { name: 'phone', type: 'string', required: true }
      ];

      let eventIndex = lastEventId ? parseInt(lastEventId, 10) : 0;

      try {
        await orchestrator.runPipeline('demo_tenant_id', mockRawData, expectedSchema, signal, (event: PipelineRealtimeEvent) => {
          eventIndex++;
          // Standard SSE format: id, event, data
          const ssePayload = `id: ${eventIndex}\nevent: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`;
          controller.enqueue(encoder.encode(ssePayload));
        });
        
        // Final close event
        controller.enqueue(encoder.encode(`id: ${eventIndex+1}\nevent: done\ndata: ${JSON.stringify({ status: 'done' })}\n\n`));
      } catch (err: any) {
        if (err.name === 'AbortError' || signal.aborted) {
          console.log('[SSE] Client disconnected, pipeline aborted');
          // Graceful termination handled by orchestrator
        } else {
          controller.enqueue(encoder.encode(`event: error\ndata: ${JSON.stringify({ status: 'error', message: err.message })}\n\n`));
        }
      } finally {
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
