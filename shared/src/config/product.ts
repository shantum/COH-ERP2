/**
 * Canonical size and gender constants for the entire application.
 *
 * SIZE_ORDER uses the nXL format (2XL, 3XL, 4XL) — the same format
 * stored in the database. The Shopify sync normalizes XXL→2XL etc.
 *
 * GENDERS uses lowercase — the format stored in the database.
 * Display formatting (title case) is a UI concern.
 */

/** Standard size order from smallest to largest */
export const SIZE_ORDER = ['XS', 'S', 'M', 'L', 'XL', '2XL', '3XL', '4XL', 'Free'] as const;
export type StandardSize = (typeof SIZE_ORDER)[number];

/** Gender values as stored in the database */
export const GENDERS = ['women', 'men', 'unisex', 'kids'] as const;
export type Gender = (typeof GENDERS)[number];

/** Display labels for genders (title case) */
export const GENDER_LABELS: Record<Gender, string> = {
  women: 'Women',
  men: 'Men',
  unisex: 'Unisex',
  kids: 'Kids',
};

/**
 * Sort comparator for sizes in standard order.
 * Unknown sizes sort to the end alphabetically.
 */
export function sortBySizeOrder(a: string, b: string): number {
  const indexA = SIZE_ORDER.indexOf(a as StandardSize);
  const indexB = SIZE_ORDER.indexOf(b as StandardSize);
  if (indexA !== -1 && indexB !== -1) return indexA - indexB;
  if (indexA === -1 && indexB !== -1) return 1;
  if (indexA !== -1 && indexB === -1) return -1;
  return a.localeCompare(b);
}

/** Get the index of a size in the standard order (-1 if unknown) */
export function getSizeIndex(size: string): number {
  return SIZE_ORDER.indexOf(size as StandardSize);
}
