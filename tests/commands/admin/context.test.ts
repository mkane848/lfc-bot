import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ensureConfig, requireGuild } from '../../../src/commands/admin/context.js';
import { getServerConfig, upsertServerConfig } from '../../../src/services/digest-state.js';
import { replyError } from '../../../src/utils/replies.js';
import {
  fakeChatInputInteraction,
  type FakeChatInputInteraction,
} from '../../helpers/interaction.js';
import { setupTestDb } from '../../helpers/db.js';
import { servers } from '../../../src/db/schema.js';
import { getDb } from '../../../src/db/index.js';

vi.mock('../../../src/services/digest-state.js', () => ({
  getServerConfig: vi.fn(),
  upsertServerConfig: vi.fn(),
}));

vi.mock('../../../src/utils/replies.js', () => ({
  replyError: vi.fn(),
}));

const mockedGetServerConfig = vi.mocked(getServerConfig);
const mockedUpsertServerConfig = vi.mocked(upsertServerConfig);
const mockedReplyError = vi.mocked(replyError);

setupTestDb();

beforeEach(() => {
  mockedGetServerConfig.mockReset();
  mockedUpsertServerConfig.mockReset();
  mockedReplyError.mockReset();
  getDb().delete(servers).run();
});

describe('requireGuild', () => {
  it('returns the guild id when the interaction is inside a guild', () => {
    const i = fakeChatInputInteraction({ guildId: 'guild-1' });
    expect(requireGuild(i)).toBe('guild-1');
    expect(mockedReplyError).not.toHaveBeenCalled();
  });

  it('replies ephemerally and returns null when the interaction has no guild', () => {
    const i = fakeChatInputInteraction({ guildId: null }) as FakeChatInputInteraction;
    expect(requireGuild(i)).toBeNull();
    expect(mockedReplyError).toHaveBeenCalledTimes(1);
    expect(mockedReplyError.mock.calls[0]![1]).toMatch(/inside a server/);
  });

  it('replies ephemerally and returns null when inGuild() reports false even if guild is set', () => {
    const i = fakeChatInputInteraction({ guildId: 'guild-1' }) as FakeChatInputInteraction;
    (i as unknown as { inGuild: () => boolean }).inGuild = vi.fn(() => false);
    expect(requireGuild(i)).toBeNull();
    expect(mockedReplyError).toHaveBeenCalledTimes(1);
  });
});

describe('ensureConfig', () => {
  it('returns the existing config when one is already present', () => {
    const existing = { id: 'guild-1' } as never;
    mockedGetServerConfig.mockReturnValue(existing);

    const result = ensureConfig('guild-1');

    expect(result).toBe(existing);
    expect(mockedUpsertServerConfig).not.toHaveBeenCalled();
  });

  it('creates and returns a default config when none exists', () => {
    mockedGetServerConfig.mockReturnValue(undefined);
    const created = { id: 'guild-1' } as never;
    mockedUpsertServerConfig.mockReturnValue(created);

    const result = ensureConfig('guild-1');

    expect(mockedUpsertServerConfig).toHaveBeenCalledWith({ serverId: 'guild-1' });
    expect(result).toBe(created);
  });
});
