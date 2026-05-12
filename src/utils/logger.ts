import pino from 'pino';

// In MCP stdio mode, stdout is reserved for protocol messages.
// All logs MUST go to stderr (fd 2).
//
// Production: NDJSON to stderr (one structured event per line) — picked up
//   verbatim by docker logs / Loki / CloudWatch and indexed by field.
// Dev/test:   pino-pretty colorized to stderr — human-readable.

const isProd = process.env.NODE_ENV === 'production';
const level = process.env.LOG_LEVEL || 'info';

const transport = isProd
  ? undefined
  : pino.transport({
      target: 'pino-pretty',
      options: {
        destination: 2,
        colorize: true,
        translateTime: 'HH:MM:ss',
        ignore: 'pid,hostname',
      },
    });

export const logger = isProd
  // raw NDJSON; pino's default destination is stdout, override to stderr.
  ? pino({ level }, pino.destination({ dest: 2, sync: false }))
  : pino({ level }, transport);
