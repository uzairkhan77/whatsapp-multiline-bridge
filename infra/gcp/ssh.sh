#!/usr/bin/env bash
# SSH to the VM, or run a command on it.
#
# Wraps `gcloud compute ssh` so the project, account, zone and IAP tunnel do not
# have to be remembered or retyped. Port 22 is not open to the internet — the
# tunnel is the only way in — so plain `ssh <ip>` will hang, and that is intended.
#
# Usage:
#   infra/gcp/ssh.sh                      interactive shell
#   infra/gcp/ssh.sh 'docker compose ps'  run one command and exit

set -euo pipefail

# shellcheck source=infra/gcp/config.sh
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/config.sh"

# gcloud prints a four-line NumPy performance suggestion to stderr on every single
# tunnelled command. It is advice, not a problem, and it arrives even when the
# command itself produced nothing — which makes a successful `logs.sh … | grep`
# that simply found no matches look like a failure. Dropped by exact wording so
# any other warning still gets through; the bare `WARNING:` line is the header of
# this same message, and a real one always has text after the colon.
quiet_stderr() {
  grep -v -e 'consider installing NumPy' \
          -e 'using-tcp-forwarding#increasing_the_tcp_upload_bandwidth' \
          -e '^WARNING: *$' >&2 || true
}

# `gc` is a shell function, so it cannot be exec'd — call it and pass its exit
# status on, which is what a caller checking `if infra/gcp/ssh.sh ...` needs.
# Process substitution keeps stdout untouched, so piping this script's output
# still works; the exit status stays that of gcloud, not of the filter.
if [ "$#" -eq 0 ]; then
  gc compute ssh "${VM_NAME}" --zone="${GCP_ZONE}" --tunnel-through-iap 2> >(quiet_stderr)
  exit $?
fi

gc compute ssh "${VM_NAME}" --zone="${GCP_ZONE}" --tunnel-through-iap --command="$*" 2> >(quiet_stderr)
exit $?
