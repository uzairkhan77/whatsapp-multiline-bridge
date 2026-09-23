// framework
import type { FastifyInstance } from 'fastify'

// storage
import type { Db } from '../storage/db.js'

// Not logged on success (see request-log.ts): Docker probes this every 30 seconds.
// Answers "ok" and nothing else — no list of lines or inbox ids, since the address is
// guessable (sslip.io hostnames derive from the VM's IP) and the Operator Console has that list behind a login.
export function registerHealth(app: FastifyInstance, db: Db): void {
  app.get('/health', async () => {
    await db.pool.query('select 1')
    return { status: 'ok' }
  })
}
