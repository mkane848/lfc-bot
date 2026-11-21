import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { closeDb } from '../src/db/index.js';
import { runMigrations } from '../src/db/migrate.js';
import { deployCommands } from '../src/deploy.js';
import { handleGuildCreate } from '../src/events/guildCreate.js';
import { handleGuildDelete } from '../src/events/guildDelete.js';
import { handleInteractionCreate } from '../src/events/interactionCreate.js';
import { handleReady } from '../src/events/ready.js';
import { sendCriticalAlert } from '../src/services/alerts.js';
import { startHealthServer } from '../src/services/health.js';
import { stopAllJobs } from '../src/services/scheduler.js';
import { getLogger } from '../src/utils/logger.js';

type Handler = (...args: unknown[]) => unknown;

interface FakeClient {
  login: ReturnType<typeof vi.fn>;
  destroy: ReturnType<typeof vi.fn>;
}

interface Harness {
  handlers: Map<string, Handler>;
  clientOptions: unknown;
  client: FakeClient | null;
  healthServer: { close: ReturnType<typeof vi.fn> };
  logger: {
    info: ReturnType<typeof vi.fn>;
    warn: ReturnType<typeof vi.fn>;
    error: ReturnType<typeof vi.fn>;
    debug: ReturnType<typeof vi.fn>;
  };
  exits: Array<number | undefined>;
  throwOnFirstExit: boolean;
  loginError: Error | null;
}

const h = vi.hoisted<Harness>(() => ({
  handlers: new Map<string, Handler>(),
  clientOptions: undefined,
  client: null,
  healthServer: { close: vi.fn() },
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
  exits: [],
  throwOnFirstExit: false,
  loginError: null,
}));

vi.mock('dotenv/config', () => ({}));

vi.mock('discord.js', () => {
  class Client {
    handlers = new Map<string, Handler>();
    options: unknown;
    login = vi.fn(() =>
      h.loginError === null ? Promise.resolve('logged-in') : Promise.reject(h.loginError),
    );
    destroy = vi.fn().mockResolvedValue(undefined);

    constructor(options: unknown) {
      this.options = options;
      h.clientOptions = options;
      h.client = this;
    }

    on = vi.fn((event: string, handler: Handler) => {
      this.handlers.set(event, handler);
      h.handlers.set(event, handler);
      return this;
    });

    once = vi.fn((event: string, handler: Handler) => {
      this.handlers.set(event, handler);
      h.handlers.set(event, handler);
      return this;
    });
  }

  return {
    Client,
    Events: {
      ClientReady: 'ready',
      InteractionCreate: 'interactionCreate',
      GuildCreate: 'guildCreate',
      GuildDelete: 'guildDelete',
      Error: 'error',
    },
    GatewayIntentBits: { Guilds: 1 },
  };
});

vi.mock('../src/db/index.js', () => ({ closeDb: vi.fn() }));
vi.mock('../src/db/migrate.js', () => ({ runMigrations: vi.fn() }));
vi.mock('../src/deploy.js', () => ({ deployCommands: vi.fn().mockResolvedValue(undefined) }));
vi.mock('../src/events/ready.js', () => ({ handleReady: vi.fn() }));
vi.mock('../src/events/interactionCreate.js', () => ({ handleInteractionCreate: vi.fn() }));
vi.mock('../src/events/guildCreate.js', () => ({ handleGuildCreate: vi.fn() }));
vi.mock('../src/events/guildDelete.js', () => ({ handleGuildDelete: vi.fn() }));
vi.mock('../src/services/alerts.js', () => ({ sendCriticalAlert: vi.fn() }));
vi.mock('../src/services/health.js', () => ({
  startHealthServer: vi.fn(() => h.healthServer),
}));
vi.mock('../src/services/scheduler.js', () => ({ stopAllJobs: vi.fn() }));
vi.mock('../src/utils/logger.js', () => ({ getLogger: vi.fn(() => h.logger) }));

