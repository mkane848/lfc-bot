#!/usr/bin/env bash
#
# Automatically update LFCbot using the prebuilt image from GHCR.
#
# This script is designed to run unattended via cron. It will:
# 1. Pull the latest image from GHCR
# 2. Check if a new image is available (by comparing digest)
# 3. Restart the container if an update is detected
# 4. Verify the bot came online cleanly
# 5. Log all actions and errors
#
# Usage (from the repository directory, where docker-compose.yml lives):
#   ./scripts/auto-update-prebuilt.sh
#
# Optional overrides:
#   LOG_FILE     log output file (default: ./logs/auto-update-prebuilt.log)
#   IMAGE        GHCR image to pull (default: ghcr.io/mkane848/lfc-bot:latest)

set -euo pipefail

LOG_FILE="${LOG_FILE:-$PWD/logs/auto-update-prebuilt.log}"
IMAGE="${IMAGE:-ghcr.io/mkane848/lfc-bot:latest}"

mkdir -p "$(dirname "$LOG_FILE")"

log() {
  local level="$1"
  shift
  local message="$*"
  local timestamp
  timestamp="$(date '+%Y-%m-%d %H:%M:%S')"
  echo "[$timestamp] [$level] $message" | tee -a "$LOG_FILE"
}

log "INFO" "Starting prebuilt image auto-update check..."

# Get the digest of the currently running image
CURRENT_DIGEST=$(docker compose images bot 2>/dev/null | tail -1 | awk '{print $NF}' || echo "unknown")
log "INFO" "Current image digest: $CURRENT_DIGEST"

# Pull the latest image from GHCR
log "INFO" "Pulling latest image from $IMAGE..."
if ! docker pull "$IMAGE" 2>&1 | tee -a "$LOG_FILE"; then
  log "ERROR" "Failed to pull image from GHCR. Aborting."
  exit 1
fi

# Get the digest of the newly pulled image
NEW_DIGEST=$(docker inspect --format='{{index .RepoDigests 0}}' "$IMAGE" 2>/dev/null | awk -F'@' '{print $NF}' || echo "unknown")
log "INFO" "New image digest: $NEW_DIGEST"

# Check if the image has changed
if [ "$CURRENT_DIGEST" = "$NEW_DIGEST" ]; then
  log "INFO" "No updates available. Bot is already running the latest image."
  exit 0
fi

log "INFO" "New image detected. Restarting container..."

# Restart the container with the new image
if ! docker compose up -d 2>&1 | tee -a "$LOG_FILE"; then
  log "ERROR" "Docker compose failed. Aborting."
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
