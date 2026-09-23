// Runs `next dev` / `next start` with PANEL_PORT (default 3000), the way that
// works on every shell. `--port ${PANEL_PORT:-3000}` in a package.json script is
// bash syntax: pnpm runs scripts through cmd.exe on Windows, which passes the
// literal string through instead of expanding it.
//
// Used by: apps/panel/package.json  (dev, start)
import { spawn } from 'node:child_process'

const port = process.env.PANEL_PORT || '3000'
const [, , ...command] = process.argv

const child = spawn(command[0], [...command.slice(1), '--port', port], {
  stdio: 'inherit',
  shell: true,
})

child.on('exit', (code) => process.exit(code ?? 0))
