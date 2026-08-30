# Troubleshooting

Common problems when self-hosting LFCbot, and how to diagnose them. For setup
steps see [DEPLOYMENT.md](DEPLOYMENT.md); for routine operational tasks see
[Manual_Tasks.md](Manual_Tasks.md).

Unless noted otherwise, start with:

```sh
docker compose logs --tail=50 bot
```

## The bot won't come online

Look for `Fatal startup error` in the logs. Common causes:

- **Invalid or missing `DISCORD_TOKEN`.** Regenerate the token on the **Bot**
  page of the Discord developer portal and update `.env`, then
  `docker compose up -d --build`.
- **Database file not writable.** `DATABASE_PATH` must resolve under the
  mounted `/app/data` volume. If you changed it, confirm the named volume
  (`lfcbot-data`) is actually mounted there in `docker-compose.yml`.
- **Migrations failed.** The bot runs Drizzle migrations at startup; a
  migration error will show in the startup logs before the "Fatal startup
  error" line. This usually means the `src/db/migrations/` directory wasn't
  copied into the image — confirm you're building from an unmodified
  `Dockerfile` and haven't excluded it in `.dockerignore`.

You can also check `GET /health` on the port set by `HEALTH_PORT` (default
`3000`) — it returns `200` with `{"status":"ok"}` once both Discord and the
database are confirmed reachable, or `503` with `{"status":"degraded"}`
while still starting up or if either check is currently failing.

## Slash commands don't show up in Discord

- **Global registration takes time.** Commands registered globally (the
  production default, `DISCORD_GUILD_ID` unset) can take up to an hour to
  propagate to every server. Guild-scoped registration (`DISCORD_GUILD_ID`
  set) is near-instant and is the right choice while developing.
- **`DISCORD_GUILD_ID` set in production by mistake.** If it's set, commands
  only register to that one server — check `.env` and unset it, then
  restart, for commands to appear everywhere the bot is invited.
- **Bot invited without the `applications.commands` scope.** Re-invite using
  a link that includes `scope=bot%20applications.commands` (see
  [DEPLOYMENT.md](DEPLOYMENT.md#6-invite-your-friends)).

## Docker build fails

- **`better-sqlite3` fails to compile.** The Dockerfile's build stage
  includes `python3`, `make`, and `g++` for exactly this. If you've modified
  the Dockerfile and removed them, add them back to the build stage (not
  needed in the runtime stage, which uses the prebuilt native binary).
- **Building for the wrong architecture.** Oracle Ampere VMs are `arm64`;
  most other free-tier VMs (including Google's `e2-micro`) are `amd64`. The
  published image (`ghcr.io/mkane848/lfc-bot`) is multi-arch, so pulling it
  instead of building from source sidesteps this entirely — see
  [Run from the prebuilt image](DEPLOYMENT.md#run-from-the-prebuilt-image).
- **`npm ci` fails inside the build.** This is almost always a corrupted or
  out-of-date `package-lock.json` rather than a Docker problem — try
  `npm ci` locally first to confirm, and regenerate the lockfile with `npm
  install` if it's out of sync with `package.json`.

## The bot is online but not responding to commands

- **Check the health endpoint** (`GET /health`) — if `discord: false`, the
  gateway connection dropped; check for repeated reconnect attempts in the
  logs, which usually points to a network egress problem from the host.
- **Missing channel permissions.** The bot needs **View Channel**, **Send
  Messages**, and **Embed Links** in the channel the command was used in,
  separate from the invite-time permission grant — a channel-level
  permission override can still block it.

## Admin commands say "You need the Manage Server permission"

This checks the invoking member's actual Discord permissions at the time of
the command, not who invited the bot. Grant the **Manage Server** permission
to the user's role in **Server Settings > Roles**, or use an account that
already has it (e.g. the server owner).

## Digests aren't being delivered

1. Run `/admin config` to confirm `digest_mode` isn't still `disabled`, and
   that a channel and/or DM target is actually set.
2. Run `/admin digest` to trigger one manually — the reply will say whether
   there were no new listings, or whether delivery itself failed.
3. If delivery fails: for channel mode, confirm the bot can still see and
   post in the configured channel (it may have been deleted or the bot's
   access revoked); for DM mode, the target user may have DMs from server
   members disabled.
4. Check `/admin history` for the corresponding `digest` audit entry, and the
   bot process logs around the scheduled time for the underlying error.

A digest that repeatedly fails to send at all destinations triggers a
critical alert to `DISCORD_ALERT_WEBHOOK_URL`, if configured — that's the
fastest way to notice this without checking manually.

## "View on Manapool" links are missing or prices aren't showing

This is expected, not a bug, when `MANAPOOL_API_KEY` isn't set — the bot
falls back to a locally-built link (or no link, if the set/collector number
aren't known) and never shows a live price. Set `MANAPOOL_API_KEY` in `.env`
to a token from
<https://manapool.com/seller/integrations/manapool-api> and restart to
enable live links and pricing.

## Database looks locked or corrupted

- **Only run one bot process against one database file.** better-sqlite3
  does not support multiple processes writing to the same file concurrently;
  running two containers against the same `lfcbot-data` volume (for example,
  during a botched deploy) will cause lock errors or corruption.
- **A backup taken mid-write can be torn.** `scripts/backup.sh` stops the
  bot before copying the SQLite file for exactly this reason — always use it
  (or an equivalent stop-copy-restart) rather than copying the live file
  directly.

## Still stuck

Check the bot process logs first (`docker compose logs --tail=100 bot`) —
most failures state the cause directly. If the log points at something not
covered here, open an issue on the
[GitHub repository](https://github.com/mkane848/lfc-bot) with the relevant
log excerpt (redact your token if it appears).
