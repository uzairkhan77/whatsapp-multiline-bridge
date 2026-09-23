#!/usr/bin/env bash
# Create the Compute Engine infrastructure: network, firewall, address, VM.
#
# Idempotent. Every step checks for what it is about to create and skips it if it
# is already there, so this is safe to re-run after a failure or a config change —
# and re-running it is how you find out whether the infrastructure still matches
# what this file says it should be.
#
# Deliberately does NOT deploy the application. Provisioning and deploying have
# different rhythms: this runs roughly once, deployment runs whenever the code
# changes. See infra/gcp/deploy.sh for the other half.
#
# Usage: infra/gcp/provision.sh

set -euo pipefail

# shellcheck source=infra/gcp/config.sh
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/config.sh"

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# ─────────────────────────────────────────────────────────────────────────────
say "Preflight"
# ─────────────────────────────────────────────────────────────────────────────
command -v gcloud >/dev/null || { echo "gcloud not installed" >&2; exit 1; }

if ! gcloud auth list --format='value(account)' 2>/dev/null | grep -qx "${GCP_ACCOUNT}"; then
  echo "not authenticated as ${GCP_ACCOUNT}" >&2
  echo "run: gcloud auth login ${GCP_ACCOUNT}" >&2
  exit 1
fi
gc projects describe "${GCP_PROJECT}" --format='value(projectId)' >/dev/null
skip "${GCP_ACCOUNT} can reach ${GCP_PROJECT}"

# ─────────────────────────────────────────────────────────────────────────────
say "APIs"
# ─────────────────────────────────────────────────────────────────────────────
# compute  the VM itself.
# oslogin  SSH access managed through IAM rather than by copying public keys into
#          project metadata. Revoking someone is then an IAM change, not a hunt
#          through metadata for their key.
# iap      SSH is not open to the internet; it arrives through Google's tunnel.
WANT_APIS="compute.googleapis.com oslogin.googleapis.com iap.googleapis.com"
HAVE_APIS="$(gc services list --enabled --format='value(config.name)')"
MISSING=""
for api in ${WANT_APIS}; do
  grep -qx "${api}" <<<"${HAVE_APIS}" || MISSING="${MISSING} ${api}"
done
if [ -n "${MISSING}" ]; then
  skip "enabling:${MISSING}"
  # shellcheck disable=SC2086
  gc services enable ${MISSING}
else
  skip "all enabled"
fi

# ─────────────────────────────────────────────────────────────────────────────
say "Network: ${NETWORK_NAME}"
# ─────────────────────────────────────────────────────────────────────────────
# Custom subnet mode, not auto. Auto mode creates a subnet in every region on
# earth; we want exactly one, in the region we chose, so there is no second place
# for something to accidentally come up.
if gc_exists compute networks describe "${NETWORK_NAME}"; then
  skip "exists"
else
  gc compute networks create "${NETWORK_NAME}" \
    --subnet-mode=custom \
    --description="WhatsApp conversation layer — isolated from the rest of this project"
fi

say "Subnet: ${SUBNET_NAME} (${SUBNET_RANGE} in ${GCP_REGION})"
if gc_exists compute networks subnets describe "${SUBNET_NAME}" --region="${GCP_REGION}"; then
  skip "exists"
else
  gc compute networks subnets create "${SUBNET_NAME}" \
    --network="${NETWORK_NAME}" \
    --region="${GCP_REGION}" \
    --range="${SUBNET_RANGE}"
fi

# ─────────────────────────────────────────────────────────────────────────────
say "Firewall"
# ─────────────────────────────────────────────────────────────────────────────
# Two rules, and no more. Everything the outside world can reach is 80 and 443,
# both of which are Caddy. No application port is open: the bridge
# service, the panel and Evolution are reachable only from inside the Docker
# network, which is what "no service exposed directly" means in practice.
#
# Note what is NOT here: the IP allowlist for gateway administration. All three
# hostnames share port 443, so a firewall rule cannot tell them apart — that
# restriction has to live in Caddy, where the hostname is known. See the Caddyfile.

if gc_exists compute firewall-rules describe "${NETWORK_NAME}-allow-web"; then
  skip "${NETWORK_NAME}-allow-web exists"
else
  # 80 is open alongside 443 for two reasons: Caddy redirects it to 443, and once a
  # domain exists Let's Encrypt's HTTP challenge arrives on it. Closing it would
  # make certificate issuance fail in a way that looks like a Caddy bug.
  gc compute firewall-rules create "${NETWORK_NAME}-allow-web" \
    --network="${NETWORK_NAME}" \
    --direction=INGRESS \
    --action=ALLOW \
    --rules=tcp:80,tcp:443 \
    --source-ranges=0.0.0.0/0 \
    --target-tags="${VM_TAG}" \
    --description="Caddy, the only public entry point"
fi

