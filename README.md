# LFCbot

LFCbot is a multi-server Discord bot for buy, sell, and trade listings of
trading cards. Users post listings, search what others are offering, and
admins receive configurable daily digest notifications of new activity.

Version 1 targets **Magic: The Gathering** through the Scryfall API. The data
model keeps a `game` column so other games can be added later without a schema
migration.

## Features

- Post `/sell`, `/buy`, and `/trade` listings with Scryfall card resolution and
  autocomplete.
- Search active listings by card with filtered, paginated results.
- Manage your own listings with `/mylistings`, `/edit`, `/fulfill`, and
  `/delete`.
- Per-server admin configuration of a daily digest (channel and/or DM) with its
  own cron schedule and timezone.
- Active listings expire after 30 days and are excluded from search and digests.
- Open source (MIT) and designed for small game stores and friend groups.

## Requirements

- Node.js 20 or newer
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
   test server.

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
| `/sell` | Post a card you want to sell |
| `/buy` | Post a card you want to buy |
| `/trade` | Post a card you want to trade |
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

## License

MIT. See [LICENSE](LICENSE).
