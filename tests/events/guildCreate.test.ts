import { beforeEach, describe, expect, it, vi } from 'vitest';
import { handleGuildCreate } from '../../src/events/guildCreate.js';
import { upsertServerConfig } from '../../src/services/digest-state.js';
import { clearRemovalMarker } from '../../src/services/listing-expiry.js';
import { getLogger } from '../../src/utils/logger.js';
import { setupTestDb } from '../helpers/db.js';
import { getDb } from '../../src/db/index.js';
import { servers } from '../../src/db/schema.js';

vi.mock('../../src/services/digest-state.js', () => ({
  upsertServerConfig: vi.fn(),
}));

vi.mock('../../src/services/listing-expiry.js', () => ({
  clearRemovalMarker: vi.fn(),
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

const mockedUpsert = vi.mocked(upsertServerConfig);
const mockedClearRemoval = vi.mocked(clearRemovalMarker);
const mockedGetLogger = vi.mocked(getLogger);

setupTestDb();

beforeEach(() => {
  mockedUpsert.mockReset();
  mockedClearRemoval.mockReset();
  mockedGetLogger.mockClear();
  // Wipe any servers between tests so upsertServerConfig stays a function-mock assertion.
  getDb().delete(servers).run();
});

describe('handleGuildCreate', () => {
  it('logs, clears any prior removal marker, and upserts a default server config row', () => {
    const guild = { id: 'guild-1', name: 'Test Guild' } as never;

    handleGuildCreate(guild);

    expect(mockedGetLogger).toHaveBeenCalledTimes(1);
    const logger = mockedGetLogger.mock.results[0]!.value as {
      info: ReturnType<typeof vi.fn>;
    };
    expect(logger.info).toHaveBeenCalledTimes(1);
    const firstCall = logger.info.mock.calls[0]![0] as string;
    expect(firstCall).toContain('Joined guild guild-1');
    expect(firstCall).toContain('Test Guild');

    expect(mockedClearRemoval).toHaveBeenCalledWith('guild-1');
    expect(mockedUpsert).toHaveBeenCalledWith({ serverId: 'guild-1' });
  });
});
