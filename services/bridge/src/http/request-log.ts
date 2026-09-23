// framework
import type { FastifyInstance } from 'fastify'

// One line per request: POST /webhooks/evolution/line-test-02 → 200 (8ms).
// A failing response logs at warn so it stands out; /health is skipped, since Docker
// probes it every 30 seconds. A failing probe still surfaces as the error it raises.
export function logEachRequest(app: FastifyInstance): void {
  app.addHook('onResponse', (request, reply, done) => {
    if (request.url !== '/health') {
      const line = `${request.method} ${request.url} → ${reply.statusCode} (${Math.round(reply.elapsedTime)}ms)`
      if (reply.statusCode >= 400) request.log.warn(line)
      else request.log.info(line)
    }
    done()
  })
}
