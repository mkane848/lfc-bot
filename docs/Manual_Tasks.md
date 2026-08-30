# Manual Tasks

Operational steps that are performed by hand on the deployed VM. These assume
you are SSH'd into the instance (`ssh -i ~/.ssh/lfcbot ubuntu@<PUBLIC_IP>`) and
working from the repository directory (`~/lfc-bot`).

## Set up the backup cron job

The bot keeps its SQLite database in the `lfcbot-data` Docker volume.
`scripts/backup.sh` snapshots that volume to a compressed archive, restarts the
bot, and prunes archives older than a configurable retention window.

1. Make the script executable (it is committed executable, but confirm):

   ```sh
   chmod +x scripts/backup.sh
   ```

2. Run it once by hand to make sure it works:

   ```sh
   ./scripts/backup.sh
   ```

   This stops the bot, writes an archive under `./backups/`, and restarts the
   bot. Confirm the log still shows `Bot is online` afterward:

   ```sh
   docker compose logs --tail=20 bot
   ```

3. Schedule it daily with cron:

   ```sh
   crontab -e
   ```

   Add this line, then save and exit:

   ```cron
   30 4 * * * cd ~/lfc-bot && ./scripts/backup.sh >> /var/log/lfcbot-backup.log 2>&1
   ```

4. Confirm the job is registered:

   ```sh
   crontab -l
   ```

5. Make the backups durable. The VM disk is persistent but not a backup on its
   own. Either point the script at a directory that is itself copied off-box
   (object storage or a second machine), or periodically copy `./backups/` off
   the VM.

Also confirm Docker starts on boot so the bot comes back after an instance
reboot:

```sh
systemctl is-enabled docker
```

This should print `enabled`. If it does not:

```sh
sudo systemctl enable docker
```

## Update the bot in the VM

The VM runs the build-from-source path (`docker compose up -d --build`). You can
update either manually or automatically.

### Manual update

To pull in a new release manually:

1. SSH in and move to the repository:

   ```sh
   cd ~/lfc-bot
   ```

2. Pull the latest code:

   ```sh
   git pull
   ```

3. Rebuild and replace the running container:

   ```sh
   docker compose up -d --build
   ```

4. Confirm it came online cleanly:

   ```sh
   docker compose logs --tail=30 bot
   ```

   Look for `Bot is online` and no `Fatal startup error`.

### Automatic updates with cron

To automatically pull and deploy new releases, set up the `scripts/auto-update.sh`
cron job:

1. Make the script executable:

   ```sh
   chmod +x scripts/auto-update.sh
   ```

2. Test it manually to make sure it works:

   ```sh
   ./scripts/auto-update.sh
   ```

   If the bot is already up to date, the script will log "No updates available"
   and exit cleanly. If updates exist, it will pull, rebuild, and verify the
   bot came online.

3. Schedule it with cron. For example, daily at 05:00 (after the 04:30 backup):

   ```sh
   crontab -e
   ```

   Add this line, then save and exit:

   ```cron
   0 5 * * * cd ~/lfc-bot && ./scripts/auto-update.sh >> /var/log/lfcbot-auto-update.log 2>&1
   ```

4. Confirm the job is registered:

   ```sh
   crontab -l
   ```

The script will:
- Fetch the latest refs from the remote without modifying your working tree
- Check if updates are available
- Pull, rebuild, and restart if new code is detected
- Log all actions to `logs/auto-update.log` and the cron log file
- Verify the bot came online cleanly

The SQLite database and per-server config live in the `lfcbot-data` named
volume, so rebuilding the image does not touch them. Database migrations run
automatically at startup.

To switch to the prebuilt GHCR image instead of building from source, see the
"Run from the prebuilt image" section in `DEPLOYMENT.md`.

## Automatic updates with prebuilt images

If you are running the bot from the prebuilt GHCR image (`ghcr.io/mkane848/lfc-bot`),
you can set up automatic updates using `scripts/auto-update-prebuilt.sh`:

1. Make the script executable:

   ```sh
   chmod +x scripts/auto-update-prebuilt.sh
   ```

2. Test it manually to make sure it works:

   ```sh
   ./scripts/auto-update-prebuilt.sh
   ```

   If the bot is already running the latest image, the script will log
   "No updates available" and exit cleanly. If a new image is available,
   it will pull, restart, and verify the bot came online.

3. Schedule it with cron. For example, daily at 05:00 (after the 04:30 backup):

   ```sh
   crontab -e
   ```

   Add this line, then save and exit:

   ```cron
   0 5 * * * cd ~/lfc-bot && ./scripts/auto-update-prebuilt.sh >> /var/log/lfcbot-auto-update-prebuilt.log 2>&1
   ```

4. Confirm the job is registered:

   ```sh
   crontab -l
   ```

The script will:
- Pull the latest image from GHCR
- Check if the image has changed (by comparing digest)
- Restart the container only if a new image is detected
- Log all actions to `logs/auto-update-prebuilt.log` and the cron log file
- Verify the bot came online cleanly

The SQLite database and per-server config live in the `lfcbot-data` named
volume, so restarting the container does not touch them.
