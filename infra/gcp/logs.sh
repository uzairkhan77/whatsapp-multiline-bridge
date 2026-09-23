#!/usr/bin/env bash
# Read the VM's container logs from here — no separate SSH step.
#
# The full command is `sudo docker compose -f /opt/wa/infra/gcp/compose.yaml
# --env-file /opt/wa/.env logs …`, which is too long to retype and too easy to
# get subtly wrong: dropping --env-file leaves ${WA_BRIDGE_HOST} unset and
# Compose answers with a warning rather than the logs you asked for.
#
# Usage:
#   infra/gcp/logs.sh                  follow the bridge (the usual one)
#   infra/gcp/logs.sh evolution        follow the gateway
#   infra/gcp/logs.sh caddy            follow the web front door
#   infra/gcp/logs.sh all              follow all three
#   infra/gcp/logs.sh bridge 200       last 200 lines, then follow
#   infra/gcp/logs.sh bridge 200 no    last 200 lines and exit
#
# Alerts about a WhatsApp line all start with ALERT, so the whole story of an
# outage is:  infra/gcp/logs.sh bridge 2000 no | grep ALERT

set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

SERVICE="${1:-bridge}"
TAIL="${2:-100}"
FOLLOW="${3:-yes}"

# `all` means every service, which Compose expresses by naming none.
[ "${SERVICE}" = "all" ] && SERVICE=""
[ "${FOLLOW}" = "no" ] && FOLLOW_FLAG="" || FOLLOW_FLAG="-f"

# Quoted as one string: ssh.sh passes "$*" to the remote shell, so the whole
# pipeline has to arrive as a single argument.
"${HERE}/ssh.sh" "sudo docker compose \
  -f /opt/wa/infra/gcp/compose.yaml \
  --env-file /opt/wa/.env \
  logs ${FOLLOW_FLAG} --tail ${TAIL} ${SERVICE}"
