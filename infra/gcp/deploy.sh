#!/usr/bin/env bash
# Deploy the stack to the Compute Engine VM.
#
# Ships the two files Compose needs, pulls the bridge image and starts the
# containers. The image is built by GitHub Actions on every push to main
# (.github/workflows/bridge-image.yml) — not here and not on the VM. It used to
# be built on the VM; an e2-small compiling TypeScript next to a live WhatsApp
# gateway was the one step of a deploy that could run out of memory, and it
# made every deploy several minutes of the machine's full attention.
#
# Building is automatic; deploying is this script, run by a person. Nothing
# reaches the VM until somebody decides to send it.
#
# Idempotent, and safe to re-run: Compose recreates only what changed.
#
# Usage:
#   infra/gcp/deploy.sh                    pull `latest` and start
#   infra/gcp/deploy.sh --tag sha-abc1234  pull that build instead — a rollback
#                                          is deploying the tag that worked

set -euo pipefail

# shellcheck source=infra/gcp/config.sh
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/config.sh"

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
REMOTE_DIR="/opt/wa"
# No --project-directory. Compose resolves every relative path in a compose file
# against the project directory, which defaults to the directory the compose file
# is in — and compose.yaml's paths (../../.env, context ../.., ./Caddyfile) are all
# written relative to infra/gcp/. Passing --project-directory /opt/wa moves that
# origin and silently breaks all three at once: ../../.env becomes /.env.
#
# --env-file is a different thing from the `env_file:` entries inside the compose
# file, and both are needed. `env_file:` hands variables to a container at run
# time. --env-file supplies the values Compose substitutes into ${...} while
# reading the file itself — it reads only the project directory's .env by default,
# which is infra/gcp/, where there is none. Without this, ${WA_BRIDGE_HOST}
# expands to an empty string and the bridge registers its webhooks at "https://".
COMPOSE="sudo docker compose -f ${REMOTE_DIR}/infra/gcp/compose.yaml --env-file ${REMOTE_DIR}/.env"

# Which build to run. Empty means whatever `latest` points at.
IMAGE_TAG=""
if [ "${1:-}" = "--tag" ]; then
  IMAGE_TAG="${2:?--tag needs a value, e.g. sha-abc1234}"
elif [ -n "${1:-}" ]; then
  echo "Unknown option: ${1}. Usage: deploy.sh [--tag <image tag>]" >&2
  exit 1
fi
# Set in the remote shell so it wins over anything /opt/wa/.env might say — a
# shell variable beats --env-file when Compose substitutes ${BRIDGE_IMAGE_TAG}.
TAG_ENV=""
[ -n "${IMAGE_TAG}" ] && TAG_ENV="BRIDGE_IMAGE_TAG=${IMAGE_TAG} "

# `sudo docker` throughout rather than adding the login user to the docker group.
# Group membership only takes effect on a new login session, so a script that adds
# the group and then uses it fails the first time and works the second — the kind
# of intermittent behaviour that wastes an afternoon.
remote() { bash "$(dirname "${BASH_SOURCE[0]}")/ssh.sh" "$@"; }

# ─────────────────────────────────────────────────────────────────────────────
say "Preflight"
# ─────────────────────────────────────────────────────────────────────────────
STATUS="$(gc compute instances describe "${VM_NAME}" --zone="${GCP_ZONE}" \
  --format='value(status)' 2>/dev/null || true)"
if [ "${STATUS}" != "RUNNING" ]; then
  echo "VM ${VM_NAME} is ${STATUS:-absent}, not RUNNING. Run infra/gcp/provision.sh first." >&2
  exit 1
fi
skip "${VM_NAME} is running"

# ─────────────────────────────────────────────────────────────────────────────
say "Packing"
# ─────────────────────────────────────────────────────────────────────────────
# Only what Compose reads on the VM. No source: the bridge arrives as an image.
STAGE="$(mktemp -d)"
trap 'rm -rf "${STAGE}"' EXIT
TARBALL="${STAGE}/wa-deploy.tar.gz"

tar -czf "${TARBALL}" -C "${ROOT}" \
  infra/gcp/compose.yaml \
  infra/gcp/Caddyfile
skip "$(du -h "${TARBALL}" | cut -f1)"

# ─────────────────────────────────────────────────────────────────────────────
say "Uploading"
# ─────────────────────────────────────────────────────────────────────────────
# Via the home directory: scp cannot write to /opt/wa directly, since that needs
# root and scp has no way to ask for it.
gc compute scp "${TARBALL}" "${VM_NAME}:/tmp/wa-deploy.tar.gz" \
  --zone="${GCP_ZONE}" --tunnel-through-iap

# ─────────────────────────────────────────────────────────────────────────────
say "Unpacking"
# ─────────────────────────────────────────────────────────────────────────────
# Extract over the top rather than deleting first: /opt/wa also holds .env and
# evolution.env, which are not in the tarball and must survive every deploy.
remote "sudo tar -xzf /tmp/wa-deploy.tar.gz -C ${REMOTE_DIR} && rm -f /tmp/wa-deploy.tar.gz && sudo chown -R root:docker ${REMOTE_DIR} && echo unpacked"

