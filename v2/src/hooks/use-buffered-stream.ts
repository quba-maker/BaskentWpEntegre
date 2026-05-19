import { useEffect, useRef, useState, useCallback } from 'react';
import { useStreamMachine, ActiveStream } from '@/lib/ai/streaming/stream-machine';
import { StreamTransport, StreamStartedEvent, StreamDeltaEvent, StreamCompletedEvent, StreamInterruptedEvent, StreamFailedEvent } from '@/lib/ai/streaming/types';
import { usePresenceStore } from '@/lib/realtime/presence-store';

export function useBufferedStream(
  tenantId: string,
  channelId: string, 
  transport: StreamTransport | null
) {
  const machine = useStreamMachine();
  const setTyping = usePresenceStore(state => state.setTyping);
  
  // Expose the currently active stream
  const activeStream = useStreamMachine((state) => state.activeStreams[channelId]);
  
  // Buffered content to prevent React render explosion on every token
  const [renderedContent, setRenderedContent] = useState('');
  
  // Refs for requestAnimationFrame coalescing
  const frameRef = useRef<number | null>(null);
  const bufferRef = useRef<string>('');
  
  // Update rendered content at max 60fps
  const flushBuffer = useCallback(() => {
    setRenderedContent(bufferRef.current);
    frameRef.current = null;
  }, []);

  const scheduleFlush = useCallback(() => {
    if (frameRef.current === null) {
      frameRef.current = requestAnimationFrame(flushBuffer);
    }
  }, [flushBuffer]);

  useEffect(() => {
    // If we transition to streaming, sync buffer to state
    if (activeStream && (activeStream.state === 'streaming' || activeStream.state === 'completed')) {
      bufferRef.current = activeStream.content;
      scheduleFlush();
    } else if (!activeStream || activeStream.state === 'idle' || activeStream.state === 'thinking') {
       bufferRef.current = '';
       scheduleFlush();
    }
  }, [activeStream?.content, activeStream?.state, scheduleFlush]);

  // Wire up the transport events to the state machine
  useEffect(() => {
    if (!transport || !channelId) return;

    let mounted = true;

    const connectAndListen = async () => {
      try {
        await transport.connect(channelId);
        if (!mounted) return;

        const onStarted = (event: StreamStartedEvent) => {
          machine.startThinking(channelId, event.streamId, event.payload.traceId);
          // Set presence to typing (AI mode) for the thinking phase
          setTyping(channelId, 'ai-system', true, 'ai');
        };

        const onDelta = (event: StreamDeltaEvent) => {
          // As soon as the first delta arrives, we ensure we're streaming and hide presence
          const stream = useStreamMachine.getState().activeStreams[channelId];
          if (stream && stream.state === 'thinking') {
             machine.startStreaming(channelId, event.streamId);
             setTyping(channelId, 'ai-system', false, 'ai'); // Clear typing indicator for zero-layout-shift
          }
          machine.appendDelta(channelId, event.streamId, event.payload.chunk);
        };

        const onCompleted = (event: StreamCompletedEvent) => {
          machine.completeStream(channelId, event.streamId);
          // Clean up presence just in case
          setTyping(channelId, 'ai-system', false, 'ai');
        };

        const onInterrupted = (event: StreamInterruptedEvent) => {
          machine.interruptStream(channelId, event.streamId, event.payload.reason);
          setTyping(channelId, 'ai-system', false, 'ai');
        };

        const onFailed = (event: StreamFailedEvent) => {
          machine.failStream(channelId, event.streamId, event.payload.error);
          setTyping(channelId, 'ai-system', false, 'ai');
        };

        transport.on('ai.stream.started', onStarted);
        transport.on('ai.stream.delta', onDelta);
        transport.on('ai.stream.completed', onCompleted);
        transport.on('ai.stream.interrupted', onInterrupted);
        transport.on('ai.stream.failed', onFailed);

      } catch (err) {
        console.error('Failed to connect stream transport', err);
      }
    };

    connectAndListen();

    return () => {
      mounted = false;
      transport.disconnect();
      if (frameRef.current) {
        cancelAnimationFrame(frameRef.current);
      }
    };
  }, [transport, channelId, setTyping]); // machine is stable, no need to include

  return {
    isStreaming: activeStream?.state === 'streaming' || activeStream?.state === 'thinking',
    state: activeStream?.state || 'idle',
    content: renderedContent,
    metrics: activeStream?.metrics,
  };
}
