# Running LFCbot on Windows

LFCbot is a plain Node.js process with a SQLite file, so it runs on a Windows
PC without Docker. This guide is for a shop or community that wants to host its
own copy on an always-on Windows machine. If you would rather not maintain
anything, ask whoever runs a shared bot for an invite link instead (see
[Option A](./DEPLOYMENT.md#option-a-one-shared-bot-you-host)).

The bot only makes outbound connections, so no port forwarding or public IP is
needed. It must be running for listings to work and for digests to go out, so
the PC needs to stay on and awake.

## 1. Create the Discord application

Follow [Create the Discord application](./DEPLOYMENT.md#1-create-the-discord-application).
Each self-hosted copy needs its own application and token.

## 2. Install the tools

Open PowerShell and run:

```powershell
winget install OpenJS.NodeJS.LTS   # Node 22 or newer
winget install Git.Git
```

Close and reopen PowerShell, then check `node --version` prints v22 or newer.

## 3. Get the code and configure it

```powershell
git clone https://github.com/mkane848/lfc-bot.git C:\lfcbot
cd C:\lfcbot
Copy-Item .env.example .env
notepad .env
```

Fill in `DISCORD_TOKEN` and `DISCORD_CLIENT_ID`, and set `NODE_ENV=production`.
Leave `DATABASE_PATH` as it is; the database is created in `C:\lfcbot\data`.
Never share or commit `.env`.

## 4. Build and start

```powershell
npm ci
npm run build
npm start
```

Leave it running and invite the bot with the link from
[Invite your friends](./DEPLOYMENT.md#6-invite-your-friends). Press `Ctrl+C` to
stop it.

## 5. Keep it running

Closing the window stops the bot, so register it as a scheduled task that starts
at boot and restarts on failure. In an **administrator** PowerShell:

```powershell
$action = New-ScheduledTaskAction -Execute 'node.exe' -Argument 'dist\index.js' -WorkingDirectory 'C:\lfcbot'
$trigger = New-ScheduledTaskTrigger -AtStartup
$settings = New-ScheduledTaskSettingsSet -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1) `
  -ExecutionTimeLimit ([TimeSpan]::Zero) -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
Register-ScheduledTask -TaskName 'LFCbot' -Action $action -Trigger $trigger -Settings $settings `
  -User 'SYSTEM' -RunLevel Highest
Start-ScheduledTask -TaskName 'LFCbot'
```

Check it with `Get-ScheduledTask LFCbot`, and stop it with
`Stop-ScheduledTask LFCbot`. If `node.exe` is not found, use its full path from
`(Get-Command node).Source`.

Also set Windows to never sleep while plugged in (Settings, System, Power), and
set active hours so updates do not restart the PC mid-day. The task starts the
bot again after a reboot.

Check that it is healthy at <http://localhost:3000/health>; it returns `ok`
once the bot is connected to Discord.

## 6. Updating

```powershell
Stop-ScheduledTask LFCbot
cd C:\lfcbot
git pull
npm ci
npm run build
Start-ScheduledTask LFCbot
```

Database migrations run automatically at startup.

## 7. Backups

`scripts\backup.ps1` copies the database to a timestamped file and prunes old
ones. Run it from the repository folder:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\backup.ps1
```

It briefly stops the `LFCbot` task for a consistent copy, then starts it again.
Point `-BackupDir` at a folder that syncs off the machine (OneDrive, a USB
drive) for real durability, and schedule it daily with Task Scheduler.

## Differences from the Docker setup

- The Docker health check, `restart: unless-stopped`, and volume are replaced by
  the scheduled task and the `data` folder.
- `scripts/backup.sh` and `scripts/auto-update-prebuilt.sh` are for the Docker
  setup; use `backup.ps1` and the manual update steps above on Windows.
