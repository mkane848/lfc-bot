# Deployment

LFCbot is a single Node.js process backed by a file-based SQLite database. It
connects outbound to Discord and Scryfall, so a deployment needs only an
always-on host, a persistent disk, and a little RAM. There is no inbound port
to expose and no external database to provision.

There are two supported ways to run it for a community:

1. **A shared bot you host** so friends add it with an invite link.
2. **One instance per community**, each running on its own free cloud VM.

Both use the same Docker packaging below.

## Option A: One shared bot you host

You run a single instance with your own bot token and database. Friends add the
bot to their server with an invite link and never touch a host. All servers
share one SQLite file, and per-server settings (digests, timezone, channels) are
isolated by guild. This is the recommended path for friend groups and small
stores.

### 1. Create the Discord application

1. Go to <https://discord.com/developers/applications> and create a new
   application.
2. On the **Bot** page, note the **token** and, on the **General Information**
   page, the **application ID** (also called client ID).
3. On the **Bot** page, keep the privileged intents off. LFCbot uses only the
   `Guilds` intent and does not require Message Content, members, or presence.

### 2. Provision a host

Use one of the free-VM options in
[Option B](#option-b-one-instance-per-community) below (Oracle Cloud Free Tier
or Google Cloud Free Tier), or any always-on machine you control. The rest of
the shared-bot steps assume a fresh Ubuntu host with SSH access.

### 3. Install Docker

```sh
sudo apt-get update
sudo apt-get install -y ca-certificates curl
sudo install -m 0755 -d /etc/apt/keyrings
sudo curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
sudo chmod a+r /etc/apt/keyrings/docker.asc
echo \
  "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu \
  $(. /etc/os-release && echo "$VERSION_CODENAME") stable" | \
  sudo tee /etc/apt/sources.list.d/docker.list > /dev/null
sudo apt-get update
sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
sudo usermod -aG docker "$USER"
```

Log out and back in (or run `newgrp docker`) so the `docker` group applies.

### 4. Clone and configure

```sh
git clone https://github.com/mkane848/lfc-bot.git
cd lfc-bot
cp .env.example .env
```

Edit `.env` and set:

```dotenv
DISCORD_TOKEN=your_bot_token
DISCORD_CLIENT_ID=your_application_id
NODE_ENV=production
```

Leave `DISCORD_GUILD_ID` empty so slash commands register globally for every
server that invites the bot. Leave `DATABASE_PATH` at its default or set it to
`/app/data/lfcbot.db`; the Docker image mounts the persistent volume there.

### 5. Start it

```sh
docker compose up -d --build
```

Confirm the bot logged in:

```sh
docker compose logs -f bot
```

The log should show `Bot is online`. The SQLite file is created in the named
volume `lfcbot-data` and survives `docker compose restart` and image rebuilds.

### 6. Invite your friends

Build an invite URL from your application ID. It needs the `bot` and
`applications.commands` scopes. The permissions the bot needs are **View
Channel**, **Send Messages**, **Embed Links**, and **Read Message History**
(permission value `84992`):

```text
https://discord.com/oauth2/authorize?client_id=YOUR_CLIENT_ID&permissions=84992&scope=bot%20applications.commands
```

You can also generate the same link in the Discord developer portal under
**OAuth2 > URL Generator**.

## Option B: One instance per community

Each community runs its own instance with its own token, database, and host.
The only genuinely free, always-on, persistent-disk options for a long-running
Node + SQLite + `node-cron` process are self-managed cloud VMs.

### Oracle Cloud Free Tier (primary)

Always Free includes Ampere A1 ARM (up to 4 OCPU / 24 GB) and a 200 GB boot
volume. Credit card is required for signup only; nothing is charged.

1. Create an account at <https://www.oracle.com/cloud/free/> and choose a home
   region with A1 capacity (for example `us-ashburn-1` or `us-phoenix-1`).
2. Generate an SSH key on your machine:

   ```sh
   ssh-keygen -t ed25519 -C "lfcbot" -f "$HOME/.ssh/lfcbot"
   ```

