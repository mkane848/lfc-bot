# LFCbot

LFCbot is a free, multi-server Discord bot for have/want trading card listings,
designed for friend groups, online communities, and Local Game Stores. Members
post a card they have or want, whether they'll accept cash, trade, or both,
search what others are offering, and admins receive configurable daily digest
notifications of new activity.

Version 1 targets **Magic: The Gathering** through the Scryfall API. The data
model keeps a `game` column so other games can be added later without a schema
migration.

## Features

- Post `/have` and `/want` listings with Scryfall card resolution and
  autocomplete, choosing whether you accept cash, trade, or both.
- Post up to 3 cards at once with `/have-multi` and `/want-multi`, each card
  with its own condition/price/quantity.
- Optionally pin a listing to an exact printing (set, finish, variant,
  collector number), and link out to it on Manapool.
- Search active listings by card with filtered, paginated results.
- Manage your own listings with `/mylistings`, `/edit`, `/fulfill`, and
  `/delete`. `/mylistings` also offers dropdowns to delete, fulfill, or edit
  several listings in one go.
- Per-server admin configuration of a daily digest (channel and/or DM) with its
  own cron schedule and timezone.
- Active listings expire after 30 days and are excluded from search and digests.
- Open source (MIT) and designed for small game stores and friend groups.

## Requirements

- Node.js 22 or newer
- A Discord application with a bot token

## Setup

1. Clone the repository and install dependencies:

   ```sh
   npm install
   ```

2. Create your `.env` from the example:

   ```sh
   cp .env.example .env
   ```

   Fill in at least `DISCORD_TOKEN` and `DISCORD_CLIENT_ID`. The bot reads them
   from your environment or your `.env` file, and the token is never committed.
   During development, set `DISCORD_GUILD_ID` to register commands only to your
   test server. Optionally set `MANAPOOL_API_KEY` to enable live "View on
   Manapool" links and price lookups for exact printings.

3. Run migrations and start the bot:

   ```sh
   npm run dev
   ```

   The SQLite database is created automatically at `DATABASE_PATH`
   (`./data/lfcbot.db` by default).

## Bot Permissions

Invite the bot with the `applications.commands` scope and grant these
permissions for user-visible features:

- Send Messages
- Embed Links
- Read Message History
- Use Application Commands

Admin commands require the **Manage Server** permission.

## Command Reference

### User Commands

| Command | Description |
|---------|-------------|
| `/have` | Post a card you have, accepting cash, trade, or both |
| `/want` | Post a card you want, offering cash, trade, or both |
| `/search` | Search active listings for a card |
| `/mylistings` | Show your active listings with actions |
| `/edit` | Edit one of your listings via a modal |
| `/fulfill` | Mark one of your listings as fulfilled |
| `/delete` | Delete one of your listings |
| `/help` | Show available commands and usage |

### Admin Commands

| Command | Description |
|---------|-------------|
| `/admin config` | Show and configure digest settings |
| `/admin digest` | Manually trigger a digest now |
| `/admin schedule` | Set the five-field digest cron |
| `/admin timezone` | Set the server IANA timezone |
| `/admin channel` | Set the digest channel |
| `/admin dm-target` | Set the user to receive digest DMs |
| `/admin mode` | Set delivery to disabled, channel, dm, or both |
| `/admin games` | Enable or disable a supported game |
| `/admin remove` | Remove any listing for moderation |

## Self-Hosting

LFCbot is a single Node.js process. It uses a file-based SQLite database and
needs no external services beyond Discord and Scryfall. Run `npm run build` and
then `npm start` in production, or use any process manager of your choice. The
bot stops all scheduled jobs gracefully on SIGINT/SIGTERM and rebuilds them from
the database on boot.

For containerized or free-cloud deployment, including a shared bot your friends
can invite and per-community VM setup, see
[docs/DEPLOYMENT.md](docs/DEPLOYMENT.md). If something isn't working, check
[docs/TROUBLESHOOTING.md](docs/TROUBLESHOOTING.md).

## FAQ

Common questions about posting, editing, search, and digests are answered in
[docs/FAQ.md](docs/FAQ.md).

## Security and Privacy

- The bot stores only Discord user IDs, display names, listing content, and
  Scryfall card metadata.
- All user input is validated and bounded before storage, and all database
  access uses Drizzle parameter binding.
- Only listing owners can edit, fulfill, or delete their own listings; admins
  can remove any listing for moderation.
- When the bot is removed from a guild, that guild's data is removed after a
  30-day retention window.
- No unsolicited DMs are sent outside of configured digests.

## Development

See [CONTRIBUTING.md](CONTRIBUTING.md) for contribution guidelines. The test
suite, linter, and type-checker all run in CI on every push and pull request.

## Legal

- **Terms of Service**: See [TERMS_OF_SERVICE.md](TERMS_OF_SERVICE.md)
- **Privacy Policy**: See [PRIVACY_POLICY.md](PRIVACY_POLICY.md)

## License

MIT. See [LICENSE](LICENSE).