const mockRunMigrations = vi.mocked(runMigrations);
const mockCloseDb = vi.mocked(closeDb);
const mockDeployCommands = vi.mocked(deployCommands);
const mockHandleReady = vi.mocked(handleReady);
const mockHandleInteractionCreate = vi.mocked(handleInteractionCreate);
const mockHandleGuildCreate = vi.mocked(handleGuildCreate);
const mockHandleGuildDelete = vi.mocked(handleGuildDelete);
const mockSendCriticalAlert = vi.mocked(sendCriticalAlert);
const mockStartHealthServer = vi.mocked(startHealthServer);
const mockStopAllJobs = vi.mocked(stopAllJobs);
const mockGetLogger = vi.mocked(getLogger);

/** Importing `src/index.ts` runs the whole entrypoint, so reset the module each time. */
async function loadIndex(): Promise<void> {
  await import('../src/index.js');
  await new Promise((resolve) => setImmediate(resolve));
}

/** The fake `Client` the entrypoint constructed. */
function fakeClient(): FakeClient {
  if (!h.client) {
    throw new Error('the entrypoint never constructed a client');
  }
  return h.client;
}

beforeEach(() => {
  vi.resetModules();
  h.handlers.clear();
  h.clientOptions = undefined;
  h.client = null;
  h.exits = [];
  h.throwOnFirstExit = false;
  h.loginError = null;
  h.logger.info.mockClear();
  h.logger.warn.mockClear();
  h.logger.error.mockClear();
  h.healthServer.close.mockClear();
  mockRunMigrations.mockClear();
  mockCloseDb.mockClear();
  mockDeployCommands.mockReset();
  mockDeployCommands.mockResolvedValue(undefined);
  mockHandleReady.mockClear();
  mockHandleInteractionCreate.mockClear();
  mockHandleGuildCreate.mockClear();
  mockHandleGuildDelete.mockClear();
  mockSendCriticalAlert.mockClear();
  mockStartHealthServer.mockClear();
  mockStopAllJobs.mockClear();
  mockGetLogger.mockClear();

  vi.stubEnv('DISCORD_TOKEN', 'test-token');
  vi.stubEnv('DISCORD_CLIENT_ID', 'test-client-id');
  vi.stubEnv('DISCORD_GUILD_ID', '');

  vi.spyOn(process, 'on').mockImplementation(((event: string, handler: Handler) => {
    h.handlers.set(event, handler);
    return process;
  }) as unknown as typeof process.on);
  vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
    h.exits.push(code);
    if (h.throwOnFirstExit && h.exits.length === 1) {
      throw new Error('__process_exit__');
    }
    return undefined;
  }) as unknown as typeof process.exit);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('startup', () => {
  it('refuses to start without DISCORD_TOKEN or DISCORD_CLIENT_ID', async () => {
    vi.stubEnv('DISCORD_TOKEN', '');
    h.throwOnFirstExit = true;

    await loadIndex();

    expect(h.exits).toEqual([1, 1]);
    expect(h.logger.error).toHaveBeenCalledWith(
      expect.stringMatching(/DISCORD_TOKEN and DISCORD_CLIENT_ID are required/),
    );
    expect(mockRunMigrations).not.toHaveBeenCalled();
    expect(h.clientOptions).toBeUndefined();
  });

  it('migrates, starts the health server, wires every event, and logs in', async () => {
    await loadIndex();

    expect(mockRunMigrations).toHaveBeenCalledTimes(1);
    expect(h.clientOptions).toEqual({ intents: [1] });
    expect(mockStartHealthServer).toHaveBeenCalledTimes(1);
    expect(fakeClient().login).toHaveBeenCalledWith('test-token');

    for (const event of [
      'ready',
      'interactionCreate',
      'guildCreate',
      'guildDelete',
      'error',
      'unhandledRejection',
      'uncaughtException',
      'SIGINT',
      'SIGTERM',
    ]) {
      expect(h.handlers.has(event), `no handler registered for ${event}`).toBe(true);
    }
    expect(h.logger.info).toHaveBeenCalledWith('Bot is online');
  });
});

