import { describe, expect, it } from 'vitest';
import type { EmbedBuilder } from 'discord.js';
import { getDb } from '../../../src/db/index.js';
import { servers, type NewServerRow } from '../../../src/db/schema.js';
import { execute as configExecute } from '../../../src/commands/admin/config.js';
import { fakeChatInputInteraction } from '../../helpers/interaction.js';
import { setupTestDb } from '../../helpers/db.js';

setupTestDb();

function embedFields(i: ReturnType<typeof fakeChatInputInteraction>) {
  const call = i.reply.mock.calls[0]?.[0] as { embeds: EmbedBuilder[] };
  return call.embeds[0]!.toJSON();
}

describe('/admin config', () => {
  it('shows the default (unconfigured) state, creating a default server row', async () => {
    const i = fakeChatInputInteraction({ options: { subcommand: 'config' } });

    await configExecute(i);

    const embed = embedFields(i);
    expect(embed.fields?.find((f) => f.name === 'Mode')?.value).toBe('Disabled');
    expect(embed.fields?.find((f) => f.name === 'Channel')?.value).toBe('Not set');
    expect(embed.fields?.find((f) => f.name === 'DM target')?.value).toBe('Not set');
    expect(getDb().select().from(servers).all()).toHaveLength(1);
  });

  it('shows a configured state for non-default fields', async () => {
    const row: NewServerRow = {
      id: 'guild-1',
      digestMode: 'channel',
      digestCron: '0 12 * * *',
      digestTimezone: 'America/New_York',
      enabledGames: '["mtg"]',
      adminChannelId: 'channel-1',
      digestDmUserId: null,
      lastDigestAt: null,
      removedAt: null,
      createdAt: 1,
      updatedAt: 1,
    };
    getDb().insert(servers).values(row).run();
    const i = fakeChatInputInteraction({ options: { subcommand: 'config' } });

    await configExecute(i);

    const embed = embedFields(i);
    expect(embed.fields?.find((f) => f.name === 'Channel')?.value).toBe('<#channel-1>');
    expect(embed.fields?.find((f) => f.name === 'Timezone')?.value).toBe('America/New_York');
  });

  it('renders the active-mode hint when digest mode is enabled', async () => {
    getDb()
      .insert(servers)
      .values({
        id: 'guild-1',
        digestMode: 'channel',
        digestCron: '0 9 * * *',
        digestTimezone: 'UTC',
        enabledGames: '["mtg"]',
        adminChannelId: 'channel-1',
        digestDmUserId: null,
        lastDigestAt: null,
        removedAt: null,
        createdAt: 1,
        updatedAt: 1,
      })
      .run();
    const i = fakeChatInputInteraction({ options: { subcommand: 'config' } });

    await configExecute(i);

    const embed = embedFields(i);
    const footer = (embed.footer as { text?: string } | undefined)?.text ?? '';
    expect(footer).toMatch(/active in.+Channel/);
  });

  it('renders the disabled-mode hint when digest mode is disabled', async () => {
    getDb()
      .insert(servers)
      .values({
        id: 'guild-1',
        digestMode: 'disabled',
        digestCron: '0 9 * * *',
        digestTimezone: 'UTC',
        enabledGames: '["mtg"]',
        adminChannelId: null,
        digestDmUserId: null,
        lastDigestAt: null,
        removedAt: null,
        createdAt: 1,
        updatedAt: 1,
      })
      .run();
    const i = fakeChatInputInteraction({ options: { subcommand: 'config' } });

    await configExecute(i);

    const embed = embedFields(i);
    const footer = (embed.footer as { text?: string } | undefined)?.text ?? '';
    expect(footer).toMatch(/To enable the daily digest/);
  });

  it('falls back to the raw mode label when not in the label map', async () => {
    getDb()
      .insert(servers)
      .values({
        id: 'guild-1',
        digestMode: 'unknown-mode',
        digestCron: '0 9 * * *',
        digestTimezone: 'UTC',
        enabledGames: '["mtg"]',
        adminChannelId: null,
        digestDmUserId: null,
        lastDigestAt: null,
        removedAt: null,
        createdAt: 1,
        updatedAt: 1,
      })
      .run();
    const i = fakeChatInputInteraction({ options: { subcommand: 'config' } });

    await configExecute(i);

    const embed = embedFields(i);
    expect(embed.fields?.find((f) => f.name === 'Mode')?.value).toBe('unknown-mode');
  });

  it('renders the DM target when set', async () => {
    getDb()
      .insert(servers)
      .values({
        id: 'guild-1',
        digestMode: 'dm',
        digestCron: '0 9 * * *',
        digestTimezone: 'UTC',
        enabledGames: '["mtg"]',
        adminChannelId: null,
        digestDmUserId: 'dm-user-1',
        lastDigestAt: null,
        removedAt: null,
        createdAt: 1,
        updatedAt: 1,
      })
      .run();
    const i = fakeChatInputInteraction({ options: { subcommand: 'config' } });

    await configExecute(i);

    const embed = embedFields(i);
    expect(embed.fields?.find((f) => f.name === 'DM target')?.value).toBe('<@dm-user-1>');
  });

  it('falls back to "none" when enabledGames is empty', async () => {
    getDb()
      .insert(servers)
      .values({
        id: 'guild-1',
        digestMode: 'channel',
        digestCron: '0 9 * * *',
        digestTimezone: 'UTC',
        enabledGames: '[]',
        adminChannelId: null,
        digestDmUserId: null,
        lastDigestAt: null,
        removedAt: null,
        createdAt: 1,
        updatedAt: 1,
      })
      .run();
    const i = fakeChatInputInteraction({ options: { subcommand: 'config' } });

    await configExecute(i);

    const embed = embedFields(i);
    expect(embed.fields?.find((f) => f.name === 'Enabled games')?.value).toBe('none');
  });

  it('replies ephemerally and bails when the interaction is outside a guild', async () => {
    const i = fakeChatInputInteraction({ guildId: null, options: { subcommand: 'config' } });

    await configExecute(i);

    expect(i.reply).toHaveBeenCalledWith(
      expect.objectContaining({ content: expect.stringContaining('inside a server') }),
    );
  });
});
