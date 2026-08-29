#!/usr/bin/env bash
#
# Automatically update LFCbot by pulling the latest code and rebuilding the container.
#
# This script is designed to run unattended via cron. It will:
# 1. Check if there are updates available (git fetch)
# 2. Pull the latest code from the remote branch
# 3. Rebuild and redeploy the Docker container
# 4. Verify the bot came online cleanly
# 5. Log all actions and errors
#
# Usage (from the repository directory, where docker-compose.yml lives):
#   ./scripts/auto-update.sh
#
# Optional overrides:
#   LOG_FILE     log output file (default: ./logs/auto-update.log)
#   BRANCH       git branch to pull from (default: main)

set -euo pipefail

LOG_FILE="${LOG_FILE:-$PWD/logs/auto-update.log}"
BRANCH="${BRANCH:-main}"

mkdir -p "$(dirname "$LOG_FILE")"

log() {
  local level="$1"
  shift
  local message="$*"
  local timestamp
  timestamp="$(date '+%Y-%m-%d %H:%M:%S')"
  echo "[$timestamp] [$level] $message" | tee -a "$LOG_FILE"
}

log "INFO" "Starting auto-update check..."

# Fetch the latest remote refs without changing the working tree
if ! git fetch origin "$BRANCH" 2>&1 | tee -a "$LOG_FILE"; then
  log "ERROR" "Failed to fetch from remote. Aborting."
  exit 1
fi

# Check if there are updates available (local != remote)
LOCAL=$(git rev-parse HEAD)
REMOTE=$(git rev-parse "origin/$BRANCH")

if [ "$LOCAL" = "$REMOTE" ]; then
  log "INFO" "No updates available. Bot is already up to date."
  exit 0
fi

log "INFO" "Updates available. Pulling latest code..."

# Pull the latest code
if ! git pull origin "$BRANCH" 2>&1 | tee -a "$LOG_FILE"; then
  log "ERROR" "Failed to pull from remote. Aborting."
  exit 1
fi

log "INFO" "Rebuilding and restarting the bot container..."

# Rebuild and replace the running container
if ! docker compose up -d --build 2>&1 | tee -a "$LOG_FILE"; then
  log "ERROR" "Docker compose failed. Aborting."
  exit 1
fi

# Wait a moment for the container to stabilize
sleep 3

# Check if the bot came online cleanly
LOG_OUTPUT=$(docker compose logs --tail=50 bot 2>&1 || true)

if echo "$LOG_OUTPUT" | grep -q "Bot is online"; then
  log "INFO" "Bot came online successfully."
  log "INFO" "Update complete. New version deployed."
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
