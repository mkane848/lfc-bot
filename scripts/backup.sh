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
#   VOLUME       named volume to snapshot (default: the volume mounted at
#                /app/data in the bot's compose container)
#   IMAGE        image used to copy and compress (default: alpine:3.20)

set -euo pipefail

BACKUP_DIR="${BACKUP_DIR:-$PWD/backups}"
RETENTION="${RETENTION:-14}"
VOLUME="${VOLUME:-}"
IMAGE="${IMAGE:-alpine:3.20}"

# Compose prefixes the volume with the project name (lfc-bot_lfcbot-data for a
# clone in lfc-bot), so read the name off the bot container rather than
# guessing it. A wrong guess makes `docker run -v` create an empty volume and
# archive that without complaint.
if [ -z "$VOLUME" ]; then
  container_id="$(docker compose ps -aq bot)"
  if [ -z "$container_id" ]; then
    echo "No bot container found. Start the bot with docker compose first, or set VOLUME." >&2
    exit 1
  fi
  VOLUME="$(docker container inspect \
    --format '{{range .Mounts}}{{if eq .Destination "/app/data"}}{{.Name}}{{end}}{{end}}' \
    "$container_id")"
  if [ -z "$VOLUME" ]; then
    echo "The bot container has no named volume at /app/data. Set VOLUME to the one to back up." >&2
    exit 1
  fi
fi

mkdir -p "$BACKUP_DIR"

stamp="$(date +%F_%H-%M-%S)"
archive="$BACKUP_DIR/lfcbot-$stamp.tar.gz"

echo "Stopping the bot for a consistent snapshot..."
docker compose stop bot
# Restart the bot however the rest of the script ends, including on failure.
trap 'echo "Restarting the bot..."; docker compose start bot' EXIT

echo "Copying the $VOLUME volume to $archive ..."
docker run --rm \
  -v "$VOLUME":/data \
  -v "$BACKUP_DIR":/backup \
  "$IMAGE" sh -c "tar czf /backup/$(basename "$archive") -C /data ."

# An archive without a database file means the wrong (or an empty) volume was
# copied. Remove it so it can't be mistaken for a good backup.
contents="$(tar tzf "$archive")"
if ! grep -qE '\.(db|sqlite3?)$' <<<"$contents"; then
  rm -f "$archive"
  echo "The $VOLUME volume holds no database file; nothing was backed up." >&2
  exit 1
fi

echo "Pruning backups older than $RETENTION days..."
find "$BACKUP_DIR" -name 'lfcbot-*.tar.gz' -type f -mtime +"$RETENTION" -delete

echo "Backup complete: $archive"
