\# Free Hosted Deployment Path for LFCbot (Keep Self-Host)



\## Summary



Keep self-hosting as the primary path and add a documented \*\*free cloud deployment\*\* so individual communities can run their own bot instance without managing a home server. The only genuinely free, always-on, persistent-disk options for a long-running Node + SQLite + `node-cron` bot are self-managed cloud VMs:



\- \*\*Primary: Oracle Cloud Free Tier\*\* (Always Free). Ampere A1 ARM (up to 4 OCPU / 24 GB RAM) or AMD micro VMs, with a persistent 200 GB boot volume.

\- \*\*Fallback: Google Cloud Free Tier\*\* `e2-micro` VM in `us-central1` / `us-west1` / `us-east1` (always free, smaller: 0.25 vCPU / 1 GB RAM, 30 GB disk).



Both require a credit card for signup only (no charge). Managed "free" PaaS tiers (Render, Koyeb, Railway, Fly) are excluded because they sleep after idle, lack persistent disk, or no longer have a real free tier; serverless functions (Vercel, Workers, Cloud Run) are excluded because the bot holds a persistent Discord gateway WebSocket and `node-cron` jobs. No source/runtime logic changes are needed; the work is packaging + documentation.



\## Key Changes



\- \*\*Add a multi-stage `Dockerfile`\*\* that builds `dist/` in a Node 20 Debian-slim build stage and produces a slim runtime stage running `node dist/index.js`. It must:

&#x20; - Support both `linux/amd64` and `linux/arm64` (Oracle Ampere is arm64, Google `e2-micro` is amd64); include `python3`/`make`/`g++` so `better-sqlite3` compiles if a prebuilt binary is missing.

&#x20; - Run as a non-root user, set `NODE\_ENV=production`, and copy generated Drizzle migrations from `src/db/migrations/` (the `npm run build` output alone does not include them, and they are required at startup).

&#x20; - Leave `DATABASE\_PATH` resolving under a mounted `data/` volume so the SQLite file survives restarts/redeploys.

\- \*\*Add `.dockerignore`\*\* excluding `node\_modules`, `dist`, `data`, `.env`, `.git`, and logs so the build context is clean and never carries the token or the database.

\- \*\*Add a minimal `docker-compose.yml`\*\* with a named volume for `/app/data`, `env\_file: .env`, and `restart: unless-stopped`. This gives a portable run method for both Docker-preferring self-hosters and the free VMs.

\- \*\*Add `docs/DEPLOYMENT.md`\*\* (and link it from the README "Self-Hosting" section) covering, in order: the existing self-host path, then the free VM path with concrete steps for Oracle Cloud Free Tier and the Google `e2-micro` fallback (account creation, VM launch, Docker install, clone, `.env`, `docker compose up -d`). It must call out: `NODE\_ENV=production` and leave `DISCORD\_GUILD\_ID` unset so commands register globally for the community instance; the VM disk is persistent but not backed up, so document periodic SQLite backups; and that the VM stays always-on so digests and the gateway never sleep.

\- \*\*No changes\*\* to `src/`, the database schema, migrations, CI, or command registration logic. `src/index.ts` already runs migrations at boot and handles `SIGTERM`/`SIGINT`, which is what Docker needs for clean stops.



\## Test Plan



\- `npm run build` succeeds and `npm start` still boots against a fresh `.env` (self-host path unchanged).

\- Build the image on both `amd64` and `arm64` (or at least verify `better-sqlite3` resolves without a compile failure), then `docker compose up` against a throwaway token; confirm the bot logs "online", a migration-generated SQLite file appears in the mounted `data/` volume, and it survives a `docker compose restart`.

\- Confirm `.dockerignore` prevents `.env` and `data/` from entering the build context.

\- Verify the documented Oracle/Google steps are internally consistent (commands copy-paste cleanly) and that `DISCORD\_GUILD\_ID` is absent in the production examples.



\## Assumptions



\- Credit-card signup is acceptable (confirmed); the recommendation targets the two always-free VMs only.

\- Deployment is for \*\*per-community instances\*\* (confirmed), so the guide uses global command registration and each operator owns their own token, database, and VM.

\- Node 20 on Debian slim is the default runtime; Docker is the recommended run method, with the raw `npm run build \&\& npm start` path preserved for self-host.

\- Free-tier availability changes over time and could not be re-verified live this turn (network was restricted); the implementer should confirm current Oracle/Google free-tier terms before writing the final guide, but the Dockerfile and docs structure are independent of that.



