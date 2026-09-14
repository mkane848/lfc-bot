import { describe, expect, it } from 'vitest';
import { helpCommand } from '../../../src/commands/user/help.js';
import { fakeChatInputInteraction } from '../../helpers/interaction.js';

describe('/help', () => {
  it('replies with an ephemeral help embed', async () => {
    const i = fakeChatInputInteraction({});

    await helpCommand.execute(i);

    expect(i.reply).toHaveBeenCalledWith(
      expect.objectContaining({ embeds: expect.any(Array), ephemeral: true }),
    );
    const call = i.reply.mock.calls[0]?.[0] as { embeds: { data: { fields?: unknown[] } }[] };
    const fields = (call.embeds[0].data.fields ?? []) as Array<{ name: string; value: string }>;
    const listingField = fields.find((field) => field.name === 'Post a listing');
    expect(listingField?.value).toContain('/have-sealed');
    expect(listingField?.value).toContain('/want-sealed');
  });
});
