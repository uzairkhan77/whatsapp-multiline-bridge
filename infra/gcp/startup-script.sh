#!/usr/bin/env bash
# Runs on the VM at every boot, as root, via Compute Engine's startup-script metadata.
#
# Its only job is to make the machine able to run Docker Compose. The application
# itself is deployed separately, because a startup script that also deployed would
# tie "restart the VM" to "redeploy the app" — and those need to stay independent.
#
# Compute Engine re-runs this on every boot, not just the first, so everything here
# is idempotent and cheap on the second pass.
#
# Output lands in the serial console and in /var/log/syslog. Read it with:
#   gcloud compute instances get-serial-port-output wa-vps --zone=asia-southeast1-b

set -euo pipefail

exec > >(logger -t wa-startup -s 2>/dev/console) 2>&1

echo "starting"

# ─────────────────────────────────────────────────────────────────────────────
# Docker
# ─────────────────────────────────────────────────────────────────────────────
# From Docker's own apt repository rather than Ubuntu's `docker.io` package: we
# need the Compose v2 plugin, which Ubuntu does not ship, and a version that
# matches what the stack is tested against.
if ! command -v docker >/dev/null 2>&1; then
  echo "installing docker"

  export DEBIAN_FRONTEND=noninteractive
  apt-get update -qq
  apt-get install -y -qq ca-certificates curl gnupg

  install -m 0755 -d /etc/apt/keyrings
  if [ ! -f /etc/apt/keyrings/docker.asc ]; then
    curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
    chmod a+r /etc/apt/keyrings/docker.asc
  fi

  echo \
    "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] \
https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo "${VERSION_CODENAME}") stable" \
    > /etc/apt/sources.list.d/docker.list

  apt-get update -qq
  apt-get install -y -qq \
    docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin

  systemctl enable --now docker
  echo "docker installed"
else
  echo "docker already present"
fi

# ─────────────────────────────────────────────────────────────────────────────
# Log rotation
# ─────────────────────────────────────────────────────────────────────────────
# Docker's default json-file driver has no size limit. A chatty container on a
# 50 GB disk will eventually fill it, and a full disk on this box takes WhatsApp
# connections down with it — the failure looks like a gateway problem and is not.
# Set before anything runs, because the setting only applies to containers created
# after the daemon reloads.
if [ ! -f /etc/docker/daemon.json ]; then
  echo "configuring log rotation"
  mkdir -p /etc/docker
  cat > /etc/docker/daemon.json <<'JSON'
{
  "log-driver": "json-file",
  "log-opts": {
    "max-size": "50m",
    "max-file": "5"
  }
}
JSON
  systemctl restart docker
fi

# ─────────────────────────────────────────────────────────────────────────────
# Application directory
# ─────────────────────────────────────────────────────────────────────────────
# Deployment writes here. Group-writable by `docker` so an operator added to that
# group can deploy without sudo, which keeps the deploy path free of root.
install -d -m 2775 -g docker /opt/wa

echo "done"
