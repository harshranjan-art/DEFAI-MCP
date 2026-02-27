import pino from 'pino';

// In MCP stdio mode, stdout is reserved for protocol messages.
// All logs MUST go to stderr.
const transport = pino.transport({
  target: 'pino-pretty',
  options: {
    destination: 2, // stderr (fd 2)
    colorize: true,
    translateTime: 'HH:MM:ss',
    ignore: 'pid,hostname',
  },
});

export const logger = pino({ level: 'info' }, transport);
