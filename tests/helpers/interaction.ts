import { vi } from 'vitest';
import type {
  ButtonInteraction,
  ChatInputCommandInteraction,
  ModalSubmitInteraction,
  StringSelectMenuInteraction,
} from 'discord.js';

/**
 * Shared mock-building helpers for command/modal/button/select-menu
 * interactions, so each command test doesn't hand-roll its own discord.js
 * mocks. These are plain objects cast to the real discord.js types — only
 * the members each command handler actually touches are implemented.
 */

interface MockOptionsInit {
  strings?: Record<string, string | null>;
  integers?: Record<string, number | null>;
  booleans?: Record<string, boolean | null>;
  users?: Record<string, { id: string; username: string } | null>;
  channels?: Record<string, { id: string } | null>;
  subcommand?: string;
  /** Raw `options.data` shape, needed by /admin's summarizeOptions. */
  data?: Array<{ name: string; options?: Array<{ name: string; value: unknown }> }>;
  focused?: { name: string; value: string };
}

function buildOptions(init: MockOptionsInit = {}) {
  const required = (name: string, value: unknown, isRequired?: boolean) => {
    if (isRequired && (value === null || value === undefined)) {
      throw new Error(`Missing required option "${name}"`);
    }
    return value;
  };
  return {
    getString: vi.fn(
      (name: string, isRequired?: boolean) =>
        required(name, init.strings?.[name] ?? null, isRequired) as string | null,
    ),
    getInteger: vi.fn(
      (name: string, isRequired?: boolean) =>
        required(name, init.integers?.[name] ?? null, isRequired) as number | null,
    ),
    getBoolean: vi.fn(
      (name: string, isRequired?: boolean) =>
        required(name, init.booleans?.[name] ?? null, isRequired) as boolean | null,
    ),
    getUser: vi.fn((name: string, isRequired?: boolean) =>
      required(name, init.users?.[name] ?? null, isRequired),
    ),
    getChannel: vi.fn((name: string, isRequired?: boolean) =>
      required(name, init.channels?.[name] ?? null, isRequired),
    ),
    getSubcommand: vi.fn(() => init.subcommand ?? ''),
    getFocused: vi.fn((withDetails?: boolean) =>
      withDetails ? init.focused : (init.focused?.value ?? ''),
    ),
    data: init.data ?? [],
  };
}

interface FakeMember {
  permissions: { has: (perm: bigint) => boolean };
}

function fakeMember(bitfield: bigint | null): FakeMember | null {
  if (bitfield === null) {
    return null;
  }
  return { permissions: { has: (perm: bigint) => (bitfield & perm) === perm } };
}

export interface FakeChatInputInit {
  guildId?: string | null;
  userId?: string;
  username?: string;
  displayName?: string;
  /** Permission bitfield for `interaction.member` (GuildMember-shaped). Omit for no member. */
  memberPermissions?: bigint | null;
  /** Permission bitfield for the `interaction.memberPermissions` fallback. */
  rawMemberPermissions?: bigint | null;
  options?: MockOptionsInit;
  /** `interaction.client`, passed through to services like `refreshServerDigest`/`runDigest`. */
  client?: unknown;
}

export type FakeChatInputInteraction = ChatInputCommandInteraction & {
  reply: ReturnType<typeof vi.fn>;
  deferReply: ReturnType<typeof vi.fn>;
  editReply: ReturnType<typeof vi.fn>;
  followUp: ReturnType<typeof vi.fn>;
  showModal: ReturnType<typeof vi.fn>;
};

