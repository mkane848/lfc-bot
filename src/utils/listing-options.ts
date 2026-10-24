import type { ChatInputCommandInteraction, SlashCommandOptionsOnlyBuilder } from 'discord.js';
import { listGames } from '../games/index.js';
import type { GameDefinition } from '../games/index.js';
import { CARD_FINISHES, LISTING_LANGUAGES } from '../types/index.js';
import type {
  CardCondition,
  CardFinish,
  CardVariant,
  GradingCompany,
  ListingLanguage,
} from '../types/index.js';
import { FINISH_LABELS, LANGUAGE_LABELS } from './constants.js';
import { isListingLanguage, parseGrade, ValidationError } from './validation.js';

/**
 * The `finish` choices: every finish some registered game's cards come in. A
 * finish no game has (reverse holo, while only Magic is registered) is left
 * out rather than offered and then rejected.
 */
export function finishChoices(): Array<{ name: string; value: CardFinish }> {
  const offered = new Set(listGames().flatMap((game) => game.finishes));
  return CARD_FINISHES.filter((finish) => offered.has(finish)).map((finish) => ({
    name: FINISH_LABELS[finish],
    value: finish,
  }));
}

/**
 * Add the `game` option. It only exists once there is a choice to make: with a
 * single game registered the command is exactly what it was before games.
 */
export function addGameOption(
  builder: SlashCommandOptionsOnlyBuilder,
): SlashCommandOptionsOnlyBuilder {
  const games = listGames();
  if (games.length < 2) {
    return builder;
  }
  return builder.addStringOption((option) =>
    option
      .setName('game')
      .setDescription('Which game (default: the first one your server has enabled)')
      .addChoices(...games.map((game) => ({ name: game.label, value: game.id }))),
  );
}

export function addLanguageOption(
  builder: SlashCommandOptionsOnlyBuilder,
): SlashCommandOptionsOnlyBuilder {
  return builder.addStringOption((option) =>
    option
      .setName('language')
      .setDescription('Language of the card or product (default: English)')
      .addChoices(
        ...LISTING_LANGUAGES.map((code) => ({ name: LANGUAGE_LABELS[code], value: code })),
      ),
  );
}

export function addGradeOption(
  builder: SlashCommandOptionsOnlyBuilder,
): SlashCommandOptionsOnlyBuilder {
  return builder.addStringOption((option) =>
    option
      .setName('grade')
      .setDescription('Grade, when condition is Graded: PSA 10, BGS 9.5, CGC 9 …')
      .setMaxLength(12),
  );
}

/**
 * Add the options every listing command shares: `game` (when there is more than
 * one), `language`, and, for cards, `grade`. All are optional, so they go after
 * the command's required options.
 */
export function addUniversalOptions(
  builder: SlashCommandOptionsOnlyBuilder,
  options: { grade: boolean },
): SlashCommandOptionsOnlyBuilder {
  const withShared = addLanguageOption(addGameOption(builder));
  return options.grade ? addGradeOption(withShared) : withShared;
}

export interface UniversalOptions {
  /** The raw `game` option, or null when the member left it out. */
  gameOption: string | null;
  /** The chosen language, or null when the member left it out. */
  language: ListingLanguage | null;
  /** The raw `grade` option, or null. See `gradeFields`. */
  grade: string | null;
}

/** Read and validate the shared options. Throws `ValidationError` on a bad value. */
export function readUniversalOptions(interaction: ChatInputCommandInteraction): UniversalOptions {
  const languageInput = interaction.options.getString('language');
  if (languageInput && !isListingLanguage(languageInput)) {
    throw new ValidationError('Invalid language.');
  }
  const gradeInput = interaction.options.getString('grade');
  return {
    gameOption: interaction.options.getString('game'),
    language: languageInput ? (languageInput as ListingLanguage) : null,
    grade: gradeInput && gradeInput.trim() !== '' ? gradeInput.trim() : null,
  };
}

/** Reject a finish the game's cards don't come in (no etched Pokémon, no reverse-holo Magic). */
export function checkFinishForGame(game: GameDefinition, finish: CardFinish | null): void {
  if (finish && !game.finishes.includes(finish)) {
    throw new ValidationError(
      `${game.label} cards don't come in ${FINISH_LABELS[finish]}. Choose ${game.finishes
        .map((allowed) => FINISH_LABELS[allowed])
        .join(', ')}.`,
    );
  }
}

/** Reject a printing variant for a game that has none. */
export function checkVariantForGame(game: GameDefinition, variant: CardVariant | null): void {
  if (variant && !game.supportsVariant) {
    throw new ValidationError(`Printing variants only apply to Magic: The Gathering cards.`);
  }
}

export interface GradeFields {
  gradingCompany: GradingCompany | null;
  grade: string | null;
}

/**
 * The grade is required exactly when the condition is `graded`: a graded card
 * without its grade says nothing, and a grade on a raw card contradicts it.
 */
export function gradeFields(
  condition: CardCondition | null,
  gradeInput: string | null,
): GradeFields {
  if (condition === 'graded') {
    if (!gradeInput) {
      throw new ValidationError(
        'A graded card needs its grade, such as PSA 10, BGS 9.5, or CGC 9.',
      );
    }
    const { gradingCompany, grade } = parseGrade(gradeInput);
    return { gradingCompany, grade };
  }
  if (gradeInput) {
    throw new ValidationError('A grade only applies when the condition is Graded.');
  }
  return { gradingCompany: null, grade: null };
}

/**
 * The language a listing gets. A catalog entry that fixes its language (a
 * Japanese print) decides it, and a different `language` option contradicts it.
 */
export function languageFor(
  option: ListingLanguage | null,
  resolved: ListingLanguage | null | undefined,
): ListingLanguage {
  if (resolved && option && resolved !== option) {
    throw new ValidationError(
      `That is the ${LANGUAGE_LABELS[resolved]} printing, but you chose ${LANGUAGE_LABELS[option]}. Leave language out or pick a matching one.`,
    );
  }
  return resolved ?? option ?? 'en';
}
