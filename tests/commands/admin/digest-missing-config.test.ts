import { describe, expect, it, vi } from 'vitest';
import { execute } from '../../../src/commands/admin/digest.js';
import { fakeChatInputInteraction } from '../../helpers/interaction.js';

// `ensureConfig` normally guarantees a row exists, so the missing-config branch
// only runs if the read fails anyway. Mocking the state module is the only way
// to reach it without a torn database.
vi.mock('../../../src/services/digest-state.js', () => ({
  getServerConfig: vi.fn(() => undefined),
  upsertServerConfig: vi.fn(),
}));

vi.mock('../../../src/services/digest.js', () => ({ runDigest: vi.fn() }));

describe('/admin digest without a config row', () => {
  it('reports the missing configuration instead of running the digest', async () => {
    const i = fakeChatInputInteraction({});

    await execute(i);

    expect(i.reply).toHaveBeenCalledWith(
      expect.objectContaining({ content: expect.stringContaining('configuration is missing') }),
    );
  });
});
