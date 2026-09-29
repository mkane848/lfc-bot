import { beforeEach, describe, expect, it, vi } from 'vitest';
import { handleGuildDelete } from '../../src/events/guildDelete.js';
import { markServerForRemoval } from '../../src/services/listing-expiry.js';
import { removeServerDigest } from '../../src/services/scheduler.js';
import { getServerConfig } from '../../src/services/digest-state.js';
import { getLogger } from '../../src/utils/logger.js';

vi.mock('../../src/services/listing-expiry.js', () => ({
  markServerForRemoval: vi.fn(),
}));

vi.mock('../../src/services/scheduler.js', () => ({
  removeServerDigest: vi.fn(),
}));

vi.mock('../../src/services/digest-state.js', () => ({
  getServerConfig: vi.fn(),
}));

vi.mock('../../src/utils/logger.js', () => ({
  getLogger: vi.fn(() => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    child: vi.fn().mockReturnValue({ info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() }),
  })),
}));

const mockedMarkForRemoval = vi.mocked(markServerForRemoval);
const mockedRemoveDigest = vi.mocked(removeServerDigest);
const mockedGetServerConfig = vi.mocked(getServerConfig);
const mockedGetLogger = vi.mocked(getLogger);

beforeEach(() => {
  mockedMarkForRemoval.mockReset();
  mockedRemoveDigest.mockReset();
  mockedGetServerConfig.mockReset();
  mockedGetLogger.mockClear();
});

describe('handleGuildDelete', () => {
  it('always removes the cron and only marks for removal when a server config exists', () => {
    mockedGetServerConfig.mockReturnValue({ id: 'guild-1' } as never);
    const guild = { id: 'guild-1', name: 'Test Guild' } as never;

    handleGuildDelete(guild);

    expect(mockedRemoveDigest).toHaveBeenCalledWith('guild-1');
    expect(mockedMarkForRemoval).toHaveBeenCalledWith('guild-1');
    const logger = mockedGetLogger.mock.results[0]!.value as {
      info: ReturnType<typeof vi.fn>;
    };
    expect(logger.info).toHaveBeenCalledTimes(1);
    expect(logger.info.mock.calls[0]![0]).toContain('Left guild guild-1');
  });

  it('does not mark a server for removal when no config row was ever created', () => {
    mockedGetServerConfig.mockReturnValue(undefined);
    const guild = { id: 'guild-fresh', name: 'Fresh' } as never;

    handleGuildDelete(guild);

    expect(mockedRemoveDigest).toHaveBeenCalledWith('guild-fresh');
    expect(mockedMarkForRemoval).not.toHaveBeenCalled();
  });
});
