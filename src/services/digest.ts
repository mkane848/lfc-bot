import type { Client, TextChannel, User } from 'discord.js';
import { getDb } from '../db/index.js';
import { digestLog, type ListingRow, type ServerRow } from '../db/schema.js';
import { DIGEST_SECTION_CAP, DISCORD_MESSAGE_MAX_LENGTH } from '../utils/constants.js';
import type { DigestTrigger } from '../types/index.js';
import { digestLine } from '../utils/embeds.js';
import { prepareDigestListings, setServerWatermark } from './digest-state.js';
import { sendCriticalAlert } from './alerts.js';
import { retryWithBackoff } from '../utils/retry.js';

const now = () => Date.now();

export interface DigestResult {
  sent: boolean;
  channelOk: boolean;
  dmOk: boolean;
  listingCount: number;
}

/**
 * Format a digest message body from the collected listings, grouped by type.
 * Each section is capped and overflows are noted.
 */
export function formatDigest(listingsToShow: ListingRow[]): string {
  const groups = {
    have: listingsToShow.filter((l) => l.intent === 'have'),
    want: listingsToShow.filter((l) => l.intent === 'want'),
  };

  const sections: string[] = [];
  const pushSection = (title: string, rows: ListingRow[]): void => {
    if (rows.length === 0) {
      return;
    }
    const shown = rows.slice(0, DIGEST_SECTION_CAP);
    const lines = shown.map(digestLine).join('\n');
    const overflow =
      rows.length > DIGEST_SECTION_CAP ? `\n+${rows.length - DIGEST_SECTION_CAP} more` : '';
    sections.push(`${title} (${rows.length})\n${lines}${overflow}`);
  };

  pushSection('NEW HAVES', groups.have);
  pushSection('NEW WANTS', groups.want);

  return sections.join('\n\n');
}

/**
 * Split a digest into messages that each fit Discord's content limit; a busy
 * day's digest runs well past it, and Discord rejects an oversized message
 * outright. Blank-line-separated blocks (the heading and each section) are
 * kept whole where they fit, so a message starts at a section heading when
 * possible. A block too long for one message is split between lines.
 */
export function splitDigestMessage(text: string, limit = DISCORD_MESSAGE_MAX_LENGTH): string[] {
  const messages: string[] = [];
  let current = '';
  const append = (piece: string, separator: string): void => {
    if (current && current.length + separator.length + piece.length > limit) {
      messages.push(current);
      current = '';
    }
    current = current ? `${current}${separator}${piece}` : piece;
  };

  for (const block of text.split('\n\n')) {
    if (block.length <= limit) {
      append(block, '\n\n');
      continue;
    }
    block.split('\n').forEach((line, index) => {
      const separator = index === 0 ? '\n\n' : '\n';
      // No real digest line comes close to the limit; hard-split one that
      // somehow does rather than drop it.
      for (let start = 0; start < Math.max(line.length, 1); start += limit) {
        append(line.slice(start, start + limit), start === 0 ? separator : '\n');
      }
    });
  }
  if (current) {
    messages.push(current);
  }
  return messages;
}

/**
 * Run a digest for one server. Follows the watermark rules in the spec: only
 * listings created after `last_digest_at` are selected, delivery is by
 * `digest_mode`, and the watermark only advances when at least one destination
 * succeeds.
 */
export async function runDigest(
  client: Client,
  server: ServerRow,
  trigger: DigestTrigger,
): Promise<DigestResult> {
  const collected = prepareDigestListings(server);

  const empty: DigestResult = { sent: false, channelOk: false, dmOk: false, listingCount: 0 };
  if (collected.length === 0) {
    return empty;
  }

  const heading = `Daily Listing Digest — ${new Date(now()).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  })}`;
  const messages = splitDigestMessage(`${heading}\n\n${formatDigest(collected)}`);

  let channelOk = false;
  let dmOk = false;
  if (server.digestMode === 'channel' || server.digestMode === 'both') {
    channelOk = await deliverToChannel(client, server, messages);
  }
  if (server.digestMode === 'dm' || server.digestMode === 'both') {
    dmOk = await deliverToDm(client, server, messages);
  }

  if (!channelOk && !dmOk) {
    // No destination succeeded; record the failure and leave the watermark
    // unchanged so the same listings are retried next time.
    logDigest(server.id, trigger, collected, { channel: false, dm: false });
    sendCriticalAlert(`Digest delivery failed for server ${server.id}`);
    return { sent: false, channelOk, dmOk, listingCount: collected.length };
  }

  setServerWatermark(server.id, now());
  logDigest(server.id, trigger, collected, { channel: channelOk, dm: dmOk });
  return { sent: true, channelOk, dmOk, listingCount: collected.length };
}

/**
 * Send each digest message in order, retrying each one. Throws if any message
 * still fails, so a destination only counts as delivered when the whole
 * digest arrived. After a partial send the watermark may stay put and the
 * next run repeats the messages that did arrive: a duplicate is preferable
 * to silently dropping listings.
 */
async function sendAll(
  send: (options: { content: string; allowedMentions: { parse: [] } }) => Promise<unknown>,
  messages: string[],
): Promise<void> {
  for (const content of messages) {
    await retryWithBackoff(() => send({ content, allowedMentions: { parse: [] } }), {
      attempts: 3,
      baseDelayMs: 1000,
      maxDelayMs: 8000,
    });
  }
}

async function deliverToChannel(
  client: Client,
  server: ServerRow,
  messages: string[],
): Promise<boolean> {
  if (!server.adminChannelId) {
    return false;
  }
  try {
    const channel = (await client.channels.fetch(server.adminChannelId)) as TextChannel | null;
    if (!channel || !channel.isTextBased() || !channel.isSendable()) {
      return false;
    }
    await sendAll((options) => channel.send(options), messages);
    return true;
  } catch {
    return false;
  }
}

async function deliverToDm(
  client: Client,
  server: ServerRow,
  messages: string[],
): Promise<boolean> {
  if (!server.digestDmUserId) {
    return false;
  }
  try {
    const user = (await client.users.fetch(server.digestDmUserId)) as User | null;
    if (!user) {
      return false;
    }
    await sendAll((options) => user.send(options), messages);
    return true;
  } catch {
    return false;
  }
}

function logDigest(
  serverId: string,
  trigger: DigestTrigger,
  included: ListingRow[],
  results: { channel: boolean; dm: boolean },
): void {
  const db = getDb();
  db.insert(digestLog)
    .values({
      serverId,
      sentAt: now(),
      trigger,
      listingCount: included.length,
      listingIdsIncluded: JSON.stringify(included.map((l) => l.id)),
      deliveryResults: JSON.stringify(results),
    })
    .run();
}
