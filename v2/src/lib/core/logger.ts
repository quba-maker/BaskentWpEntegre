// ==========================================
// QUBA AI — Core Observability Logger
// Structured, traceable JSON logging system
// ==========================================

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
  private baseContext: LogContext = {};

  // Request/Action bazlı sub-logger oluştur
  withContext(context: LogContext): SystemLogger {
    const logger = new SystemLogger();
    logger.baseContext = { ...this.baseContext, ...context };
    return logger;
  }

  private log(level: LogLevel, message: string, context?: LogContext, error?: Error) {
    const payload = {
      timestamp: new Date().toISOString(),
      level,
      message,
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

    // Vercel / Production'da JSON stringify ile formatla, dev ortamda okunaklı bas
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
        `${colors[level]}[${level.toUpperCase()}]${colors.reset} ${message}`,
        Object.keys(payload).length > 3 ? payload : '' // Sadece ekstra context varsa yazdır
      );
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