3. In the console, create a VCN: **Networking > Virtual cloud networks >
   Create VCN**, choose **Create VCN with Internet Connectivity**, set the
   **DNS Label** (for example `lfcbot`), and use the default CIDRs.
4. Create an instance: **Compute > Instances > Create instance**.
   - **Image:** Ubuntu 24.04 (ARM).
   - **Shape:** `VM.Standard.A1.Flex`, 2 OCPU / 12 GB.
   - **Primary VNIC:** the public subnet created with the VCN, with a public
     IPv4 address assigned.
   - **SSH keys:** paste the contents of `~/.ssh/lfcbot.pub`.
5. If you see "Out of capacity" for the A1 shape, switch the **availability
   domain** (AD-2 or AD-3), leave the fault domain as "Let Oracle choose", and
   retry. This is temporary and normal; do not switch to the paid `A3` shape.
6. SSH in with `ssh -i ~/.ssh/lfcbot ubuntu@PUBLIC_IP`, then follow the
   Docker install and clone steps from
   [Option A](#3-install-docker) onward.

### Google Cloud Free Tier (fallback)

Always Free includes one `e2-micro` VM (0.25 vCPU / 1 GB RAM, 30 GB disk) in
`us-east1`, `us-west1`, or `us-central1`. It is smaller but more reliable to
sign up for than Oracle.

```sh
gcloud auth login
gcloud projects create lfcbot-prod
gcloud config set project lfcbot-prod
gcloud compute instances create lfcbot-prod \
  --zone=us-central1-a \
  --machine-type=e2-micro \
  --image-family=ubuntu-2404-lts-amd64 \
  --image-project=ubuntu-os-cloud
gcloud compute ssh lfcbot-prod --zone=us-central1-a
```

1 GB is tight for Node plus Docker; add a swap file for headroom:

```sh
sudo fallocate -l 2G /swapfile
sudo chmod 600 /swapfile
sudo mkswap /swapfile
sudo swapon /swapfile
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
```

Then follow the Docker install and clone steps from
[Option A](#3-install-docker) onward.

## Run from the prebuilt image

The release workflow publishes a multi-architecture image (amd64 and arm64) to
`ghcr.io/mkane848/lfc-bot`. You can run it directly instead of building from
source, which is faster and needs no build toolchain:

```sh
docker login ghcr.io -u YOUR_GITHUB_USERNAME
docker pull ghcr.io/mkane848/lfc-bot:latest
docker run -d --name lfcbot \
  --env-file .env \
  -v lfcbot-data:/app/data \
  --restart unless-stopped \
  ghcr.io/mkane848/lfc-bot:latest
```

Pin a specific release tag (for example `:1.1.0`) for reproducible rollbacks,
or use `:latest` for the newest build. GHCR packages are private by default;
make the package public (or sign in) before friends pull it.

## Backups

The VM disk is persistent but not backed up automatically. Back up the SQLite
file regularly using `scripts/backup.sh`:

```sh
./scripts/backup.sh
```

By default it stops the bot for a consistent snapshot, writes a compressed
archive to `./backups/`, restarts the bot, and prunes archives older than 14
days. Point `BACKUP_DIR` at a directory that is itself copied off-box (object
storage or a second machine) for real durability:

```sh
BACKUP_DIR=/mnt/offbox/lfcbot-backups ./scripts/backup.sh
```

Schedule it with cron, for example daily at 04:30:

```cron
30 4 * * * cd /path/to/lfc-bot && ./scripts/backup.sh >> /var/log/lfcbot-backup.log 2>&1
```

A SQLite copy taken while the bot is running can be torn, so the script stops
the service first.

## Configuration reference

- `DISCORD_TOKEN` and `DISCORD_CLIENT_ID` are required.
- Leave `DISCORD_GUILD_ID` empty in production so commands register globally.
- Set `NODE_ENV=production` to use the compact JSON logger.
- `DATABASE_PATH` must resolve under the mounted `/app/data` volume so the
  database survives restarts and redeploys.
- The VM is always-on, so the Discord gateway and per-server digests never
  sleep.
