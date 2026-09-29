import { beforeEach, describe, expect, it, vi } from 'vitest';
import { handleInteractionCreate } from '../../src/events/interactionCreate.js';
import { commandMap } from '../../src/commands/index.js';
import {
  handleBatchSelect,
  handleListingButton,
} from '../../src/commands/user/mylistings.js';
import {
  handleEditModal,
  handleEditNextButton,
} from '../../src/commands/user/edit.js';
import { handleHaveMultiModal } from '../../src/commands/user/have-multi.js';
import { handleWantMultiModal } from '../../src/commands/user/want-multi.js';
import {
  EDIT_MODAL_KIND,
  EDIT_NEXT_KIND,
  HAVE_MULTI_MODAL_ID,
  WANT_MULTI_MODAL_ID,
} from '../../src/utils/customId.js';
import { getLogger } from '../../src/utils/logger.js';
import { sendCriticalAlert } from '../../src/services/alerts.js';

vi.mock('../../src/commands/index.js', () => ({
  commandMap: new Map(),
}));

vi.mock('../../src/commands/user/mylistings.js', () => ({
  handleBatchSelect: vi.fn(),
  handleListingButton: vi.fn(),
}));

vi.mock('../../src/commands/user/edit.js', () => ({
  handleEditModal: vi.fn(),
  handleEditNextButton: vi.fn(),
}));

vi.mock('../../src/commands/user/have-multi.js', () => ({
  handleHaveMultiModal: vi.fn(),
}));

vi.mock('../../src/commands/user/want-multi.js', () => ({
  handleWantMultiModal: vi.fn(),
}));

vi.mock('../../src/utils/logger.js', () => ({
  getLogger: vi.fn(() => ({
    child: vi.fn().mockReturnValue({
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    }),
  })),
}));

vi.mock('../../src/services/alerts.js', () => ({
  sendCriticalAlert: vi.fn(),
}));

const mockedCommandMap = vi.mocked(commandMap);
const mockedHandleBatchSelect = vi.mocked(handleBatchSelect);
const mockedHandleListingButton = vi.mocked(handleListingButton);
const mockedHandleEditModal = vi.mocked(handleEditModal);
const mockedHandleEditNextButton = vi.mocked(handleEditNextButton);
const mockedHandleHaveMultiModal = vi.mocked(handleHaveMultiModal);
const mockedHandleWantMultiModal = vi.mocked(handleWantMultiModal);
const mockedSendCriticalAlert = vi.mocked(sendCriticalAlert);

interface FakeInteractionInit {
  kind: 'autocomplete' | 'button' | 'select' | 'modal' | 'chatInput' | 'ping';
  customId?: string;
  commandName?: string;
  replied?: boolean;
  deferred?: boolean;
  repliable?: boolean;
}

function fakeInteraction(init: FakeInteractionInit): Record<string, unknown> {
  const repliable = init.repliable ?? true;
  const flags = {
    autocomplete: init.kind === 'autocomplete',
    button: init.kind === 'button',
    select: init.kind === 'select',
    modal: init.kind === 'modal',
    chat: init.kind === 'chatInput',
  };
  const base: Record<string, unknown> = {
    commandName: init.commandName ?? 'unknown',
    customId: init.customId ?? '',
    user: { id: 'user-1' },
    guildId: 'guild-1',
    isAutocomplete: () => flags.autocomplete,
    isButton: () => flags.button,
    isStringSelectMenu: () => flags.select,
    isModalSubmit: () => flags.modal,
    isChatInputCommand: () => flags.chat,
    isRepliable: () => repliable,
    replied: init.replied ?? false,
    deferred: init.deferred ?? false,
  };
  if (repliable) {
    base.reply = vi.fn().mockResolvedValue(undefined);
    base.followUp = vi.fn().mockResolvedValue(undefined);
    base.editReply = vi.fn().mockResolvedValue(undefined);
  }
  return base;
}

beforeEach(() => {
  mockedCommandMap.clear();
  mockedHandleBatchSelect.mockReset();
  mockedHandleListingButton.mockReset();
  mockedHandleEditModal.mockReset();
  mockedHandleEditNextButton.mockReset();
  mockedHandleHaveMultiModal.mockReset();
  mockedHandleWantMultiModal.mockReset();
  mockedSendCriticalAlert.mockReset();
});

