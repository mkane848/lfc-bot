/** Build a kebab-case slug from a card name, matching Manapool's URL convention. */
function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/'/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * Build a link to a card's exact-printing page on Manapool, e.g.
 * https://manapool.com/card/ice/89/polar-kraken. Only returns a URL when both
 * the set code and collector number are known, since that's the only URL
 * shape confirmed against Manapool's API; there is no verified fallback for a
 * bare card-name page.
 */
export function buildManapoolUrl(input: {
  cardName: string;
  cardSet?: string | null;
  collectorNumber?: string | null;
}): string | null {
  const name = input.cardName.trim();
  if (!name || !input.cardSet || !input.collectorNumber) {
    return null;
  }
  const set = input.cardSet.trim().toLowerCase();
  const collectorNumber = input.collectorNumber.trim();
  if (!set || !collectorNumber) {
    return null;
  }
  const slug = slugify(name);
  return `https://manapool.com/card/${set}/${collectorNumber}/${slug}`;
}
