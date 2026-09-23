#!/usr/bin/env bash
# Shared settings for the Compute Engine deployment. Sourced by the other scripts
# in this directory; not meant to be run on its own.
#
# Every value here is overridable from the environment, so a second environment
# (staging, or a rebuild after a mistake) is a variable change rather than an edit:
#
#   VM_NAME=wa-vps-staging infra/gcp/provision.sh
#
# No secret belongs in this file. It is committed. Secrets reach the VM through
# .env.production, which is not.

# ─────────────────────────────────────────────────────────────────────────────
# Account and project
# ─────────────────────────────────────────────────────────────────────────────
# This project is shared with the voice-receptionist work and lives on a different
# Google account than the one gcloud happens to have active. Both are passed
# explicitly on every call rather than set with `gcloud config set`, so running
# these scripts never changes which project the operator's own shell points at.
# Getting that wrong is how a command meant for one project lands in another.
GCP_PROJECT="${GCP_PROJECT:-my-gcp-project}"
GCP_ACCOUNT="${GCP_ACCOUNT:-you@example.com}"

# ─────────────────────────────────────────────────────────────────────────────
# Where
# ─────────────────────────────────────────────────────────────────────────────
# Singapore, because the dedicated Supabase project is in ap-southeast-1. Every
# inbound and outbound message is at least one database round trip, so the VM and
# the database being in the same city is what keeps that cost invisible.
GCP_REGION="${GCP_REGION:-asia-southeast1}"
GCP_ZONE="${GCP_ZONE:-asia-southeast1-b}"

# ─────────────────────────────────────────────────────────────────────────────
# The machine
# ─────────────────────────────────────────────────────────────────────────────
# e2-standard-2 is 2 vCPU and 8 GB. The sizing constraint is Evolution: one
# container per WhatsApp number, each holding an open Baileys socket, and Baileys
# is memory-hungry rather than CPU-hungry. 8 GB comfortably carries the gateway
# containers plus the bridge and Caddy.
#
# Resizing later is a stop, a change and a start — a few minutes of downtime, no
# rebuild. So this is a starting point, not a decision to agonise over.
VM_NAME="${VM_NAME:-wa-vps}"
VM_MACHINE_TYPE="${VM_MACHINE_TYPE:-e2-standard-2}"
VM_IMAGE_FAMILY="${VM_IMAGE_FAMILY:-ubuntu-2404-lts-amd64}"
VM_IMAGE_PROJECT="${VM_IMAGE_PROJECT:-ubuntu-os-cloud}"
# No database on the box, and Evolution's message persistence is off, so the disk
# holds the operating system, container images and logs. 50 GB is roomy for that;
# it is also the point where pd-balanced stops being throughput-starved.
VM_DISK_SIZE="${VM_DISK_SIZE:-50GB}"
VM_DISK_TYPE="${VM_DISK_TYPE:-pd-balanced}"
# Firewall rules are attached to this tag rather than to the instance name, so a
# rebuilt VM inherits the rules by being tagged, with no firewall edit.
VM_TAG="${VM_TAG:-wa-vps}"

# ─────────────────────────────────────────────────────────────────────────────
# Network
# ─────────────────────────────────────────────────────────────────────────────
# A dedicated VPC rather than the project's default network. The project already
# runs another product; sharing a network would mean this deployment's firewall
# rules and that one's apply to the same address space, and a mistake in either
# reaches the other. An isolated network costs nothing and removes that entirely.
NETWORK_NAME="${NETWORK_NAME:-wa-net}"
SUBNET_NAME="${SUBNET_NAME:-wa-subnet}"
SUBNET_RANGE="${SUBNET_RANGE:-10.10.0.0/24}"
# Reserved separately from the VM so the address survives the VM being deleted and
# rebuilt. That matters once a domain points at it, and it matters right now
# because Evolution's per-instance webhooks are registered against this address —
# losing it means re-registering every line.
STATIC_IP_NAME="${STATIC_IP_NAME:-wa-vps-ip}"

# ─────────────────────────────────────────────────────────────────────────────
# Helpers
# ─────────────────────────────────────────────────────────────────────────────

# Always project- and account-qualified. See the note at the top.
gc() { gcloud --project="${GCP_PROJECT}" --account="${GCP_ACCOUNT}" "$@"; }

# `gcloud describe` exits non-zero when a resource is absent, which is the normal
# case on a first run rather than a failure. This turns that into a true/false
# test so the callers can stay idempotent under `set -e`.
gc_exists() { gc "$@" >/dev/null 2>&1; }

say()  { printf '==> %s\n' "$*"; }
skip() { printf '    %s\n' "$*"; }
