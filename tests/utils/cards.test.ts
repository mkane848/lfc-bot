import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { GameDefinition } from '../../src/games/types.js';
import { autocompleteChoices, autocompleteSetChoices } from '../../src/games/autocomplete.js';
import {
  handleCardAutocomplete,
  handleSealedAutocomplete,
  handleSetAutocomplete,
  resolveCardForCommand,
  searchKey,
} from '../../src/utils/cards.js';
import { replyError } from '../../src/utils/replies.js';
import { fakeAutocompleteInteraction, fakeChatInputInteraction } from '../helpers/interaction.js';

vi.mock('../../src/games/autocomplete.js', () => ({
  autocompleteChoices: vi.fn(),
  autocompleteSetChoices: vi.fn(),
}));

vi.mock('../../src/utils/replies.js', () => ({
  replyError: vi.fn(),
}));

const mockAutocompleteChoices = vi.mocked(autocompleteChoices);
const mockAutocompleteSetChoices = vi.mocked(autocompleteSetChoices);
const mockReplyError = vi.mocked(replyError);

beforeEach(() => {
  mockAutocompleteChoices.mockReset();
  mockAutocompleteSetChoices.mockReset();
  mockReplyError.mockReset();
});

describe('handleCardAutocomplete', () => {
  it('asks for card choices and responds with them verbatim', async () => {
    mockAutocompleteChoices.mockResolvedValue([{ name: 'Black Lotus', value: 'Black Lotus' }]);
    const i = fakeAutocompleteInteraction({ focused: { name: 'card_name', value: 'black' } });

    await handleCardAutocomplete(i);

    expect(mockAutocompleteChoices).toHaveBeenCalledWith(i, 'card');
    expect(i.respond).toHaveBeenCalledTimes(1);
    expect(i.respond).toHaveBeenCalledWith([{ name: 'Black Lotus', value: 'Black Lotus' }]);
  });

  it('responds with an empty list when nothing matches', async () => {
    mockAutocompleteChoices.mockResolvedValue([]);
    const i = fakeAutocompleteInteraction({ focused: { name: 'card_name', value: 'zzz' } });

    await handleCardAutocomplete(i);

    expect(i.respond).toHaveBeenCalledWith([]);
  });

  it('sends nothing when the lookup misses the deadline (null choices)', async () => {
    mockAutocompleteChoices.mockResolvedValue(null);
    const i = fakeAutocompleteInteraction({ focused: { name: 'card_name', value: 'black' } });

    await handleCardAutocomplete(i);

    expect(i.respond).not.toHaveBeenCalled();
  });
});

describe('handleSealedAutocomplete', () => {
  it('asks for sealed choices rather than card choices', async () => {
    mockAutocompleteChoices.mockResolvedValue([{ name: 'Booster Box', value: 'id:1' }]);
    const i = fakeAutocompleteInteraction({ focused: { name: 'product_name', value: 'booster' } });

    await handleSealedAutocomplete(i);

    expect(mockAutocompleteChoices).toHaveBeenCalledWith(i, 'sealed');
    expect(i.respond).toHaveBeenCalledWith([{ name: 'Booster Box', value: 'id:1' }]);
  });
});

describe('handleSetAutocomplete', () => {
  it('defaults to card sets', async () => {
    mockAutocompleteSetChoices.mockResolvedValue([{ name: 'ICE', value: 'ice' }]);
    const i = fakeAutocompleteInteraction({ focused: { name: 'card_set', value: 'ice' } });

    await handleSetAutocomplete(i);

    expect(mockAutocompleteSetChoices).toHaveBeenCalledWith(i, 'card');
    expect(i.respond).toHaveBeenCalledWith([{ name: 'ICE', value: 'ice' }]);
  });

  it('forwards an explicit sealed kind', async () => {
    mockAutocompleteSetChoices.mockResolvedValue([{ name: 'ICE', value: 'ice' }]);
    const i = fakeAutocompleteInteraction({ focused: { name: 'set', value: 'ice' } });

    await handleSetAutocomplete(i, 'sealed');

    expect(mockAutocompleteSetChoices).toHaveBeenCalledWith(i, 'sealed');
  });

  it('sends nothing when the lookup misses the deadline (null choices)', async () => {
    mockAutocompleteSetChoices.mockResolvedValue(null);
    const i = fakeAutocompleteInteraction({ focused: { name: 'card_set', value: 'ice' } });

    await handleSetAutocomplete(i);

    expect(i.respond).not.toHaveBeenCalled();
  });
});

describe('resolveCardForCommand', () => {
  function fakeGame(resolveCard: GameDefinition['resolveCard']): GameDefinition {
    return { id: 'mtg', resolveCard } as unknown as GameDefinition;
  }

  it('resolves through the game and returns the card', async () => {
    const resolved = { resolved: true, card: { name: 'Black Lotus' } } as never;
    const resolveCard = vi.fn().mockResolvedValue(resolved);
    const i = fakeChatInputInteraction({});

    const result = await resolveCardForCommand(i, fakeGame(resolveCard), 'Black Lotus');

    expect(result).toBe(resolved);
    expect(resolveCard).toHaveBeenCalledWith('Black Lotus', {});
    expect(mockReplyError).not.toHaveBeenCalled();
  });

  it('forwards the printing options to the game', async () => {
    const resolveCard = vi.fn().mockResolvedValue({ resolved: true });
    const i = fakeChatInputInteraction({});

    await resolveCardForCommand(i, fakeGame(resolveCard), 'Black Lotus', {
      cardSet: 'LEP',
      collectorNumber: '1',
    });

    expect(resolveCard).toHaveBeenCalledWith('Black Lotus', {
      cardSet: 'LEP',
      collectorNumber: '1',
    });
  });

  it('replies ephemerally with a hint and returns null when the card is unresolved', async () => {
    const resolveCard = vi.fn().mockResolvedValue({ resolved: false });
    const i = fakeChatInputInteraction({});

    const result = await resolveCardForCommand(i, fakeGame(resolveCard), 'Smooooth Criminal');

    expect(result).toBeNull();
    expect(mockReplyError).toHaveBeenCalledTimes(1);
    const [calledInteraction, message] = mockReplyError.mock.calls[0]!;
    expect(calledInteraction).toBe(i);
    expect(message).toMatch(/I could not resolve that card name/);
    expect(message).toMatch(/autocomplete/);
  });
});

describe('searchKey', () => {
  it('normalizes the card name via shared validation helper', () => {
    expect(searchKey('Jace, the Mind Sculptor')).toBe('jace the mind sculptor');
    expect(searchKey('  CRUE  ')).toBe('crue');
    expect(searchKey('')).toBe('');
  });
});
