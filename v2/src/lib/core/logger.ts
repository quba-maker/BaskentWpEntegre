// ==========================================
// QUBA AI — Core Observability Logger
// Structured, traceable JSON logging system
// ==========================================

import { getTraceContext } from './trace-context';

export type LogLevel = 'info' | 'warn' | 'error' | 'debug';

export interface LogContext {
  tenantId?: string;
  userId?: string;
  action?: string;
  module?: string;
  traceId?: string;
  [key: string]: any;
}

class SystemLogger {
  public baseContext: LogContext = {};

  // Request/Action bazlı sub-logger oluştur
  withContext(context: LogContext): SystemLogger {
    const logger = new SystemLogger();
    logger.baseContext = { ...this.baseContext, ...context };
    return logger;
  }

  private maskPII(text: string): string {
    if (typeof text !== 'string') return text;
    // Mask emails
    let masked = text.replace(/([a-zA-Z0-9._-]+@[a-zA-Z0-9._-]+\.[a-zA-Z0-9_-]+)/gi, '***@***.***');
    // Mask phones (Turkish and international variations)
    masked = masked.replace(/(?:\+|00|0)?[1-9][0-9 \-\(\)\.]{9,15}/g, '[MASKED_PHONE]');
    // Mask TC ID (11 digits)
    masked = masked.replace(/\b[1-9][0-9]{10}\b/g, '[MASKED_TC]');
    return masked;
  }

  private sanitizePayload(payload: any): any {
    const sanitized = { ...payload };
    
    // Truncate long messages to prevent DB/Log explosion
    if (sanitized.message && sanitized.message.length > 500) {
      sanitized.message = sanitized.message.substring(0, 500) + '...[TRUNCATED]';
    }

    // Mask PII in messages and context
    if (sanitized.message) sanitized.message = this.maskPII(sanitized.message);
    
    for (const key of Object.keys(sanitized)) {
      if (typeof sanitized[key] === 'string' && sanitized[key].length > 1000) {
        sanitized[key] = sanitized[key].substring(0, 1000) + '...[TRUNCATED]';
      }
      if (typeof sanitized[key] === 'string') {
        sanitized[key] = this.maskPII(sanitized[key]);
      }
    }
    return sanitized;
  }

  private log(level: LogLevel, message: string, context?: LogContext, error?: Error) {
    try {
      const traceCtx = getTraceContext();
      
      const rawPayload = {
        timestamp: new Date().toISOString(),
        level,
        message,
        traceId: traceCtx?.traceId || this.baseContext.traceId || context?.traceId,
        tenantId: traceCtx?.tenantId || this.baseContext.tenantId || context?.tenantId,
        ...this.baseContext,
        ...context,
        ...(error && { 
          error: {
            name: error.name,
            message: error.message,
            stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
          }
        })
      };

      const payload = this.sanitizePayload(rawPayload);

      // Fire and forget logging logic - no async/await here
      if (process.env.NODE_ENV === 'production') {
        console[level === 'error' ? 'error' : 'log'](JSON.stringify(payload));
      } else {
        const colors = {
          info: '\x1b[34m', // Blue
          warn: '\x1b[33m', // Yellow
          error: '\x1b[31m', // Red
          debug: '\x1b[32m', // Green
          reset: '\x1b[0m'
        };
        console[level === 'error' ? 'error' : 'log'](
          `${colors[level]}[${level.toUpperCase()}]${colors.reset} ${payload.message}`,
          Object.keys(payload).length > 3 ? payload : ''
        );
      }
    } catch (e) {
      // Gözlem katmanı çökerse ana sistemi durdurma
      console.error("CRITICAL: Logger crashed", e);
    }
  }

  info(message: string, context?: LogContext) { this.log('info', message, context); }
  warn(message: string, context?: LogContext) { this.log('warn', message, context); }
  error(message: string, error?: Error, context?: LogContext) { this.log('error', message, context, error); }
  debug(message: string, context?: LogContext) { 
    if (process.env.NODE_ENV !== 'production') this.log('debug', message, context); 
  }
}

export const logger = new SystemLogger();
