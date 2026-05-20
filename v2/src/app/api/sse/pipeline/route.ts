import { NextRequest } from 'next/server';

export const runtime = 'edge';

/**
 * SSE Route for Realtime Pipeline Status
 * Allows the frontend to listen to events like "Semantic Analysis Running...", "Duplicate Detected", etc.
 */
export async function GET(req: NextRequest) {
  const encoder = new TextEncoder();
  const readable = new ReadableStream({
    start(controller) {
      // Send an initial connected message
      controller.enqueue(encoder.encode(`data: ${JSON.stringify({ status: 'connected' })}\n\n`));

      // Simulate a pipeline event stream
      let step = 0;
      const interval = setInterval(() => {
        step++;
        
        const payload = {
          status: 'running',
          step,
          message: step === 1 ? 'Semantic Analysis Started...' : 
                   step === 2 ? 'Duplicate Resolution Check...' : 
                   'Human Review Required',
        };

        controller.enqueue(encoder.encode(`data: ${JSON.stringify(payload)}\n\n`));

        if (step >= 3) {
          clearInterval(interval);
          controller.close();
        }
      }, 2000);
    },
  });

  return new Response(readable, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    },
  });
}
