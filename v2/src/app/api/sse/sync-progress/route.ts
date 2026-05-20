export const dynamic = 'force-dynamic';

import { Redis } from "@upstash/redis";
import { NextRequest } from "next/server";

const redis = Redis.fromEnv();

export async function GET(req: NextRequest) {
  const tenantId = req.nextUrl.searchParams.get('tenantId');
  const correlationId = req.nextUrl.searchParams.get('correlationId');

  if (!tenantId || !correlationId) {
    return new Response("Missing parameters", { status: 400 });
  }

  const stream = new ReadableStream({
    async start(controller) {
      const encoder = new TextEncoder();
      
      const sendEvent = (data: any) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
      };

      let interval: NodeJS.Timeout;
      
      const checkProgress = async () => {
        try {
          const statusData: any = await redis.get(`sync_status:${tenantId}:${correlationId}`);
          
          if (statusData) {
            sendEvent(statusData);
            
            if (statusData.status === 'completed' || statusData.status === 'error') {
              clearInterval(interval);
              setTimeout(() => {
                try { controller.close(); } catch(e) {}
              }, 1000);
            }
          }
        } catch (error) {
          clearInterval(interval);
          try { controller.close(); } catch(e) {}
        }
      };

      // Initial check
      await checkProgress();
      
      // Poll every 2 seconds
      interval = setInterval(checkProgress, 2000);
      
      // Safety timeout (5 minutes max)
      setTimeout(() => {
        clearInterval(interval);
        try { controller.close(); } catch(e) {}
      }, 5 * 60 * 1000);
    },
    cancel() {
      // Stream cancelled by client
    }
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
    },
  });
}
