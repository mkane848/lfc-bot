#!/usr/bin/env bash
#
# Back up the LFCbot SQLite database from its Docker named volume.
#
# The bot is stopped briefly so the copy is consistent, then restarted.
# Archives are compressed and pruned after RETENTION days. Point BACKUP_DIR
# at a directory that is itself copied off-box (object storage or a second
# machine) for real durability; the VM disk alone is not a backup.
#
# Usage (from the repository directory, where docker-compose.yml lives):
#   ./scripts/backup.sh
#
# Optional overrides:
#   BACKUP_DIR   target directory (default: ./backups)
#   RETENTION    days to keep archives (default: 14)
#   VOLUME       named volume to snapshot (default: lfcbot-data)
#   IMAGE        image used to copy and compress (default: alpine:3.20)

set -euo pipefail

BACKUP_DIR="${BACKUP_DIR:-$PWD/backups}"
RETENTION="${RETENTION:-14}"
VOLUME="${VOLUME:-lfcbot-data}"
IMAGE="${IMAGE:-alpine:3.20}"

mkdir -p "$BACKUP_DIR"

stamp="$(date +%F_%H-%M-%S)"
archive="$BACKUP_DIR/lfcbot-$stamp.tar.gz"

echo "Stopping the bot for a consistent snapshot..."
docker compose stop bot

echo "Copying the $VOLUME volume to $archive ..."
docker run --rm \
  -v "$VOLUME":/data \
  -v "$BACKUP_DIR":/backup \
  "$IMAGE" sh -c "tar czf /backup/$(basename "$archive") -C /data ."

echo "Restarting the bot..."
docker compose start bot

echo "Pruning backups older than $RETENTION days..."
find "$BACKUP_DIR" -name 'lfcbot-*.tar.gz' -type f -mtime +"$RETENTION" -delete

echo "Backup complete: $archive"
