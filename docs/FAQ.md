# FAQ

Common questions from people using LFCbot in a server. For command syntax, see
the [README command reference](../README.md#command-reference) or run `/help`
in Discord. For self-hosting questions, see
[DEPLOYMENT.md](DEPLOYMENT.md) and [TROUBLESHOOTING.md](TROUBLESHOOTING.md).

## Posting listings

**What's the difference between `/have` and `/have-multi`?**
`/have` posts one card with the full set of options (set, finish, variant,
collector number, price, quantity, notes). `/have-multi` opens a form for up
to 3 cards at once, one line each (`Card Name | condition | price | qty`), but
without the printing-detail options — use `/have` when you need to pin an
exact printing. The same split applies to `/want` and `/want-multi`.

**Why do I have to pick what I "accept"?**
Every listing says whether you'll take `cash`, `trade`, or `both` in return.
This is separate from whether you're posting a `have` (you own the card) or a
`want` (you're looking for it) — so a `/have` with `accepts: trade` means "I'll
trade this card away," not "I'll pay cash for it."

**My card wasn't found.**
Card resolution goes through Scryfall. Try starting to type the name and pick
a suggestion from the autocomplete dropdown instead of typing the full name —
that guarantees an exact match. If you're pinning a specific printing (set,
collector number), double check the set code; an unrecognized set/collector
number combination will fail to resolve even if the card name itself is
right.

**Is there a limit on how many listings I can post?**
No hard cap, but there's a 10-second cooldown between posts (per user, per
server) to prevent spam. Posting the same card/condition/price you already
have an active listing for within the last 24 hours doesn't block the new
post, but the bot will warn you about the duplicate.

## Managing listings

**Can I edit a listing after I post it?**
Yes — `/edit <listing_id>` opens a form to change condition, price, quantity,
notes, or set. `/mylistings` also has a dropdown to batch-edit several
listings in a row. Only the original poster can edit their own listing.

**What happens when I fulfill or delete a listing?**
Both remove it from search results and future digests immediately. Neither
can be undone — there's no "un-fulfill" or restore. If you made a mistake,
just post a new listing.

**Why did my listing disappear?**
Active listings automatically expire 30 days after posting. They're not
deleted from the database, just excluded from search and digests — so if you
still want the card, post a fresh listing.

**Can someone else edit or delete my listing?**
No — only you can edit, fulfill, or delete your own listings. The one
exception is server moderators with the Manage Server permission, who can
remove any listing in their server for moderation (`/admin remove`); they
can't edit or fulfill someone else's listing.

## Search

**Why does filtering by "cash" also show listings marked "both"?**
A listing that accepts "both" satisfies a search for either "cash" or
"trade" specifically, since it's a superset of what you're asking for. Only
filtering by "both" itself requires an exact "both" match.

**Search says no results, but I know someone posted that card.**
Search matches on exact card name (case- and punctuation-insensitive) and
only shows `active` listings. The listing may have expired, been fulfilled,
been deleted, or the card name may be slightly different (check for a set
code, alternate spelling, or a card with a similar name).

## Trading safely

LFCbot only helps you find and coordinate trades — it doesn't handle
payment, shipping, or escrow, and it can't verify who you're dealing with
beyond their Discord account. A few widely-used norms from the MTG trading
community are worth following:

**Use PayPal Goods & Services for cash trades, not Friends & Family.**
Goods & Services gives you buyer protection if something goes wrong; Friends
& Family does not, and a seller asking for F&amp;F on a cash purchase is a
common red flag.

**Always ship with tracking.** Untracked shipments are the easiest way for a
trade to turn into a dispute with no way to resolve it. Keep the tracking
number until the trade is confirmed received.

**Grade honestly, and grade down when unsure.** The condition scale this bot
uses (`nm`/`lp`/`mp`/`hp`/`dmg`) is the standard one, but it's self-reported
— if a card is borderline between two grades, list it as the lower one.
Overgrading is the most common source of trade disputes.

**Who ships first is between the traders**, unless your server has its own
rule (check with a moderator). It's common for the lower-value side of a
trade, or a newer/unverified member, to ship first.

**Report suspicious behavior to a moderator.** LFCbot doesn't have a
reputation or vouch system — trust is built the same way it is in any
Discord trading community, through your server's own moderation and
established members.

## Digests

**I'm not getting daily digest notifications.**
Digests are off by default. A server admin needs to run `/admin channel`
(or `/admin dm-target`), then `/admin schedule`, then `/admin mode` to turn
delivery on — check `/admin config` to see the current setup. Note that only
listings created *after* digests are enabled are included in the first
digest; nothing retroactive.

## General

**What games does LFCbot support?**
Magic: The Gathering only, for now. The data model has room for other games
later, but nothing else is selectable today.

**Can I use LFCbot in more than one server?**
Yes — the bot supports many servers from one instance, and each server's
listings, digest settings, and admin config are completely independent.

**What data does the bot store about me?**
Your Discord user ID, display name, and whatever you put in a listing
(card, condition, price, notes). See the
[Security and Privacy section of the README](../README.md#security-and-privacy)
and the [Privacy Policy](../PRIVACY_POLICY.md) for the full picture.
