import { pino, type Logger } from 'pino';

let logger: Logger | undefined;

/** Lazily create and cache the application logger. */
export function getLogger(): Logger {
  if (logger) {
    return logger;
  }
  const level = process.env.LOG_LEVEL ?? 'info';
  logger = pino({
    level,
    transport:
      process.env.NODE_ENV === 'production'
        ? undefined
        : {
            target: 'pino-pretty',
            options: { colorize: true, translateTime: 'SYS:HH:MM:ss' },
          },
  });
  return logger;
}

/** Reset the logger cache (used in tests). */
export function resetLogger(): void {
  logger = undefined;
}
