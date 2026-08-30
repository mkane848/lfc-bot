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
  });
});