# ─────────────────────────────────────────────────────────────────────────────
say "Checking configuration"
# ─────────────────────────────────────────────────────────────────────────────
# The two env files hold every secret and are created by hand on the VM, once.
# They are never in the repository and never travel over this script.
MISSING="$(remote "for f in ${REMOTE_DIR}/.env ${REMOTE_DIR}/evolution.env; do [ -f \$f ] || echo \$f; done" | tr -d '\r')"
if [ -n "${MISSING}" ]; then
  say "Missing environment files — uploading templates"
  gc compute scp \
    "${ROOT}/infra/gcp/env.production.example" \
    "${ROOT}/infra/gcp/evolution.env.production.example" \
    "${VM_NAME}:/tmp/" --zone="${GCP_ZONE}" --tunnel-through-iap
  remote "sudo cp -n /tmp/env.production.example ${REMOTE_DIR}/.env; \
          sudo cp -n /tmp/evolution.env.production.example ${REMOTE_DIR}/evolution.env; \
          sudo chmod 600 ${REMOTE_DIR}/.env ${REMOTE_DIR}/evolution.env; \
          rm -f /tmp/env.production.example /tmp/evolution.env.production.example"

  cat >&2 <<EOF

──────────────────────────────────────────────────────────────────────────────
Templates are on the VM but not filled in. Nothing has been started.

Fill them in, then re-run this script:

  infra/gcp/ssh.sh
  sudo nano /opt/wa/.env             # database, Chatwoot, API key, allowlist
  sudo nano /opt/wa/evolution.env    # same API key, same Supabase project

The two API keys must match. See docs/02-deployment.md.
──────────────────────────────────────────────────────────────────────────────
EOF
  exit 1
fi
skip ".env and evolution.env present"

# A placeholder left in place would start containers that fail in confusing ways —
# Evolution retrying a connection to a host called "<ref>", the bridge 401ing on
# every gateway call. Cheaper to catch here.
PLACEHOLDERS="$(remote "sudo grep -l '<ref>\|<password>\|<region>' ${REMOTE_DIR}/.env ${REMOTE_DIR}/evolution.env 2>/dev/null || true" | tr -d '\r')"
if [ -n "${PLACEHOLDERS}" ]; then
  echo "Unfilled placeholders (<ref>/<password>/<region>) remain in:" >&2
  echo "${PLACEHOLDERS}" >&2
  echo "Fill them in and re-run. Nothing has been started." >&2
  exit 1
fi
skip "no unfilled placeholders"

# ─────────────────────────────────────────────────────────────────────────────
say "Registry"
# ─────────────────────────────────────────────────────────────────────────────
# The image is private, so the VM must have logged in to ghcr.io once. Docker
# keeps that login in root's config (compose runs under sudo), and it survives
# reboots — it is the one manual step, done when the VM is first set up.
if ! remote "sudo test -f /root/.docker/config.json && sudo grep -q '\"ghcr.io\"' /root/.docker/config.json" >/dev/null 2>&1; then
  cat >&2 <<EOF

──────────────────────────────────────────────────────────────────────────────
The VM is not logged in to ghcr.io, so it cannot pull the bridge image.

One-time setup: create a GitHub token with only the read:packages scope
(Settings → Developer settings → Personal access tokens), then on the VM:

  infra/gcp/ssh.sh
  echo '<token>' | sudo docker login ghcr.io -u <github username> --password-stdin

and re-run this script. See docs/02-deployment.md.
──────────────────────────────────────────────────────────────────────────────
EOF
  exit 1
fi
skip "logged in to ghcr.io"

# ─────────────────────────────────────────────────────────────────────────────
say "Pulling and starting${IMAGE_TAG:+ (${IMAGE_TAG})}"
# ─────────────────────────────────────────────────────────────────────────────
remote "${TAG_ENV}${COMPOSE} pull --quiet bridge && ${TAG_ENV}${COMPOSE} up -d --remove-orphans"
# Every deploy leaves the previous image behind; on a 30 GB disk that adds up.
# Only images no container uses are removed, so the running one is never touched.
remote "sudo docker image prune -f >/dev/null && echo pruned"

# ─────────────────────────────────────────────────────────────────────────────
say "Status"
# ─────────────────────────────────────────────────────────────────────────────
remote "${COMPOSE} ps"

cat <<EOF

──────────────────────────────────────────────────────────────────────────────
Deployed. Certificates are issued on the first request to each hostname, so the
first load of any of these is slow and the ones after are not.

  Logs      infra/gcp/logs.sh              follow the bridge
            infra/gcp/logs.sh all         follow every container
            infra/gcp/logs.sh bridge 2000 no | grep ALERT
  Restart   infra/gcp/ssh.sh '${COMPOSE} restart bridge'

Check it is answering:

  curl -sS https://\$(grep '^WA_BRIDGE_HOST=' <(infra/gcp/ssh.sh "sudo cat ${REMOTE_DIR}/.env") | cut -d= -f2)/health
──────────────────────────────────────────────────────────────────────────────
EOF
