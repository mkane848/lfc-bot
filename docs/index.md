# LFCbot Documentation

Welcome to LFCbot! This is a free, multi-server Discord bot for card trading listings.

## Features

- Post `/have` and `/want` listings with card resolution and autocomplete, for
  Magic: The Gathering and (once an admin enables it) Pokémon singles and
  sealed product
- Post up to 3 cards at once with `/have-multi` and `/want-multi`
- Post `/have-sealed` and `/want-sealed` listings for sealed product (booster
  boxes, bundles, prerelease kits, Commander decks, Elite Trainer Boxes, tins),
  with autocomplete backed by the local MTGJSON (Magic) and TCGCSV (Pokémon)
  catalogs
- Search active listings by card with filtered, paginated results
- Manage your listings with `/mylistings`, `/edit`, `/fulfill`, and `/delete`
- Per-server admin configuration with daily digests
- Active listings expire after 30 days

## Getting Started

1. Invite the bot to your server. For your own instance, build the invite link
   from its application ID as described in
   [Invite your friends](./DEPLOYMENT.md#6-invite-your-friends), and see
   [Permissions](#permissions) for what you are granting and why
2. Use `/help` to see available commands
3. Start posting with `/have` or `/want` commands

## Permissions

LFCbot asks Discord for as little as it can. This is everything it requests, and why.

**Scopes.** `bot` adds the bot to your server. `applications.commands` lets it
register its slash commands.

**Gateway intents.** `Guilds` only. LFCbot does not use the privileged intents
(Message Content, Server Members, Presence), so it does not receive the text of
your messages or your member list.

**Permissions requested when you invite it** (permission value `84992`):

| Permission | Why LFCbot needs it |
|---|---|
| View Channel | To see the channel it posts in, such as your digest channel. |
| Send Messages | To post the digest in the channel an admin picks with `/admin channel`. |
| Embed Links | Listings, search results and your own listings are shown as embeds, and digest lines link to Manapool and TCGplayer. |
| Read Message History | Part of Discord's usual set for bots that post in channels. LFCbot never reads or stores message content or history. |

**For members**

- `/admin` commands need the **Manage Server** permission. LFCbot checks the
  permissions of the member who runs the command, not of whoever invited the bot.
- Anyone who can use slash commands in a channel (**Use Application Commands**,
  on by default for everyone) can post listings there. This is not something you
  grant the bot.

**What the bot does not do.** The digest never pings anyone: it is sent with
mentions turned off. A digest sent by DM (`/admin dm-target`) needs no server
permission but respects the recipient's DM settings. See the
[Privacy Policy](./privacy-policy.html) for what is stored.

To build the invite link, see [Invite your friends](./DEPLOYMENT.md#6-invite-your-friends).

## Links

**Documentation**

- [Deployment Guide](./DEPLOYMENT.md)
- [Manual Tasks](./Manual_Tasks.md)
- [FAQ](./FAQ.md)
- [Troubleshooting](./TROUBLESHOOTING.md)

**Project**

- [GitHub repository](https://github.com/mkane848/lfc-bot)
- [Contributing Guidelines](https://github.com/mkane848/lfc-bot/blob/main/CONTRIBUTING.md)
- [Report an issue or request a feature](https://github.com/mkane848/lfc-bot/issues)

**Legal**

- [Privacy Policy](./privacy-policy.html)
- [Terms of Service](./terms-of-service.html)
