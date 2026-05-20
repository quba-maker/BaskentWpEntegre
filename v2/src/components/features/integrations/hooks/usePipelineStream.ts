import { useEffect, useRef } from 'react';
import { usePipelineStore, hydratePipelineStore } from '../store/pipelineStore';
import { PipelineRealtimeEvent } from '@/lib/core/events/pipeline-events';

export function usePipelineStream(scenario: 'normal' | 'review_needed' = 'normal') {
  const { 
    addEvent, 
    setConnectionStatus, 
    setLastEventId,
    lastEventId,
    currentState
  } = usePipelineStore();
  
  const eventSourceRef = useRef<EventSource | null>(null);

  useEffect(() => {
    // 1. Hydrate from IndexedDB on mount
    hydratePipelineStore();
  }, []);

  useEffect(() => {
    // Prevent reconnecting if completed or canceled
    if (['completed', 'canceled', 'failed'].includes(currentState)) {
      return;
    }

    // 2. Setup Resumable SSE Connection
    let url = `/api/sse/pipeline?scenario=${scenario}`;
    
    // In a real Resumable SSE we would pass Last-Event-ID header, 
    // but standard EventSource doesn't allow custom headers easily without polyfills.
    // Instead we can pass it as a query param if needed, or rely on browser's native Last-Event-ID if the connection drops.
    if (lastEventId) {
      url += `&lastEventId=${lastEventId}`;
    }

    eventSourceRef.current = new EventSource(url);
    setConnectionStatus('reconnecting');

    eventSourceRef.current.onopen = () => {
      setConnectionStatus('connected');
    };

    // Generic event handler (needs custom event types mapped by backend, or just listen to specific types)
    const handleEvent = (e: MessageEvent) => {
      if (e.lastEventId) {
        setLastEventId(e.lastEventId);
      }

      try {
        const data = JSON.parse(e.data);
        
        if (data.status === 'connected') return;
        if (data.status === 'done') {
          eventSourceRef.current?.close();
          setConnectionStatus('disconnected');
          return;
        }

        // It's a PipelineRealtimeEvent
        addEvent(data as PipelineRealtimeEvent);
      } catch (err) {
        console.error('Failed to parse SSE event', err);
      }
    };

    // Standard mapping based on backend event types
    eventSourceRef.current.addEventListener('pipeline.started', handleEvent);
    eventSourceRef.current.addEventListener('pipeline.semantic_analysis.started', handleEvent);
    eventSourceRef.current.addEventListener('pipeline.semantic_analysis.completed', handleEvent);
    eventSourceRef.current.addEventListener('pipeline.human_review.required', handleEvent);
    eventSourceRef.current.addEventListener('pipeline.duplicate_resolution.completed', handleEvent);
    eventSourceRef.current.addEventListener('pipeline.progress.updated', handleEvent);
    eventSourceRef.current.addEventListener('pipeline.completed', handleEvent);
    eventSourceRef.current.addEventListener('pipeline.canceled', handleEvent);
    eventSourceRef.current.addEventListener('error', (e: any) => {
      console.log('SSE connection error, attempting reconnect...', e);
      setConnectionStatus('reconnecting');
    });

    return () => {
      eventSourceRef.current?.close();
      setConnectionStatus('disconnected');
    };
  }, [scenario, lastEventId, currentState, addEvent, setConnectionStatus, setLastEventId]);

  return {
    stopStream: () => {
      eventSourceRef.current?.close();
      setConnectionStatus('disconnected');
    }
  };
}
