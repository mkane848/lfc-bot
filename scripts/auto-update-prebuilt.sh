#!/usr/bin/env bash
#
# Automatically update LFCbot using the prebuilt image from GHCR.
#
# This script is designed to run unattended via cron. It will:
# 1. Confirm docker compose is set up to run the prebuilt image
# 2. Pull the image the bot service uses
# 3. Compare it with the image the running container was created from
# 4. Recreate the container if the image changed, and confirm it switched
# 5. Verify the bot came online cleanly
# 6. Log all actions and errors
#
# Requires COMPOSE_FILE=docker-compose.yml:docker-compose.prebuilt.yml in .env
# (see docker-compose.prebuilt.yml). The image comes from that file:
# ghcr.io/mkane848/lfc-bot:latest, or LFCBOT_IMAGE in .env to pin a tag.
#
# Usage (from the repository directory, where docker-compose.yml lives):
#   ./scripts/auto-update-prebuilt.sh
#
# Optional overrides:
#   LOG_FILE     log output file (default: ./logs/auto-update-prebuilt.log)

set -euo pipefail

LOG_FILE="${LOG_FILE:-$PWD/logs/auto-update-prebuilt.log}"

mkdir -p "$(dirname "$LOG_FILE")"

log() {
  local level="$1"
  shift
  local message="$*"
  local timestamp
  timestamp="$(date '+%Y-%m-%d %H:%M:%S')"
  echo "[$timestamp] [$level] $message" | tee -a "$LOG_FILE"
}

# Image ID of the bot service's container, or empty if there isn't one.
running_image_id() {
  local container_id
  container_id="$(docker compose ps -aq bot)"
  if [ -n "$container_id" ]; then
    docker container inspect --format '{{.Image}}' "$container_id"
  fi
}

log "INFO" "Starting prebuilt image auto-update check..."

# Without the prebuilt override, the bot service builds from the local checkout
# and `docker compose up` would never run the image this script pulls. The
# resolved config includes .env values (the bot token), so it is never logged.
if ! SERVICE_CONFIG="$(docker compose config --format json bot)"; then
  log "ERROR" "Could not read the docker compose configuration. Aborting."
  exit 1
fi
if grep -q '^[[:space:]]*"build":' <<<"$SERVICE_CONFIG"; then
  log "ERROR" "docker compose is set to build the bot from source, not run the prebuilt image."
  log "ERROR" "Add COMPOSE_FILE=docker-compose.yml:docker-compose.prebuilt.yml to .env. Aborting."
  exit 1
fi

# Older docs started the prebuilt image with a bare `docker run --name lfcbot`.
# Compose doesn't manage that container, so starting the compose service next
# to it would run two copies of the bot on one token.
if docker container inspect lfcbot >/dev/null 2>&1; then
  log "ERROR" "Found a container named 'lfcbot' that docker compose does not manage."
  log "ERROR" "Move it to compose first: see 'Moving from docker run' in docs/DEPLOYMENT.md. Aborting."
  exit 1
fi

IMAGE="$(docker compose config --images bot)"

CURRENT_IMAGE_ID="$(running_image_id)"
log "INFO" "Current image ID: ${CURRENT_IMAGE_ID:-none (no bot container yet)}"

log "INFO" "Pulling $IMAGE..."
if ! docker compose pull bot 2>&1 | tee -a "$LOG_FILE"; then
  log "ERROR" "Failed to pull image from GHCR. Aborting."
  exit 1
fi

NEW_IMAGE_ID="$(docker image inspect --format '{{.Id}}' "$IMAGE")"
log "INFO" "Pulled image ID: $NEW_IMAGE_ID"

if [ "$CURRENT_IMAGE_ID" = "$NEW_IMAGE_ID" ]; then
  log "INFO" "No updates available. Bot is already running the latest image."
  exit 0
fi

log "INFO" "New image detected. Updating the bot container..."

# Compose recreates the container because its image changed; the lfcbot-data
# volume is kept.
if ! docker compose up -d bot 2>&1 | tee -a "$LOG_FILE"; then
  log "ERROR" "Docker compose failed. Aborting."
  exit 1
fi

RUNNING_IMAGE_ID="$(running_image_id)"
if [ "$RUNNING_IMAGE_ID" != "$NEW_IMAGE_ID" ]; then
  log "ERROR" "The bot container is still on image ${RUNNING_IMAGE_ID:-none}, not $NEW_IMAGE_ID. Aborting."
  exit 1
fi

# Wait a moment for the container to stabilize
sleep 3

# Check if the bot came online cleanly
LOG_OUTPUT=$(docker compose logs --tail=50 bot 2>&1 || true)

if echo "$LOG_OUTPUT" | grep -q "Bot is online"; then
  log "INFO" "Bot came online successfully."
  log "INFO" "Update complete. New image deployed."
  exit 0
elif echo "$LOG_OUTPUT" | grep -q "Fatal startup error"; then
  log "ERROR" "Bot failed to start with a fatal error. Inspect logs:"
  log "ERROR" "$LOG_OUTPUT"
  exit 1
else
  # Log output for inspection but don't fail (container might just be slow to log)
  log "WARN" "Could not confirm bot startup status. Recent logs:"
  log "WARN" "$LOG_OUTPUT"
  exit 0
fi