/** Build a mock `ChatInputCommandInteraction` covering everything the command handlers read. */
export function fakeChatInputInteraction(init: FakeChatInputInit = {}): FakeChatInputInteraction {
  const guildId = init.guildId === undefined ? 'guild-1' : init.guildId;
  const state = { deferred: false };
  const interaction = {
    guildId,
    guild: guildId ? { id: guildId } : null,
    inGuild: vi.fn(() => guildId !== null),
    client: init.client ?? {},
    user: {
      id: init.userId ?? 'user-1',
      username: init.username ?? 'alice',
      displayName: init.displayName ?? init.username ?? 'alice',
    },
    member: fakeMember(init.memberPermissions ?? null),
    memberPermissions:
      init.rawMemberPermissions !== undefined && init.rawMemberPermissions !== null
        ? { has: (perm: bigint) => (init.rawMemberPermissions! & perm) === perm }
        : null,
    options: buildOptions(init.options),
    reply: vi.fn().mockResolvedValue(undefined),
    deferReply: vi.fn().mockImplementation(() => {
      state.deferred = true;
    }),
    editReply: vi.fn().mockResolvedValue(undefined),
    followUp: vi.fn().mockResolvedValue(undefined),
    showModal: vi.fn().mockResolvedValue(undefined),
    get deferred() {
      return state.deferred;
    },
  };
  return interaction as unknown as FakeChatInputInteraction;
}

export interface FakeModalSubmitInit {
  customId: string;
  guildId?: string | null;
  userId?: string;
  username?: string;
  fields?: Record<string, string>;
}

export type FakeModalSubmitInteraction = ModalSubmitInteraction & {
  reply: ReturnType<typeof vi.fn>;
  deferReply: ReturnType<typeof vi.fn>;
  editReply: ReturnType<typeof vi.fn>;
  followUp: ReturnType<typeof vi.fn>;
};

/** Build a mock `ModalSubmitInteraction` for a modal handler under test. */
export function fakeModalSubmitInteraction(init: FakeModalSubmitInit): FakeModalSubmitInteraction {
  const guildId = init.guildId === undefined ? 'guild-1' : init.guildId;
  const state = { deferred: false };
  const interaction = {
    customId: init.customId,
    guildId,
    guild: guildId ? { id: guildId } : null,
    inGuild: vi.fn(() => guildId !== null),
    user: {
      id: init.userId ?? 'user-1',
      username: init.username ?? 'alice',
      displayName: init.username ?? 'alice',
    },
    fields: {
      getTextInputValue: vi.fn((name: string) => init.fields?.[name] ?? ''),
    },
    reply: vi.fn().mockResolvedValue(undefined),
    deferReply: vi.fn().mockImplementation(() => {
      state.deferred = true;
    }),
    editReply: vi.fn().mockResolvedValue(undefined),
    followUp: vi.fn().mockResolvedValue(undefined),
    get deferred() {
      return state.deferred;
    },
  };
  return interaction as unknown as FakeModalSubmitInteraction;
}

export interface FakeButtonInit {
  customId: string;
  userId?: string;
  username?: string;
}

export type FakeButtonInteraction = ButtonInteraction & {
  reply: ReturnType<typeof vi.fn>;
  showModal: ReturnType<typeof vi.fn>;
};

/** Build a mock `ButtonInteraction` for a component-button handler under test. */
export function fakeButtonInteraction(init: FakeButtonInit): FakeButtonInteraction {
  const interaction = {
    customId: init.customId,
    user: { id: init.userId ?? 'user-1', username: init.username ?? 'alice' },
    reply: vi.fn().mockResolvedValue(undefined),
    showModal: vi.fn().mockResolvedValue(undefined),
  };
  return interaction as unknown as FakeButtonInteraction;
}

export interface FakeSelectMenuInit {
  customId: string;
  values: string[];
  userId?: string;
  username?: string;
}

export type FakeSelectMenuInteraction = StringSelectMenuInteraction & {
  reply: ReturnType<typeof vi.fn>;
  showModal: ReturnType<typeof vi.fn>;
};

/** Build a mock `StringSelectMenuInteraction` for a select-menu handler under test. */
export function fakeSelectMenuInteraction(init: FakeSelectMenuInit): FakeSelectMenuInteraction {
  const interaction = {
    customId: init.customId,
    values: init.values,
    user: { id: init.userId ?? 'user-1', username: init.username ?? 'alice' },
    reply: vi.fn().mockResolvedValue(undefined),
    showModal: vi.fn().mockResolvedValue(undefined),
  };
  return interaction as unknown as FakeSelectMenuInteraction;
}
