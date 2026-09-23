#!/usr/bin/env bash
# Start, stop and inspect the local Evolution API process.
#
# Local development only — on the VPS this is a Docker Compose service behind
# Caddy. Uses a pidfile rather than pattern-matching the process list, because
# a `pkill -f main.ts` also matches the shell that issued it.
#
# Usage: infra/local/evolution.sh {start|stop|restart|status|logs}

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
APP="${ROOT}/vendor/evolution-api"
RUN="${ROOT}/.tmp"
PIDFILE="${RUN}/evolution.pid"
LOGFILE="${RUN}/evolution.log"

mkdir -p "${RUN}"

running() {
  [ -f "${PIDFILE}" ] || return 1
  local pid
  pid="$(cat "${PIDFILE}")"
  [ -n "${pid}" ] && kill -0 "${pid}" 2>/dev/null
}

port() {
  grep -E '^SERVER_PORT=' "${ROOT}/infra/local/evolution.env" 2>/dev/null | cut -d= -f2 || echo 8080
}

# Every real Evolution server, by pid, however it was started. Two filters, because
# either one alone is wrong:
#
#   the loader on the command line   one server is a chain of four — setsid sh,
#                                    sh -c tsx, the tsx launcher, then node. Only
#                                    the last carries tsx's loader, so this counts
#                                    servers rather than wrappers.
#   the working directory            the bridge also runs under tsx and so carries
#                                    the same loader. It does not run from the
#                                    gateway's directory; every Evolution server
#                                    does.
#   the program is node              a shell issuing this search carries the
#                                    pattern on its own command line, and if it
#                                    was started from the gateway's directory the
#                                    first two filters both pass. It is bash, not
#                                    node.
#
# Matching on the loader alone reported three servers whenever the bridge was up.
# A duplicate warning that fires in normal operation is one that gets ignored,
# which costs more than not having it.
#
# Returns 0 even when nothing matches: under `set -e` a non-zero exit from the
# last loop iteration would abort the caller's assignment, and "no servers" is a
# normal answer, not a failure.
server_pids() {
  local pid cwd exe
  for pid in $(pgrep -f 'tsx/dist/loader.mjs' 2>/dev/null); do
    cwd="$(readlink "/proc/${pid}/cwd" 2>/dev/null || true)"
    exe="$(readlink "/proc/${pid}/exe" 2>/dev/null || true)"
    if [ "${cwd}" = "${APP}" ] && [ "$(basename "${exe:-}")" = "node" ]; then
      echo "${pid}"
    fi
  done
  return 0
}

case "${1:-}" in
  start)
    if running; then
      echo "already running (pid $(cat "${PIDFILE}"))"
      exit 0
    fi
    [ -d "${APP}/node_modules" ] || { echo "run: (cd vendor/evolution-api && npm install)" >&2; exit 1; }
    [ -e "${APP}/.env" ] || { echo "missing vendor/evolution-api/.env symlink — see docs/01-evolution.md" >&2; exit 1; }
    # A stale pidfile must never let a second server start. Two Evolution processes
    # load the same instances from the same database and open a second WhatsApp
    # socket on one session; WhatsApp allows only one, so they kick each other off
    # in a loop — the connection flaps and pre-key uploads fail. The port is the
    # authority here, not the pidfile.
    if ss -ltn 2>/dev/null | grep -q ":$(port)\b"; then
      echo "port $(port) already in use — another Evolution is running." >&2
      echo "find it with: pgrep -af 'main.ts'" >&2
      exit 1
    fi
    # setsid forks when it is not already a process group leader, so $! would name
    # the parent that exits immediately, leaving a dead pid in the pidfile. Have the
    # shell record its own pid — which is the process group leader — and then exec
    # into npm, so the recorded pid stays valid for the whole life of the server.
    ( cd "${APP}" && setsid sh -c 'echo $$ > "$1"; exec npm run start' _ "${PIDFILE}" \
        > "${LOGFILE}" 2>&1 < /dev/null & )
    for _ in $(seq 20); do [ -s "${PIDFILE}" ] && break; done
    echo "starting (pid $(cat "${PIDFILE}" 2>/dev/null)), logs: ${LOGFILE}"
    ;;

  stop)
    if ! running; then
      echo "not running"
      rm -f "${PIDFILE}"
      exit 0
    fi
    pid="$(cat "${PIDFILE}")"
    # Kill the whole process group: npm spawns tsx, which spawns the server.
    kill -TERM -- "-${pid}" 2>/dev/null || kill -TERM "${pid}" 2>/dev/null || true
    for _ in $(seq 20); do
      running || break
      sleep 0.5
    done
    running && kill -KILL -- "-${pid}" 2>/dev/null || true
    rm -f "${PIDFILE}"
    echo "stopped"
    ;;

  restart)
    "$0" stop
    "$0" start
    ;;

  status)
    # Count real servers regardless of the pidfile. More than one means two sockets
    # on one WhatsApp session, which shows up as a flapping connection rather than
    # as an obvious failure, so it is worth saying loudly.
    pids="$(server_pids)"
    count="$(printf '%s' "${pids}" | grep -c . || true)"
    if [ "${count}" -gt 1 ]; then
      echo "WARNING: ${count} Evolution processes running — one session, several sockets."
      echo "         the connection will flap until all but one are stopped:"
      # shellcheck disable=SC2086
      ps -o pid=,lstart=,args= -p ${pids} | cut -c1-160 | sed 's/^/           /'
    fi

    if running; then
      echo "running (pid $(cat "${PIDFILE}"))"
    elif ss -ltn 2>/dev/null | grep -q ":$(port)\b"; then
      # The pidfile is stale but something owns the port. Reporting "not running"
      # here is what invites a second start.
      echo "running, but not the process in the pidfile (stale pidfile)"
      # shellcheck disable=SC2086
      [ -n "${pids}" ] && ps -o pid=,lstart=,args= -p ${pids} | cut -c1-160 | sed 's/^/  /'
    else
      echo "not running"
      exit 1
    fi
    curl -sf "http://localhost:$(port)/" || echo "port $(port) not answering yet"
    echo
    ;;

  logs)
    tail -f "${LOGFILE}"
    ;;

  *)
    echo "usage: $0 {start|stop|restart|status|logs}" >&2
    exit 2
    ;;
esac
