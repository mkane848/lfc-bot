import type { Interaction } from 'discord.js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { commandMap } from '../../src/commands/index.js';
import { handleInteractionCreate } from '../../src/events/interactionCreate.js';
import { sendCriticalAlert } from '../../src/services/alerts.js';
import type { GuildCommand } from '../../src/types/index.js';

vi.mock('../../src/services/alerts.js', () => ({ sendCriticalAlert: vi.fn() }));

const alert = vi.mocked(sendCriticalAlert);

/** Register a throwaway command for the router to dispatch to. */
function registerFailingCommand(): void {
  commandMap.set('explode', {
    name: 'explode',
    execute: () => Promise.reject(new Error('command failed')),
    autocomplete: () => Promise.reject(new Error('Unknown interaction')),
  } as unknown as GuildCommand);
}

function fakeInteraction(kind: 'autocomplete' | 'chatInput'): Interaction {
  return {
    commandName: 'explode',
    user: { id: 'user-1' },
    guildId: 'guild-1',
    replied: false,
    deferred: false,
    isAutocomplete: () => kind === 'autocomplete',
    isButton: () => false,
    isStringSelectMenu: () => false,
    isModalSubmit: () => false,
    isChatInputCommand: () => kind === 'chatInput',
    isRepliable: () => kind === 'chatInput',
    reply: vi.fn().mockResolvedValue(undefined),
  } as unknown as Interaction;
}

beforeEach(() => {
  alert.mockReset();
  registerFailingCommand();
});

afterEach(() => {
  commandMap.delete('explode');
});

describe('handleInteractionCreate', () => {
  it('logs a failed autocomplete without sending a critical alert', async () => {
    await expect(handleInteractionCreate(fakeInteraction('autocomplete'))).resolves.toBeUndefined();

    expect(alert).not.toHaveBeenCalled();
  });

  it('still sends a critical alert when a command itself fails', async () => {
    await handleInteractionCreate(fakeInteraction('chatInput'));

    expect(alert).toHaveBeenCalledWith(
      'Unhandled interaction error in /explode',
      expect.any(Error),
    );
  });
});
