/**
 * Product Sync Service — Variant Utilities
 */

import type {
    ShopifyProductWithImages,
    ShopifyVariantWithInventory,
    VariantImageMap,
    VariantsByColor,
} from './types.js';

/**
 * Normalize size values (e.g., XXL -> 2XL)
 */
export function normalizeSize(rawSize: string): string {
    return rawSize
        .replace(/^XXXXL$/i, '4XL')
        .replace(/^XXXL$/i, '3XL')
        .replace(/^XXL$/i, '2XL');
}

/**
 * Build variant-to-image mapping from Shopify product images
 */
export function buildVariantImageMap(shopifyProduct: ShopifyProductWithImages): VariantImageMap {
    const variantImageMap: VariantImageMap = {};
    for (const img of shopifyProduct.images || []) {
        for (const variantId of img.variant_ids || []) {
            variantImageMap[variantId] = img.src;
        }
    }
    return variantImageMap;
}

/**
 * Resolve which option position holds "Color" and which holds "Size".
 * Shopify products have options like [{name:"Color", position:1}, {name:"Size", position:2}]
 * but the order isn't guaranteed — some products put Size first.
 * Returns the option key (option1/option2/option3) for color and size.
 */
export function resolveOptionPositions(options: Array<{ name: string; position: number }>): {
    colorKey: 'option1' | 'option2' | 'option3';
    sizeKey: 'option1' | 'option2' | 'option3';
} {
    const positionMap = { 1: 'option1', 2: 'option2', 3: 'option3' } as const;
    let colorKey: 'option1' | 'option2' | 'option3' = 'option1';
    let sizeKey: 'option1' | 'option2' | 'option3' = 'option2';

    for (const opt of options) {
        const key = positionMap[opt.position as 1 | 2 | 3];
        if (!key) continue;
        const name = opt.name.toLowerCase();
        if (name === 'color' || name === 'colour') colorKey = key;
        if (name === 'size') sizeKey = key;
    }

    return { colorKey, sizeKey };
}

/**
 * Group variants by color option.
 * Uses product options array to determine which option holds color (not assumed to be option1).
 */
export function groupVariantsByColor(
    variants: ShopifyVariantWithInventory[],
    options?: Array<{ name: string; position: number }>,
): VariantsByColor {
    const { colorKey } = options?.length
        ? resolveOptionPositions(options)
        : { colorKey: 'option1' as const };

    const variantsByColor: VariantsByColor = {};
    for (const variant of variants || []) {
        const colorOption = variant[colorKey] || 'Default';
        if (!variantsByColor[colorOption]) {
            variantsByColor[colorOption] = [];
        }
        variantsByColor[colorOption].push(variant);
    }
    return variantsByColor;
}
