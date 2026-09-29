import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  handleCardAutocomplete,
  handleSetAutocomplete,
  resolveCardForCommand,
  searchKey,
} from '../../src/utils/cards.js';
import {
  autocompleteCards,
  autocompleteSets,
  resolveCard,
} from '../../src/services/scryfall.js';
import { replyError } from '../../src/utils/replies.js';
import { fakeAutocompleteInteraction, fakeChatInputInteraction } from '../helpers/interaction.js';

vi.mock('../../src/services/scryfall.js', () => ({
  autocompleteCards: vi.fn(),
  autocompleteSets: vi.fn(),
  resolveCard: vi.fn(),
}));

vi.mock('../../src/utils/replies.js', () => ({
  replyError: vi.fn(),
}));

const mockAutocompleteCards = vi.mocked(autocompleteCards);
const mockAutocompleteSets = vi.mocked(autocompleteSets);
const mockResolveCard = vi.mocked(resolveCard);
const mockReplyError = vi.mocked(replyError);

beforeEach(() => {
  mockAutocompleteCards.mockReset();
  mockAutocompleteSets.mockReset();
  mockResolveCard.mockReset();
  mockReplyError.mockReset();
});

describe('handleCardAutocomplete', () => {
  it('passes the focused value through and slices to 25 choices', async () => {
    mockAutocompleteCards.mockResolvedValue(Array.from({ length: 30 }, (_, n) => `Card ${n}`));
    const i = fakeAutocompleteInteraction({ focused: { name: 'card_name', value: 'black' } });

    await handleCardAutocomplete(i);

    expect(mockAutocompleteCards).toHaveBeenCalledWith('black');
    expect(i.respond).toHaveBeenCalledTimes(1);
    const payload = i.respond.mock.calls[0]![0] as Array<{ name: string; value: string }>;
    expect(payload).toHaveLength(25);
    expect(payload[0]).toEqual({ name: 'Card 0', value: 'Card 0' });
    expect(payload[24]).toEqual({ name: 'Card 24', value: 'Card 24' });
  });

  it('returns all choices when fewer than 25 are returned', async () => {
    mockAutocompleteCards.mockResolvedValue(['Black Lotus', 'Black Vice']);
    const i = fakeAutocompleteInteraction({ focused: { name: 'card_name', value: 'black' } });

    await handleCardAutocomplete(i);

    const payload = i.respond.mock.calls[0]![0] as Array<{ name: string; value: string }>;
    expect(payload).toEqual([
      { name: 'Black Lotus', value: 'Black Lotus' },
      { name: 'Black Vice', value: 'Black Vice' },
    ]);
  });

  it('handles an empty result set', async () => {
    mockAutocompleteCards.mockResolvedValue([]);
    const i = fakeAutocompleteInteraction({ focused: { name: 'card_name', value: 'zzz' } });

    await handleCardAutocomplete(i);

    expect(i.respond).toHaveBeenCalledWith([]);
  });
});

describe('handleSetAutocomplete', () => {
  it('passes the focused value through and returns the choices verbatim', async () => {
    mockAutocompleteSets.mockResolvedValue([
      { name: 'ICE', value: 'ice' },
      { name: '7ED', value: '7ed' },
    ]);
    const i = fakeAutocompleteInteraction({ focused: { name: 'card_set', value: 'ice' } });

    await handleSetAutocomplete(i);

    expect(mockAutocompleteSets).toHaveBeenCalledWith('ice');
    expect(i.respond).toHaveBeenCalledWith([
      { name: 'ICE', value: 'ice' },
      { name: '7ED', value: '7ed' },
    ]);
  });

  it('returns an empty list when no sets match', async () => {
    mockAutocompleteSets.mockResolvedValue([]);
    const i = fakeAutocompleteInteraction({ focused: { name: 'card_set', value: 'zzz' } });

    await handleSetAutocomplete(i);

    expect(i.respond).toHaveBeenCalledWith([]);
  });
});

describe('resolveCardForCommand', () => {
  it('returns the resolved card when resolve succeeds', async () => {
    const resolved = { resolved: true, card: { name: 'Black Lotus' } } as never;
    mockResolveCard.mockResolvedValue(resolved);
    const i = fakeChatInputInteraction({});

    const result = await resolveCardForCommand(i, 'Black Lotus');

    expect(result).toBe(resolved);
    expect(mockResolveCard).toHaveBeenCalledWith('Black Lotus', {});
    expect(mockReplyError).not.toHaveBeenCalled();
  });

  it('forwards resolve options to scryfall', async () => {
    const resolved = { resolved: true, card: { name: 'Black Lotus' } } as never;
    mockResolveCard.mockResolvedValue(resolved);
    const i = fakeChatInputInteraction({});

    await resolveCardForCommand(i, 'Black Lotus', { cardSet: 'LEP', collectorNumber: '1' });

    expect(mockResolveCard).toHaveBeenCalledWith('Black Lotus', {
      cardSet: 'LEP',
      collectorNumber: '1',
    });
  });

  it('replies ephemerally with a hint and returns null when card is unresolved', async () => {
    mockResolveCard.mockResolvedValue({ resolved: false } as never);
    const i = fakeChatInputInteraction({});

    const result = await resolveCardForCommand(i, 'Smooooth Criminal');

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
