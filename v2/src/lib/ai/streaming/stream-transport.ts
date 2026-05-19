import * as Ably from 'ably';
import { StreamTransport, StreamEventType, StreamEvent } from './types';
import { getSharedAblyClient } from '@/hooks/use-realtime-subscription';

export class AblyStreamTransport implements StreamTransport {
  private client: Ably.Realtime | null = null;
  private channel: Ably.RealtimeChannel | null = null;
  private handlers: Map<StreamEventType, Set<(event: any) => void>> = new Map();
  private boundMessageHandler: (message: Ably.Message) => void;

  constructor(private tenantId: string) {
    this.boundMessageHandler = this.handleAblyMessage.bind(this);
  }

  async connect(channelId: string): Promise<void> {
    this.client = getSharedAblyClient(this.tenantId);
    if (!this.client) throw new Error('Failed to initialize Ably client');
    
    this.channel = this.client.channels.get(channelId);
    
    // Using Ably's subscribe, we listen to all stream events
    await this.channel.subscribe('ai.stream.started', this.boundMessageHandler);
    await this.channel.subscribe('ai.stream.delta', this.boundMessageHandler);
    await this.channel.subscribe('ai.stream.completed', this.boundMessageHandler);
    await this.channel.subscribe('ai.stream.interrupted', this.boundMessageHandler);
    await this.channel.subscribe('ai.stream.failed', this.boundMessageHandler);
  }

  disconnect(): void {
    if (this.channel) {
      this.channel.unsubscribe('ai.stream.started', this.boundMessageHandler);
      this.channel.unsubscribe('ai.stream.delta', this.boundMessageHandler);
      this.channel.unsubscribe('ai.stream.completed', this.boundMessageHandler);
      this.channel.unsubscribe('ai.stream.interrupted', this.boundMessageHandler);
      this.channel.unsubscribe('ai.stream.failed', this.boundMessageHandler);
    }
    this.handlers.clear();
  }

  on(event: StreamEventType, handler: (event: any) => void): void {
    if (!this.handlers.has(event)) {
      this.handlers.set(event, new Set());
    }
    this.handlers.get(event)!.add(handler);
  }

  off(event: StreamEventType, handler: (event: any) => void): void {
    if (this.handlers.has(event)) {
      this.handlers.get(event)!.delete(handler);
    }
  }

  private handleAblyMessage(message: Ably.Message) {
    const eventType = message.name as StreamEventType;
    const handlers = this.handlers.get(eventType);
    
    if (handlers && handlers.size > 0) {
      // Reconstruct the StreamEvent
      const streamEvent: StreamEvent = {
        type: eventType,
        streamId: message.data?.streamId,
        timestamp: message.timestamp || Date.now(),
        payload: message.data?.payload
      };
      
      handlers.forEach(h => h(streamEvent));
    }
  }
}
