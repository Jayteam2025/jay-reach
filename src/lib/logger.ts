/**
 * Centralized Logger with Sentry Integration
 *
 * Features:
 * - Environment-aware log levels (dev: all, prod: warn+error only)
 * - Automatic sanitization of sensitive data (tokens, passwords, etc.)
 * - Sentry integration for error tracking in production
 *
 * Usage:
 *   import { logger } from '@/lib/logger';
 *
 *   logger.debug('Debug message', { context: 'value' });
 *   logger.info('Info message', { userId: '123' });
 *   logger.warn('Warning message', { action: 'retry' });
 *   logger.error('Error message', error, { userId: '123' });
 */

// Sentry integration (optional - stub in OSS)
const Sentry = (() => {
  try {
    return require("@sentry/react");
  } catch {
    return {
      captureException: () => {},
      captureMessage: () => {},
      setUser: () => {},
      addBreadcrumb: () => {},
    };
  }
})();

type LogLevel = 'debug' | 'info' | 'warn' | 'error';
type LogContext = Record<string, unknown>;

const LEVELS: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

// In production, only log warnings and errors
const MIN_LEVEL: LogLevel = import.meta.env.PROD ? 'warn' : 'debug';

// Sensitive keys to mask in logs
const SENSITIVE_KEYS = [
  'token',
  'access_token',
  'refresh_token',
  'id_token',
  'password',
  'secret',
  'apikey',
  'api_key',
  'authorization',
  'credential',
  'private',
  'bearer',
];

/**
 * Recursively sanitize an object by masking sensitive values
 */
function sanitize<T extends LogContext>(obj: T): T {
  if (!obj || typeof obj !== 'object') return obj;

  // Handle arrays
  if (Array.isArray(obj)) {
    return obj.map(item =>
      typeof item === 'object' && item !== null ? sanitize(item as LogContext) : item
    ) as unknown as T;
  }

  return Object.fromEntries(
    Object.entries(obj).map(([key, value]) => {
      // Don't mask null or undefined values
      if (value === null || value === undefined) {
        return [key, value];
      }

      // Check if key contains sensitive patterns
      const isSensitive = SENSITIVE_KEYS.some(sk =>
        key.toLowerCase().includes(sk)
      );

      if (isSensitive && typeof value === 'string') {
        return [key, '***MASKED***'];
      }

      // Recursively sanitize nested objects (including arrays)
      if (typeof value === 'object' && value !== null) {
        if (Array.isArray(value)) {
          return [key, value.map(item =>
            typeof item === 'object' && item !== null ? sanitize(item as LogContext) : item
          )];
        }
        return [key, sanitize(value as LogContext)];
      }

      return [key, value];
    })
  ) as T;
}

/**
 * Check if a log level should be displayed based on environment
 */
function shouldLog(level: LogLevel): boolean {
  return LEVELS[level] >= LEVELS[MIN_LEVEL];
}

/**
 * Format log message with level prefix
 */
function formatMessage(level: LogLevel, msg: string): string {
  const timestamp = new Date().toISOString();
  if (import.meta.env.DEV) {
    // In dev, include timestamp for debugging
    return `[${timestamp}] [${level.toUpperCase()}] ${msg}`;
  }
  return `[${level.toUpperCase()}] ${msg}`;
}

/**
 * Centralized logger with Sentry integration
 */
export const logger = {
  /**
   * Debug level - development only
   * Use for detailed debugging information
   */
  debug(msg: string, context?: LogContext): void {
    if (!shouldLog('debug')) return;
    const sanitizedContext = context ? sanitize(context) : undefined;
    if (sanitizedContext) {
      console.debug(formatMessage('debug', msg), sanitizedContext);
    } else {
      console.debug(formatMessage('debug', msg));
    }
  },

  /**
   * Info level - development only
   * Use for general informational messages
   */
  info(msg: string, context?: LogContext): void {
    if (!shouldLog('info')) return;
    const sanitizedContext = context ? sanitize(context) : undefined;
    if (sanitizedContext) {
      console.info(formatMessage('info', msg), sanitizedContext);
    } else {
      console.info(formatMessage('info', msg));
    }
  },

  /**
   * Warn level - development and production
   * Use for potentially problematic situations
   */
  warn(msg: string, context?: LogContext): void {
    if (!shouldLog('warn')) return;
    const sanitizedContext = context ? sanitize(context) : undefined;
    if (sanitizedContext) {
      console.warn(formatMessage('warn', msg), sanitizedContext);
    } else {
      console.warn(formatMessage('warn', msg));
    }
  },

  /**
   * Error level - development and production + Sentry
   * Use for error conditions that should be tracked
   */
  error(msg: string, error?: Error | unknown, context?: LogContext): void {
    if (!shouldLog('error')) return;

    const sanitizedContext = context ? sanitize(context) : {};

    // Log to console
    if (error) {
      console.error(formatMessage('error', msg), error, sanitizedContext);
    } else {
      console.error(formatMessage('error', msg), sanitizedContext);
    }

    // Send to Sentry in production
    if (import.meta.env.PROD) {
      if (error instanceof Error) {
        Sentry.captureException(error, {
          extra: { message: msg, ...sanitizedContext },
        });
      } else if (error) {
        // If error is not an Error instance, capture as message with context
        Sentry.captureMessage(msg, {
          level: 'error',
          extra: { originalError: String(error), ...sanitizedContext },
        });
      } else {
        // No error object, just capture the message
        Sentry.captureMessage(msg, {
          level: 'error',
          extra: sanitizedContext,
        });
      }
    }
  },

  /**
   * Set user context for Sentry (call after login)
   */
  setUser(user: { id: string; email?: string; username?: string } | null): void {
    if (import.meta.env.PROD) {
      Sentry.setUser(user);
    }
  },

  /**
   * Add breadcrumb for debugging context
   */
  addBreadcrumb(message: string, category?: string, data?: LogContext): void {
    if (import.meta.env.PROD) {
      Sentry.addBreadcrumb({
        message,
        category: category || 'app',
        data: data ? sanitize(data) : undefined,
        level: 'info',
      });
    }
  },
};

// Export sanitize for testing
export { sanitize };

export default logger;
