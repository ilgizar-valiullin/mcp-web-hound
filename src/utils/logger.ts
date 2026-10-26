import pino from 'pino';
import { config } from './config.js';

export const logger = pino({
  level: config.LOG_LEVEL,
  // Model worker must never write stdout: with fork stdio it is ignored, but
  // defensively route to stderr anyway (MCP JSON-RPC lives on fd 1).
  transport: process.env.MCP_WORKER === '1'
    ? { target: 'pino/file', options: { destination: 2 } }
    : process.env.NODE_ENV === 'development'
      ? { target: 'pino/file', options: { destination: 1 } }
      : undefined,
  formatters: {
    level: (label) => ({ level: label }),
  },
  serializers: {
    err: pino.stdSerializers.err,
  },
});