describe('handleInteractionCreate (autocomplete)', () => {
  it('invokes the registered command autocomplete handler', async () => {
    const autocomplete = vi.fn().mockResolvedValue(undefined);
    mockedCommandMap.set('have', { name: 'have', autocomplete } as never);

    const i = fakeInteraction({ kind: 'autocomplete', commandName: 'have' });
    await handleInteractionCreate(i as never);

    expect(autocomplete).toHaveBeenCalledWith(i);
  });

  it('returns silently when the command is not in the map', async () => {
    const i = fakeInteraction({ kind: 'autocomplete', commandName: 'nope' });
    await handleInteractionCreate(i as never);
    // No assertion on handler call -- there is none -- just confirm it didn't throw.
  });

  it('returns silently when the command exists but has no autocomplete handler', async () => {
    mockedCommandMap.set('help', {
      name: 'help',
      execute: vi.fn(),
    } as never);

    const i = fakeInteraction({ kind: 'autocomplete', commandName: 'help' });
    await expect(handleInteractionCreate(i as never)).resolves.toBeUndefined();
  });
});

describe('handleInteractionCreate (button)', () => {
  it('routes edit-next customIds to handleEditNextButton', async () => {
    const i = fakeInteraction({
      kind: 'button',
      customId: `lfc:${EDIT_NEXT_KIND}:42`,
    });

    await handleInteractionCreate(i as never);

    expect(mockedHandleEditNextButton).toHaveBeenCalledWith(i);
    expect(mockedHandleListingButton).not.toHaveBeenCalled();
  });

  it('routes other button customIds to handleListingButton', async () => {
    const i = fakeInteraction({
      kind: 'button',
      customId: 'lfc:fulfill:7',
    });

    await handleInteractionCreate(i as never);

    expect(mockedHandleListingButton).toHaveBeenCalledWith(i);
    expect(mockedHandleEditNextButton).not.toHaveBeenCalled();
  });
});

describe('handleInteractionCreate (string select menu)', () => {
  it('dispatches to handleBatchSelect', async () => {
    const i = fakeInteraction({ kind: 'select', customId: 'lfc:batchdelete' });

    await handleInteractionCreate(i as never);

    expect(mockedHandleBatchSelect).toHaveBeenCalledWith(i);
  });
});

describe('handleInteractionCreate (modal submit)', () => {
  it('routes edit-modal customIds to handleEditModal', async () => {
    const i = fakeInteraction({
      kind: 'modal',
      customId: `lfc:${EDIT_MODAL_KIND}:9`,
    });

    await handleInteractionCreate(i as never);

    expect(mockedHandleEditModal).toHaveBeenCalledWith(i);
    expect(mockedHandleHaveMultiModal).not.toHaveBeenCalled();
    expect(mockedHandleWantMultiModal).not.toHaveBeenCalled();
  });

  it('routes have-multi modal ids (with kind segments) to handleHaveMultiModal', async () => {
    const i = fakeInteraction({
      kind: 'modal',
      customId: `${HAVE_MULTI_MODAL_ID}:card`,
    });

    await handleInteractionCreate(i as never);

    expect(mockedHandleHaveMultiModal).toHaveBeenCalledWith(i);
    expect(mockedHandleEditModal).not.toHaveBeenCalled();
    expect(mockedHandleWantMultiModal).not.toHaveBeenCalled();
  });

  it('routes want-multi modal ids (with kind segments) to handleWantMultiModal', async () => {
    const i = fakeInteraction({
      kind: 'modal',
      customId: `${WANT_MULTI_MODAL_ID}:sealed`,
    });

    await handleInteractionCreate(i as never);

    expect(mockedHandleWantMultiModal).toHaveBeenCalledWith(i);
    expect(mockedHandleHaveMultiModal).not.toHaveBeenCalled();
  });

  it('routes a bare have-multi modal id (no kind segment, pre-encoding legacy) to handleHaveMultiModal too', async () => {
    const i = fakeInteraction({
      kind: 'modal',
      customId: HAVE_MULTI_MODAL_ID,
    });

    await handleInteractionCreate(i as never);

    expect(mockedHandleHaveMultiModal).toHaveBeenCalledWith(i);
    expect(mockedHandleWantMultiModal).not.toHaveBeenCalled();
  });

  it('returns silently for an unrecognized modal customId', async () => {
    const i = fakeInteraction({ kind: 'modal', customId: 'something:else:42' });
    await expect(handleInteractionCreate(i as never)).resolves.toBeUndefined();
    expect(mockedHandleEditModal).not.toHaveBeenCalled();
    expect(mockedHandleHaveMultiModal).not.toHaveBeenCalled();
    expect(mockedHandleWantMultiModal).not.toHaveBeenCalled();
  });
});