describe('on ready', () => {
  it('deploys commands, then prepares the bot', async () => {
    await loadIndex();
    const readyClient = { id: 'client-1' };

    h.handlers.get('ready')!(readyClient);
    await new Promise((resolve) => setImmediate(resolve));

    expect(mockDeployCommands).toHaveBeenCalledWith(readyClient);
    expect(mockHandleReady).toHaveBeenCalledWith(readyClient);
  });

  it('logs a failed deploy without running the ready handler', async () => {
    mockDeployCommands.mockRejectedValue(new Error('deploy failed'));
    await loadIndex();
    const readyClient = { id: 'client-1' };

    h.handlers.get('ready')!(readyClient);
    await new Promise((resolve) => setImmediate(resolve));

    expect(mockHandleReady).not.toHaveBeenCalled();
    expect(h.logger.error).toHaveBeenCalledWith(
      expect.objectContaining({ err: expect.any(Error) }),
      'Failed to prepare on ready',
    );
  });
});

describe('dispatch and alerts', () => {
  it('forwards interactions and guild lifecycle events to their handlers', async () => {
    await loadIndex();
    const interaction = { id: 'interaction-1' };
    const guild = { id: 'guild-1' };

    await h.handlers.get('interactionCreate')!(interaction);
    h.handlers.get('guildCreate')!(guild);
    h.handlers.get('guildDelete')!(guild);

    expect(mockHandleInteractionCreate).toHaveBeenCalledWith(interaction);
    expect(mockHandleGuildCreate).toHaveBeenCalledWith(guild);
    expect(mockHandleGuildDelete).toHaveBeenCalledWith(guild);
  });

  it('alerts on a Discord client error', async () => {
    await loadIndex();
    const error = new Error('gateway dropped');

    h.handlers.get('error')!(error);

    expect(h.logger.error).toHaveBeenCalledWith({ err: error }, 'Discord client error');
    expect(mockSendCriticalAlert).toHaveBeenCalledWith('Discord client error', error);
  });

  it('alerts on an unhandled rejection', async () => {
    await loadIndex();
    const reason = new Error('nobody caught this');

    h.handlers.get('unhandledRejection')!(reason);

    expect(h.logger.error).toHaveBeenCalledWith({ err: reason }, 'Unhandled promise rejection');
    expect(mockSendCriticalAlert).toHaveBeenCalledWith('Unhandled promise rejection', reason);
  });

  it('alerts and exits on an uncaught exception', async () => {
    await loadIndex();
    const error = new Error('boom');

    h.handlers.get('uncaughtException')!(error);

    expect(mockSendCriticalAlert).toHaveBeenCalledWith('Uncaught exception', error);
    expect(h.exits).toEqual([1]);
    expect(mockStopAllJobs).not.toHaveBeenCalled();
  });

  it('reports a fatal startup error and exits when login fails', async () => {
    const error = new Error('invalid token');
    h.loginError = error;

    await loadIndex();

    expect(h.logger.error).toHaveBeenCalledWith({ err: error }, 'Fatal startup error');
    expect(mockSendCriticalAlert).toHaveBeenCalledWith('Fatal startup error', error);
    expect(h.exits).toEqual([1]);
  });
});

describe('shutdown', () => {
  it.each(['SIGINT', 'SIGTERM'])(
    'stops the jobs, closes the server and database, and exits on %s',
    async (signal) => {
      await loadIndex();
      const client = fakeClient();

      h.handlers.get(signal)!();

      expect(h.logger.info).toHaveBeenCalledWith(`Received ${signal}; shutting down`);
      expect(mockStopAllJobs).toHaveBeenCalledTimes(1);
      expect(h.healthServer.close).toHaveBeenCalledTimes(1);
      expect(client.destroy).toHaveBeenCalledTimes(1);
      expect(mockCloseDb).toHaveBeenCalledTimes(1);
      expect(h.exits).toEqual([0]);
    },
  );
});
