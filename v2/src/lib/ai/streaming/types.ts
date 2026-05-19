export type StreamingState = 
  | 'idle' 
  | 'thinking' 
  | 'streaming' 
  | 'completed' 
  | 'interrupted' 
  | 'failed';

export interface StreamMetrics {
  traceId: string;
  streamId: string;
  firstTokenLatencyMs: number | null;
  completionLatencyMs: number | null;
  tokensPerSecond: number;
  totalTokens: number;
  interruptedReason?: 'user_interrupted' | 'connection_lost' | 'provider_timeout' | 'channel_switched' | string;
  startedAt: number;
}

export type StreamEventType = 
  | 'ai.stream.started'
  | 'ai.stream.delta'
  | 'ai.stream.completed'
  | 'ai.stream.interrupted'
  | 'ai.stream.failed';

export interface StreamEvent {
  type: StreamEventType;
  streamId: string;
  timestamp: number;
  payload?: any;
}

export interface StreamStartedEvent extends StreamEvent {
  type: 'ai.stream.started';
  payload: {
    traceId: string;
  };
}

export interface StreamDeltaEvent extends StreamEvent {
  type: 'ai.stream.delta';
  payload: {
    chunk: string;
  };
}

export interface StreamCompletedEvent extends StreamEvent {
  type: 'ai.stream.completed';
  payload: {
    fullContent: string;
    metrics: Partial<StreamMetrics>;
  };
}

export interface StreamInterruptedEvent extends StreamEvent {
  type: 'ai.stream.interrupted';
  payload: {
    reason: string;
    partialContent: string;
  };
}

export interface StreamFailedEvent extends StreamEvent {
  type: 'ai.stream.failed';
  payload: {
    error: string;
    partialContent: string;
  };
}

export interface StreamTransport {
  connect(channelId: string): Promise<void>;
  disconnect(): void;
  on(event: StreamEventType, handler: (event: any) => void): void;
  off(event: StreamEventType, handler: (event: any) => void): void;
}