if gc_exists compute firewall-rules describe "${NETWORK_NAME}-allow-ssh-iap"; then
  skip "${NETWORK_NAME}-allow-ssh-iap exists"
else
  # 35.235.240.0/20 is Google's IAP forwarding range and nothing else. SSH is
  # therefore not reachable from the internet at all: an attacker cannot even see
  # that port 22 is open, and access is governed by IAM rather than by who holds a
  # key. Connect with `gcloud compute ssh --tunnel-through-iap`.
  gc compute firewall-rules create "${NETWORK_NAME}-allow-ssh-iap" \
    --network="${NETWORK_NAME}" \
    --direction=INGRESS \
    --action=ALLOW \
    --rules=tcp:22 \
    --source-ranges=35.235.240.0/20 \
    --target-tags="${VM_TAG}" \
    --description="SSH through Google IAP only — never from the open internet"
fi

# ─────────────────────────────────────────────────────────────────────────────
say "Static address: ${STATIC_IP_NAME}"
# ─────────────────────────────────────────────────────────────────────────────
if gc_exists compute addresses describe "${STATIC_IP_NAME}" --region="${GCP_REGION}"; then
  skip "exists"
else
  gc compute addresses create "${STATIC_IP_NAME}" --region="${GCP_REGION}"
fi
STATIC_IP="$(gc compute addresses describe "${STATIC_IP_NAME}" \
  --region="${GCP_REGION}" --format='value(address)')"
skip "${STATIC_IP}"

# ─────────────────────────────────────────────────────────────────────────────
say "VM: ${VM_NAME} (${VM_MACHINE_TYPE} in ${GCP_ZONE})"
# ─────────────────────────────────────────────────────────────────────────────
if gc_exists compute instances describe "${VM_NAME}" --zone="${GCP_ZONE}"; then
  skip "exists — delete it first if you need it rebuilt"
else
  # enable-oslogin=FALSE, which is not the choice you would expect.
  #
  # OS Login is the better mechanism — SSH access governed by IAM, so revoking
  # someone is an IAM change rather than a hunt through metadata for their key.
  # It does not work here. This project sits under organization 000000000000 and
  # is administered from a personal Gmail account, which is *external* to that
  # organization. OS Login refuses to create a Linux account for an external user
  # unless they hold roles/compute.osLoginExternalUser at the organization level,
  # and being roles/owner on the project does not grant it. The failure is:
  #
  #   does not have permission to access users instance [...:importSshPublicKey]
  #   The instance belongs to an external organization.
  #
  # So SSH keys go in instance metadata instead. Access is still not open to the
  # internet — port 22 only accepts Google's IAP range — but adding and removing
  # operators is a metadata change, which is worth knowing at handover time.
  #
  # If this project is ever moved under an account inside the organization, flip
  # this to TRUE and delete this comment.
  #
  # shielded-*          Secure Boot and integrity monitoring. Free, and the VM
  #                     holds live WhatsApp sessions, so it is worth having.
  # scopes              Only logging and monitoring. This VM has no business
  #                     reading the project's storage or databases, and a narrow
  #                     token is worth much less if the box is ever compromised.
  gc compute instances create "${VM_NAME}" \
    --zone="${GCP_ZONE}" \
    --machine-type="${VM_MACHINE_TYPE}" \
    --image-family="${VM_IMAGE_FAMILY}" \
    --image-project="${VM_IMAGE_PROJECT}" \
    --boot-disk-size="${VM_DISK_SIZE}" \
    --boot-disk-type="${VM_DISK_TYPE}" \
    --boot-disk-device-name="${VM_NAME}" \
    --subnet="${SUBNET_NAME}" \
    --address="${STATIC_IP}" \
    --tags="${VM_TAG}" \
    --metadata=enable-oslogin=FALSE \
    --metadata-from-file=startup-script="${HERE}/startup-script.sh" \
    --shielded-secure-boot \
    --shielded-vtpm \
    --shielded-integrity-monitoring \
    --scopes=logging-write,monitoring-write \
    --labels=app=whatsapp-multiline-bridge \
    --description="WhatsApp multiline bridge: Evolution gateway, bridge, Caddy"
fi

cat <<EOF

──────────────────────────────────────────────────────────────────────────────
Provisioned.

  VM          ${VM_NAME}  (${VM_MACHINE_TYPE}, ${GCP_ZONE})
  Address     ${STATIC_IP}
  Network     ${NETWORK_NAME}/${SUBNET_NAME}  ${SUBNET_RANGE}
  Open ports  80, 443 from anywhere; 22 from Google IAP only

Docker is installed by the startup script, which takes a minute or two after the
VM first reports RUNNING. Watch it:

  infra/gcp/ssh.sh 'cloud-init status --wait; docker --version'

Then deploy:

  infra/gcp/deploy.sh
──────────────────────────────────────────────────────────────────────────────
EOF
