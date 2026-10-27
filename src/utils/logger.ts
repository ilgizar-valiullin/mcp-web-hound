import { config } from './config.js';

type Level = 'debug' | 'info' | 'warn' | 'error' | 'fatal';

const ORDER: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40, fatal: 50 };

function activeLevel(): number {
  try {
    return ORDER[config.LOG_LEVEL] ?? 20;
  } catch {
    return 20;
  }
}

function fmt(level: Level, arg1: unknown, arg2?: unknown): string {
  let obj: unknown;
  let msg: unknown;
  if (arg2 !== undefined) {
    obj = arg1;
    msg = arg2;
  } else if (typeof arg1 === 'string') {
    msg = arg1;
  } else {
    obj = arg1;
  }
  const parts: Record<string, unknown> = {
    level,
    time: Date.now(),
    pid: process.pid,
  };
  if (obj !== undefined) {
    if (obj instanceof Error) parts.err = { message: obj.message, stack: obj.stack };
    else if (typeof obj === 'object' && obj !== null) Object.assign(parts, obj as Record<string, unknown>);
    else parts.data = obj;
  }
  if (msg !== undefined) parts.msg = msg instanceof Error ? msg.message : String(msg);
  if (msg instanceof Error && !parts.err) parts.err = { message: msg.message, stack: msg.stack };
  let line: string;
  try {
    line = JSON.stringify(parts);
  } catch {
    line = JSON.stringify({ level, msg: String(msg) });
  }
  return line + '\n';
}

function write(line: string): void {
  // Hot worker must never write stdout: with fork stdio it is ignored, but
  // defensively route everything to stderr anyway (MCP JSON-RPC lives on fd 1).
  try {
    process.stderr.write(line);
  } catch {
    // stderr closed — nothing to do.
  }
}

function log(level: Level, arg1?: unknown, arg2?: unknown): void {
  if (ORDER[level] < activeLevel()) return;
  write(fmt(level, arg1, arg2));
  if (level === 'fatal') {
    // Mirror pino/fatal usage in main: callers exit explicitly; do not exit here
    // so the hot worker (which logs fatals before suicide) keeps its own flow.
  }
}

export const logger = {
  debug: (a?: unknown, b?: unknown): void => log('debug', a, b),
  info: (a?: unknown, b?: unknown): void => log('info', a, b),
  warn: (a?: unknown, b?: unknown): void => log('warn', a, b),
  error: (a?: unknown, b?: unknown): void => log('error', a, b),
  fatal: (a?: unknown, b?: unknown): void => log('fatal', a, b),
};