describe('handleInteractionCreate (chat input command)', () => {
  it('executes the registered command', async () => {
    const execute = vi.fn().mockResolvedValue(undefined);
    mockedCommandMap.set('have', { name: 'have', execute } as never);

    const i = fakeInteraction({ kind: 'chatInput', commandName: 'have' });
    await handleInteractionCreate(i as never);

    expect(execute).toHaveBeenCalledWith(i);
  });

  it('replies ephemerally with "Unknown command." when the command is not in the map', async () => {
    const i = fakeInteraction({ kind: 'chatInput', commandName: 'nope' }) as {
      reply: ReturnType<typeof vi.fn>;
    };
    await handleInteractionCreate(i as never);

    expect(i.reply).toHaveBeenCalledWith({
      content: 'Unknown command.',
      ephemeral: true,
    });
  });
});

describe('handleInteractionCreate (non-routed interaction)', () => {
  it('returns silently for ping-like interactions that match none of the recognised kinds', async () => {
    const i = fakeInteraction({ kind: 'ping' });
    await expect(handleInteractionCreate(i as never)).resolves.toBeUndefined();
  });
});

describe('handleInteractionCreate (error path)', () => {
  it('logs, alerts, and replySafes when any handler throws', async () => {
    const bomb = new Error('boom');
    const execute = vi.fn().mockRejectedValue(bomb);
    mockedCommandMap.set('have', { name: 'have', execute } as never);

    const i = fakeInteraction({
      kind: 'chatInput',
      commandName: 'have',
    }) as { reply: ReturnType<typeof vi.fn>; followUp: ReturnType<typeof vi.fn> };

    await handleInteractionCreate(i as never);

    expect(execute).toHaveBeenCalled();
    expect(mockedSendCriticalAlert).toHaveBeenCalledWith(
      expect.stringContaining('Unhandled interaction error in /have'),
      bomb,
    );
    expect(i.reply).toHaveBeenCalledWith({
      content: 'Something went wrong. Please try again.',
      ephemeral: true,
    });
  });

  it('replySafe uses followUp when the interaction has already replied', async () => {
    const bomb = new Error('boom');
    const execute = vi.fn().mockRejectedValue(bomb);
    mockedCommandMap.set('have', { name: 'have', execute } as never);

    const i = fakeInteraction({
      kind: 'chatInput',
      commandName: 'have',
      replied: true,
    }) as {
      reply: ReturnType<typeof vi.fn>;
      followUp: ReturnType<typeof vi.fn>;
    };

    await handleInteractionCreate(i as never);

    expect(i.reply).not.toHaveBeenCalled();
    expect(i.followUp).toHaveBeenCalledWith({
      content: 'Something went wrong. Please try again.',
      ephemeral: true,
    });
  });

  it('replySafe uses followUp when the interaction has already deferred', async () => {
    const bomb = new Error('boom');
    const execute = vi.fn().mockRejectedValue(bomb);
    mockedCommandMap.set('have', { name: 'have', execute } as never);

    const i = fakeInteraction({
      kind: 'chatInput',
      commandName: 'have',
      deferred: true,
    }) as {
      reply: ReturnType<typeof vi.fn>;
      followUp: ReturnType<typeof vi.fn>;
    };

    await handleInteractionCreate(i as never);

    expect(i.reply).not.toHaveBeenCalled();
    expect(i.followUp).toHaveBeenCalledWith({
      content: 'Something went wrong. Please try again.',
      ephemeral: true,
    });
  });

  it('replySafe no-ops silently on non-repliable interactions', async () => {
    const bomb = new Error('boom');
    const execute = vi.fn().mockRejectedValue(bomb);
    mockedCommandMap.set('have', { name: 'have', execute } as never);

    const i = fakeInteraction({
      kind: 'chatInput',
      commandName: 'have',
      repliable: false,
    });

    await expect(handleInteractionCreate(i as never)).resolves.toBeUndefined();

    expect(mockedSendCriticalAlert).toHaveBeenCalled();
    // The non-repliable interaction has no reply/followUp methods at all --
    // replySafe returns immediately so nothing on `i` could have been called.
    expect(i.reply).toBeUndefined();
    expect(i.followUp).toBeUndefined();
  });
});

describe('handleInteractionCreate (logger wiring)', () => {
  it('produces a child logger with the traceId and user/guild context', async () => {
    const mockedGetLogger = vi.mocked(getLogger);
    await handleInteractionCreate(
      fakeInteraction({ kind: 'chatInput', commandName: 'have' }) as never,
    );

    expect(mockedGetLogger).toHaveBeenCalledTimes(1);
    const logger = mockedGetLogger.mock.results[0]!.value as {
      child: ReturnType<typeof vi.fn>;
    };
    expect(logger.child).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'user-1',
        guildId: 'guild-1',
        traceId: expect.stringMatching(/^[0-9a-f-]{36}$/i),
      }),
    );
  });
});
