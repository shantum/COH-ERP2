/**
 * Standard size ordering for products
 * Used for sorting sizes consistently across the application
 */

/**
 * Standard size order from smallest to largest
 * 'Free' represents one-size-fits-all products
 */
export const SIZE_ORDER = ['XS', 'S', 'M', 'L', 'XL', '2XL', '3XL', '4XL', 'Free'] as const;

/**
 * Type for valid standard sizes
 */
export type StandardSize = typeof SIZE_ORDER[number];

/**
 * Comparator function for sorting sizes according to standard order
 * Unknown sizes are sorted to the end alphabetically
 *
 * @example
 * sizes.sort(sortBySizeOrder) // ['XS', 'S', 'M', 'L', 'XL']
 * items.sort((a, b) => sortBySizeOrder(a.size, b.size))
 */
export const sortBySizeOrder = (a: string, b: string): number => {
    const indexA = SIZE_ORDER.indexOf(a as StandardSize);
    const indexB = SIZE_ORDER.indexOf(b as StandardSize);

    // Both sizes are in our standard order
    if (indexA !== -1 && indexB !== -1) {
        return indexA - indexB;
    }

    // Unknown sizes go to the end
    if (indexA === -1 && indexB !== -1) return 1;
    if (indexA !== -1 && indexB === -1) return -1;

    // Both unknown, sort alphabetically
    return a.localeCompare(b);
};

/**
 * Get the index of a size in the standard order
 * Returns -1 if the size is not in the standard order
 */
export const getSizeIndex = (size: string): number => {
    return SIZE_ORDER.indexOf(size as StandardSize);
};

/**
 * Check if a size is a standard size
 */
export const isStandardSize = (size: string): size is StandardSize => {
    return SIZE_ORDER.includes(size as StandardSize);
};
