// The bridge's own Postgres connection. Holds identifiers only, never message
// content: Chatwoot is the system of record. Tables are created in schema.ts.

// framework
import pg from 'pg'

const { Pool } = pg

export interface Db {
  pool: pg.Pool
  close(): Promise<void>
}

export function createDb(databaseUrl: string): Db {
  // Pooler flags (connection_limit, pgbouncer) belong in the URL, not here.
  const pool = new Pool({ connectionString: databaseUrl, max: 10 })
  return {
    pool,
    close: () => pool.end(),
  }
}
