export type LogLevel = 'silent' | 'error' | 'warn' | 'info' | 'debug';

type ConsoleMethod = 'error' | 'warn' | 'info' | 'log';

const LEVEL_ORDER: Record<LogLevel, number> = {
  silent: 0,
  error: 1,
  warn: 2,
  info: 3,
  debug: 4,
};

function parseLogLevel(value: unknown): LogLevel | null {
  if (typeof value !== 'string') {
    return null;
  }

  const normalized = value.trim().toLowerCase();
  if (normalized === 'silent' || normalized === 'error' || normalized === 'warn' || normalized === 'info' || normalized === 'debug') {
    return normalized;
  }

  return null;
}

function getGlobalLogLevel(): LogLevel {
  const envLevel = parseLogLevel(import.meta.env.VITE_LOG_LEVEL);
  if (envLevel) {
    return envLevel;
  }

  return import.meta.env.DEV ? 'info' : 'warn';
}

const GLOBAL_LOG_LEVEL = getGlobalLogLevel();

function write(method: ConsoleMethod, namespace: string, message: string, args: unknown[]): void {
  const prefix = `[${namespace}] ${message}`;
  if (method === 'error') {
    console.error(prefix, ...args);
  } else if (method === 'warn') {
    console.warn(prefix, ...args);
  } else if (method === 'info') {
    console.info(prefix, ...args);
  } else {
    console.log(prefix, ...args);
  }
}

export interface Logger {
  error: (message: string, ...args: unknown[]) => void;
  warn: (message: string, ...args: unknown[]) => void;
  info: (message: string, ...args: unknown[]) => void;
  debug: (message: string, ...args: unknown[]) => void;
  isDebugEnabled: () => boolean;
}

export function createLogger(namespace: string): Logger {
  const canLog = (level: LogLevel): boolean => LEVEL_ORDER[level] <= LEVEL_ORDER[GLOBAL_LOG_LEVEL];

  return {
    error(message: string, ...args: unknown[]) {
      if (!canLog('error')) return;
      write('error', namespace, message, args);
    },
    warn(message: string, ...args: unknown[]) {
      if (!canLog('warn')) return;
      write('warn', namespace, message, args);
    },
    info(message: string, ...args: unknown[]) {
      if (!canLog('info')) return;
      write('info', namespace, message, args);
    },
    debug(message: string, ...args: unknown[]) {
      if (!canLog('debug')) return;
      write('log', namespace, message, args);
    },
    isDebugEnabled(): boolean {
      return canLog('debug');
    },
  };
}
