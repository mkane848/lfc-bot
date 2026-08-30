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
});
