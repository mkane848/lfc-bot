import { SlashCommandBuilder } from 'discord.js';
import { afterEach, describe, expect, it } from 'vitest';
import { getGame } from '../../src/games/index.js';
import {
  addGameOption,
  addGradeOption,
  addLanguageOption,
  addUniversalOptions,
  checkFinishForGame,
  checkVariantForGame,
  finishChoices,
  gradeFields,
  languageFor,
} from '../../src/utils/listing-options.js';
import { ValidationError } from '../../src/utils/validation.js';
import { createFakeGame, registerFakeGame, unregisterFakeGame } from '../helpers/games.js';

afterEach(() => {
  unregisterFakeGame();
});

const optionNames = (builder: { toJSON: () => { options?: Array<{ name: string }> } }) =>
  (builder.toJSON().options ?? []).map((option) => option.name);

const base = () =>
  new SlashCommandBuilder()
    .setName('t')
    .setDescription('t')
    .addStringOption((o) => o.setName('first').setDescription('first'));

describe('option builders', () => {
  it('adds no game option while only one game is registered', () => {
    expect(optionNames(addGameOption(base()))).toEqual(['first']);
  });

  it('adds a game option offering every registered game once there is a choice', () => {
    registerFakeGame();
    const json = addGameOption(base()).toJSON();
    const game = json.options?.find((option) => option.name === 'game') as
      { choices?: Array<{ name: string; value: string }> } | undefined;
    expect(game?.choices).toEqual([
      { name: 'Magic: The Gathering', value: 'mtg' },
      { name: 'Fake Game', value: 'fake' },
    ]);
  });

  it('adds a language option with every supported language', () => {
    const json = addLanguageOption(base()).toJSON();
    const language = json.options?.find((option) => option.name === 'language') as
      { choices?: Array<{ value: string }> } | undefined;
    expect(language?.choices?.map((choice) => choice.value)).toEqual([
      'en',
      'ja',
      'de',
      'fr',
      'it',
      'es',
      'pt',
      'ko',
      'zh-cn',
      'zh-tw',
      'ru',
    ]);
  });

  it('adds a grade option that fits a grade like "BGS 9.5"', () => {
    const grade = addGradeOption(base())
      .toJSON()
      .options?.find((o) => o.name === 'grade') as { max_length?: number } | undefined;
    expect(grade?.max_length).toBeGreaterThanOrEqual('BGS 9.5'.length);
  });

  it('adds language and, for cards, grade, after the command’s own options', () => {
    expect(optionNames(addUniversalOptions(base(), { grade: true }))).toEqual([
      'first',
      'language',
      'grade',
    ]);
    expect(optionNames(addUniversalOptions(base(), { grade: false }))).toEqual([
      'first',
      'language',
    ]);
  });

  it('adds the game option too when there is more than one game, before language and grade', () => {
    registerFakeGame();
    expect(optionNames(addUniversalOptions(base(), { grade: true }))).toEqual([
      'first',
      'game',
      'language',
      'grade',
    ]);
  });
});

describe('finishChoices', () => {
  it('is Magic’s finishes while only Magic is registered', () => {
    expect(finishChoices()).toEqual([
      { name: 'Nonfoil', value: 'nonfoil' },
      { name: 'Foil', value: 'foil' },
      { name: 'Etched', value: 'etched' },
    ]);
  });

  it('gains a finish when a registered game has it, in the usual order', () => {
    registerFakeGame();
    expect(finishChoices().map((choice) => choice.value)).toEqual([
      'nonfoil',
      'foil',
      'etched',
      'reverse',
    ]);
  });
});

describe('checkFinishForGame / checkVariantForGame', () => {
  const mtg = getGame('mtg')!;
  const fake = createFakeGame();

  it('accepts no finish and any finish the game has', () => {
    expect(() => checkFinishForGame(mtg, null)).not.toThrow();
    expect(() => checkFinishForGame(mtg, 'foil')).not.toThrow();
    expect(() => checkFinishForGame(fake, 'reverse')).not.toThrow();
  });

  it('rejects a finish the game does not have, naming the ones it does', () => {
    expect(() => checkFinishForGame(mtg, 'reverse')).toThrow(
      "Magic: The Gathering cards don't come in Reverse Holo. Choose Nonfoil, Foil, Etched.",
    );
    expect(() => checkFinishForGame(fake, 'etched')).toThrow(ValidationError);
  });

  it('allows a variant only for a game that has them', () => {
    expect(() => checkVariantForGame(mtg, 'showcase')).not.toThrow();
    expect(() => checkVariantForGame(mtg, null)).not.toThrow();
    expect(() => checkVariantForGame(fake, 'showcase')).toThrow(/only apply to Magic/);
    expect(() => checkVariantForGame(fake, null)).not.toThrow();
  });
});

describe('gradeFields', () => {
  it('splits the grade of a graded card', () => {
    expect(gradeFields('graded', 'PSA 10')).toEqual({ gradingCompany: 'PSA', grade: '10' });
  });

  it('requires a grade for a graded card', () => {
    expect(() => gradeFields('graded', null)).toThrow(/needs its grade/);
  });

  it('rejects a grade with any other condition, or none', () => {
    expect(() => gradeFields('nm', 'PSA 10')).toThrow(/only applies when the condition is Graded/);
    expect(() => gradeFields(null, 'PSA 10')).toThrow(ValidationError);
  });

  it('has no grade for a raw card', () => {
    expect(gradeFields('nm', null)).toEqual({ gradingCompany: null, grade: null });
    expect(gradeFields(null, null)).toEqual({ gradingCompany: null, grade: null });
  });
});

describe('languageFor', () => {
  it('is English when nothing says otherwise', () => {
    expect(languageFor(null, null)).toBe('en');
    expect(languageFor(null, undefined)).toBe('en');
  });

  it('is the chosen language, or the catalog entry’s when it fixes one', () => {
    expect(languageFor('de', null)).toBe('de');
    expect(languageFor(null, 'ja')).toBe('ja');
    expect(languageFor('ja', 'ja')).toBe('ja');
  });

  it('rejects a chosen language that contradicts the catalog entry', () => {
    expect(() => languageFor('en', 'ja')).toThrow(
      'That is the Japanese printing, but you chose English. Leave language out or pick a matching one.',
    );
  });
});
