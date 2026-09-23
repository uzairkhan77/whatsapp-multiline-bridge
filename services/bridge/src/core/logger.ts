// Fastify/pino logger options. Human-readable lines by default, since the logs
// are read by eye through `docker compose logs`; `LOG_FORMAT=json` switches to
// one JSON object per line for anything that parses them.

// framework
import type { FastifyServerOptions } from 'fastify'

export function loggerOptions(): FastifyServerOptions['logger'] {
  const level = process.env.LOG_LEVEL?.toLowerCase() ?? 'info'

  if (process.env.LOG_FORMAT?.toLowerCase() === 'json') {
    return { level }
  }

  return {
    level,
    transport: {
      target: 'pino-pretty',
      options: {
        // 14:32:07 rather than 1788354264390.
        translateTime: 'SYS:HH:MM:ss',
        // pid and hostname are the same on every line of a single-container
        // service; reqId only matters when correlating, and requests are one line each.
        ignore: 'pid,hostname,reqId',
        // One event is one line, structured context included.
        singleLine: true,
        // On by default for the terminal; LOG_COLOR=false turns it off for
        // anything that parses Docker's log files, which otherwise hold escape codes.
        colorize: process.env.LOG_COLOR?.toLowerCase() !== 'false',
        // Green for ordinary progress, yellow for worth noticing, red for wrong.
        customColors: 'fatal:bgRed,error:red,warn:yellow,info:green,debug:blue,trace:gray',
        // Level before the clock: the eye scans the left edge for red first.
        levelFirst: true,
      },
    },
  }
}
