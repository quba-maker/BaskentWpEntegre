import { AsyncLocalStorage } from 'async_hooks';

export interface TraceContext {
  traceId: string;
  tenantId?: string;
  spanId?: string;
}

/**
 * 🕵️‍♂️ Distributed Trace Context
 * Node.js AsyncLocalStorage kullanarak traceId'yi tüm request yaşam döngüsünde
 * (webhook -> classifier -> workflow -> AI -> db -> queue) 
 * prop-drilling yapmadan taşır.
 */
export const traceStorage = new AsyncLocalStorage<TraceContext>();

export function getTraceContext(): TraceContext | undefined {
  return traceStorage.getStore();
}

export function runWithTrace<T>(context: TraceContext, fn: () => T): T {
  return traceStorage.run(context, fn);
}

/**
 * Trace ID üretimi
 */
export function generateTraceId(): string {
  return crypto.randomUUID();
}
