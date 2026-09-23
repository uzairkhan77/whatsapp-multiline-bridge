# Build context is the repository root, not this directory — the lockfile and the
# workspace manifest live up there, and a build that cannot see the lockfile
# cannot reproduce the dependency tree it was tested against.
#
#   docker build -f services/bridge/Dockerfile .

# ─────────────────────────────────────────────────────────────────────────────
FROM node:22-alpine AS build
# ─────────────────────────────────────────────────────────────────────────────
WORKDIR /repo
RUN corepack enable && corepack prepare pnpm@10.21.0 --activate

# Manifests before source. Docker caches each layer, so editing a source file
# re-runs only the build, while the dependency install — the slow part — is reused
# until a package.json or the lockfile actually changes.
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json ./
COPY services/bridge/package.json ./services/bridge/
# --frozen-lockfile fails rather than quietly resolving something new, so an image
# can never contain a dependency version that was not committed.
# The trailing `...` means "and everything this package depends on"; without it a
# workspace filter installs the package's own manifest and nothing beneath it.
RUN pnpm install --frozen-lockfile --filter @multiline/bridge...

COPY services/bridge ./services/bridge
RUN pnpm --filter @multiline/bridge run build

# ─────────────────────────────────────────────────────────────────────────────
FROM node:22-alpine AS runtime
# ─────────────────────────────────────────────────────────────────────────────
# A second install rather than copying node_modules across: this one is --prod, so
# TypeScript, tsx and the type packages never reach the running image. They are the
# bulk of the dependency tree and none of it is needed to run compiled JavaScript.
WORKDIR /repo
RUN corepack enable && corepack prepare pnpm@10.21.0 --activate

# ffmpeg, for one job: turning an inbound WhatsApp voice note into MP3.
#
# WhatsApp records voice notes as Opus in an Ogg container, which Apple's players
# cannot open at all — so before this, every voice note reaching an agent on an
# iPhone showed a player that produced silence. Chatwoot stores whatever it is
# given and has no conversion of its own (their issue #13210 is still open), so it
# happens here. See services/bridge/src/media/audio.ts.
#
# Around 80MB on the image. The bridge runs without it — voice notes are then
# delivered in their original format with a note attached — so this is what makes
# them play everywhere, not what makes the service start.
RUN apk add --no-cache ffmpeg

COPY pnpm-workspace.yaml pnpm-lock.yaml package.json ./
COPY services/bridge/package.json ./services/bridge/
RUN pnpm install --frozen-lockfile --prod --filter @multiline/bridge... \
 && pnpm store prune

COPY --from=build /repo/services/bridge/dist ./services/bridge/dist

WORKDIR /repo/services/bridge

# Unprivileged. The node image ships this user; nothing here needs to write to disk.
USER node

ENV NODE_ENV=production
EXPOSE 3001

# Note there is no --env-file here, unlike the `start` script in package.json.
# Locally that flag reads the repo-root .env; in a container the environment comes
# from Compose, and pointing at a file that does not exist would refuse to start.
CMD ["node", "dist/index.js"]
