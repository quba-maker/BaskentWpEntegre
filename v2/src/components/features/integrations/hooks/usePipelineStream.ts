import { useEffect, useRef } from 'react';
import { usePipelineStore, hydratePipelineStore } from '../store/pipelineStore';
import { PipelineRealtimeEvent } from '@/lib/core/events/pipeline-events';

const MAX_RECONNECT_ATTEMPTS = 5;
const BASE_RECONNECT_DELAY_MS = 1000;

export function usePipelineStream(scenario: 'normal' | 'review_needed' = 'normal') {
  const { 
    addEvent, 
    setConnectionStatus, 
    setLastEventId,
    lastEventId,
    currentState
  } = usePipelineStore();
  
  const eventSourceRef = useRef<EventSource | null>(null);
  const reconnectAttemptRef = useRef(0);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    // 1. Hydrate from IndexedDB on mount with conflict resolution / version check
    hydratePipelineStore();
  }, []);

  useEffect(() => {
    // Prevent reconnecting if completed or canceled
    if (['completed', 'canceled', 'failed'].includes(currentState)) {
      return;
    }

    const connect = () => {
      // Clear any pending reconnects
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
      }

      let url = `/api/sse/pipeline?scenario=${scenario}`;
      if (lastEventId) {
        url += `&lastEventId=${lastEventId}`;
      }

      eventSourceRef.current = new EventSource(url);
      setConnectionStatus('reconnecting');

      eventSourceRef.current.onopen = () => {
        setConnectionStatus('connected');
        reconnectAttemptRef.current = 0; // Reset backoff on successful connection
      };

      const handleEvent = (e: MessageEvent) => {
        if (e.lastEventId) {
          setLastEventId(e.lastEventId);
        }

        try {
          const data = JSON.parse(e.data);
          
          if (data.status === 'connected' || data.status === 'ping') return;
          if (data.status === 'done') {
            eventSourceRef.current?.close();
            setConnectionStatus('disconnected');
            return;
          }

          // Pass strictly typed event to the store
          addEvent(data as PipelineRealtimeEvent);
        } catch (err) {
          console.error('[SSE] Failed to parse event payload', err);
        }
      };

      eventSourceRef.current.addEventListener('pipeline.started', handleEvent);
      eventSourceRef.current.addEventListener('pipeline.semantic_analysis.started', handleEvent);
      eventSourceRef.current.addEventListener('pipeline.semantic_analysis.completed', handleEvent);
      eventSourceRef.current.addEventListener('pipeline.human_review.required', handleEvent);
      eventSourceRef.current.addEventListener('pipeline.duplicate_resolution.completed', handleEvent);
      eventSourceRef.current.addEventListener('pipeline.progress.updated', handleEvent);
      eventSourceRef.current.addEventListener('pipeline.completed', handleEvent);
      eventSourceRef.current.addEventListener('pipeline.canceled', handleEvent);
      eventSourceRef.current.addEventListener('ping', handleEvent);

      eventSourceRef.current.addEventListener('error', (e: any) => {
        console.warn(`[SSE] Connection error. Attempt ${reconnectAttemptRef.current + 1} of ${MAX_RECONNECT_ATTEMPTS}`);
        eventSourceRef.current?.close();
        setConnectionStatus('reconnecting');

        if (reconnectAttemptRef.current < MAX_RECONNECT_ATTEMPTS) {
          const delay = BASE_RECONNECT_DELAY_MS * Math.pow(2, reconnectAttemptRef.current);
          reconnectAttemptRef.current++;
          console.log(`[SSE] Reconnecting in ${delay}ms...`);
          reconnectTimeoutRef.current = setTimeout(connect, delay);
        } else {
          console.error('[SSE] Max reconnect attempts reached. Giving up.');
          setConnectionStatus('disconnected');
        }
      });
    };

    connect();

    return () => {
      if (reconnectTimeoutRef.current) clearTimeout(reconnectTimeoutRef.current);
      eventSourceRef.current?.close();
      setConnectionStatus('disconnected');
    };
  }, [scenario, lastEventId, currentState, addEvent, setConnectionStatus, setLastEventId]);

  return {
    stopStream: () => {
      if (reconnectTimeoutRef.current) clearTimeout(reconnectTimeoutRef.current);
      eventSourceRef.current?.close();
      setConnectionStatus('disconnected');
    }
  };
}
