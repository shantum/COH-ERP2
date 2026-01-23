/**
 * Product Category Mapping Configuration
 *
 * Maps Shopify product_type and tags to internal product categories.
 * Categories follow the pattern: "gender garmentType" (e.g., "men shirt", "women dress")
 *
 * RESOLUTION ORDER:
 * 1. product_type field (if not empty)
 * 2. Tag patterns (scanned in priority order)
 * 3. Default fallback
 *
 * TO ADD A NEW CATEGORY MAPPING:
 * 1. Add entry to GARMENT_TYPE_PATTERNS (tag → garment type)
 * 2. Higher priority = checked first
 */

import type { BaseMappingRule } from '../types.js';

// ============================================
// TYPES
// ============================================

export interface GarmentTypeRule extends BaseMappingRule {
    /** Tag patterns to match (case-insensitive, includes match) */
    tagPatterns: string[];
    /** The garment type to assign */
    garmentType: string;
}

export interface ShopifyProductInput {
    product_type?: string | null;
    tags?: string | string[];
}

// ============================================
// GARMENT TYPE PATTERNS
// Matches tags to garment types
// Priority: higher = checked first
// ============================================

export const GARMENT_TYPE_PATTERNS: GarmentTypeRule[] = [
    // ========== DRESSES (priority 100) ==========
    {
        tagPatterns: ['co-ord set', 'coord set', 'co ord set'],
        garmentType: 'co-ord set',
        priority: 100,
        description: 'Co-ord sets',
    },
    {
        tagPatterns: ['maxi dress'],
        garmentType: 'maxi dress',
        priority: 100,
        description: 'Maxi dresses',
    },
    {
        tagPatterns: ['midi dress'],
        garmentType: 'midi dress',
        priority: 100,
        description: 'Midi dresses',
    },
    {
        tagPatterns: ['mini dress'],
        garmentType: 'mini dress',
        priority: 100,
        description: 'Mini dresses',
    },
    {
        tagPatterns: ['shirt dress'],
        garmentType: 'shirt dress',
        priority: 100,
        description: 'Shirt dresses',
    },
    {
        tagPatterns: ['slip dress'],
        garmentType: 'slip dress',
        priority: 100,
        description: 'Slip dresses',
    },
    {
        tagPatterns: ['tee dress', 't-shirt dress'],
        garmentType: 'tee dress',
        priority: 100,
        description: 'Tee dresses',
    },

    // ========== OUTERWEAR (priority 95) ==========
    {
        tagPatterns: ['bomber jacket'],
        garmentType: 'bomber jacket',
        priority: 95,
        description: 'Bomber jackets',
    },
    {
        tagPatterns: ['jacket'],
        garmentType: 'jacket',
        priority: 90,
        description: 'Jackets',
    },
    {
        tagPatterns: ['hoodie', 'hoodies'],
        garmentType: 'hoodie',
        priority: 90,
        description: 'Hoodies',
    },
    {
        tagPatterns: ['sweatshirt', 'sweat shirt'],
        garmentType: 'sweatshirt',
        priority: 90,
        description: 'Sweatshirts',
    },
    {
        tagPatterns: ['pullover'],
        garmentType: 'pullover',
        priority: 90,
        description: 'Pullovers',
    },
    {
        tagPatterns: ['waistcoat', 'vest'],
        garmentType: 'waistcoat',
        priority: 90,
        description: 'Waistcoats',
    },
    {
        tagPatterns: ['bandhgala'],
        garmentType: 'bandhgala',
        priority: 90,
        description: 'Bandhgala',
    },

    // ========== TOPS - SPECIFIC (priority 85) ==========
    {
        tagPatterns: ['polo t-shirt', 'polo shirt'],
        garmentType: 'polo t-shirt',
        priority: 85,
        description: 'Polo t-shirts',
    },
    {
        tagPatterns: ['henley t-shirt', 'henley'],
        garmentType: 'henley t-shirt',
        priority: 85,
        description: 'Henley t-shirts',
    },
    {
        tagPatterns: ['v-neck t-shirt', 'vneck t-shirt'],
        garmentType: 'v-neck t-shirt',
        priority: 85,
        description: 'V-neck t-shirts',
    },
    {
        tagPatterns: ['crew neck t-shirt', 'crewneck t-shirt'],
        garmentType: 'crew neck t-shirt',
        priority: 85,
        description: 'Crew neck t-shirts',
    },
    {
        tagPatterns: ['oversized t-shirt', 'oversized tee'],
        garmentType: 'oversized t-shirt',
        priority: 85,
        description: 'Oversized t-shirts',
    },
    {
        tagPatterns: ['crop tank', 'cropped tank'],
        garmentType: 'crop tank top',
        priority: 85,
        description: 'Crop tank tops',
    },
    {
        tagPatterns: ['v-neck tank', 'vneck tank'],
        garmentType: 'v-neck tank top',
        priority: 85,
        description: 'V-neck tank tops',
    },
    {
        tagPatterns: ['flared tank'],
        garmentType: 'flared tank top',
        priority: 85,
        description: 'Flared tank tops',
    },
    {
        tagPatterns: ['v-neck top', 'vneck top'],
        garmentType: 'v-neck top',
        priority: 85,
        description: 'V-neck tops',
    },
    {
        tagPatterns: ['wrap top'],
        garmentType: 'wrap top',
        priority: 85,
        description: 'Wrap tops',
    },
    {
        tagPatterns: ['flared top'],
        garmentType: 'flared top',
        priority: 85,
        description: 'Flared tops',
    },
    {
        tagPatterns: ['oversized shirt'],
        garmentType: 'oversized shirt',
        priority: 85,
        description: 'Oversized shirts',
    },
    {
        tagPatterns: ['buttondown shirt', 'button down shirt', 'button-down'],
        garmentType: 'buttondown shirt',
        priority: 85,
        description: 'Buttondown shirts',
    },
    {
        tagPatterns: ['shirt blouse', 'blouse'],
        garmentType: 'shirt blouse',
        priority: 85,
        description: 'Shirt blouses',
    },

    // ========== TOPS - GENERAL (priority 80) ==========
    {
        tagPatterns: ['tank top', 'tank'],
        garmentType: 'tank top',
        priority: 80,
        description: 'Tank tops',
    },
    {
        tagPatterns: ['t-shirt', 'tee', 'tshirt', 't shirt'],
        garmentType: 't-shirt',
        priority: 80,
        description: 'T-shirts',
    },
    {
        tagPatterns: ['shirts', 'shirt', 'mens shirts', 'womens shirts', 'shirts & polos'],
        garmentType: 'shirt',
        priority: 75,
        description: 'Shirts',
    },
    {
        tagPatterns: ['top', 'tops', 'top wear', 'topwear'],
        garmentType: 'top',
        priority: 70,
        description: 'Tops (generic)',
    },

    // ========== BOTTOMS - SPECIFIC (priority 85) ==========
    {
        tagPatterns: ['cargo shorts'],
        garmentType: 'cargo shorts',
        priority: 85,
        description: 'Cargo shorts',
    },
    {
        tagPatterns: ['chino shorts'],
        garmentType: 'chino shorts',
        priority: 85,
        description: 'Chino shorts',
    },
    {
        tagPatterns: ['lounge shorts'],
        garmentType: 'lounge shorts',
        priority: 85,
        description: 'Lounge shorts',
    },
    {
        tagPatterns: ['cargo pants', 'cargo'],
        garmentType: 'cargo pants',
        priority: 85,
        description: 'Cargo pants',
    },
    {
        tagPatterns: ['lounge pants'],
        garmentType: 'lounge pants',
        priority: 85,
        description: 'Lounge pants',
    },
    {
        tagPatterns: ['flared pants', 'flare pants'],
        garmentType: 'flared pants',
        priority: 85,
        description: 'Flared pants',
    },
    {
        tagPatterns: ['pleated pants'],
        garmentType: 'pleated pants',
        priority: 85,
        description: 'Pleated pants',
    },
    {
        tagPatterns: ['baggy pants'],
        garmentType: 'baggy pants',
        priority: 85,
        description: 'Baggy pants',
    },
    {
        tagPatterns: ['oversized pants'],
        garmentType: 'oversized pants',
        priority: 85,
        description: 'Oversized pants',
    },
    {
        tagPatterns: ['panelled pants'],
        garmentType: 'panelled pants',
        priority: 85,
        description: 'Panelled pants',
    },
    {
        tagPatterns: ['chinos', 'chino'],
        garmentType: 'chinos',
        priority: 85,
        description: 'Chinos',
    },
    {
        tagPatterns: ['joggers', 'jogger'],
        garmentType: 'joggers',
        priority: 85,
        description: 'Joggers',
    },
    {
        tagPatterns: ['midi skirt'],
        garmentType: 'midi skirt',
        priority: 85,
        description: 'Midi skirts',
    },

    // ========== BOTTOMS - GENERAL (priority 80) ==========
    {
        tagPatterns: ['shorts'],
        garmentType: 'shorts',
        priority: 80,
        description: 'Shorts',
    },
    {
        tagPatterns: ['pants', 'trousers'],
        garmentType: 'pants',
        priority: 75,
        description: 'Pants',
    },
    {
        tagPatterns: ['skirt'],
        garmentType: 'skirt',
        priority: 75,
        description: 'Skirts',
    },

    // ========== DRESSES - GENERAL (priority 60) ==========
    {
        tagPatterns: ['dress', 'dresses'],
        garmentType: 'dress',
        priority: 60,
        description: 'Dresses (generic)',
    },

    // ========== ACCESSORIES (priority 50) ==========
    {
        tagPatterns: ['tote bag', 'bag'],
        garmentType: 'tote bag',
        priority: 50,
        description: 'Tote bags',
    },
];

// Sort by priority (descending) at module load
const SORTED_GARMENT_RULES = [...GARMENT_TYPE_PATTERNS].sort(
    (a, b) => (b.priority ?? 0) - (a.priority ?? 0)
);

// ============================================
// GENDER EXTRACTION
// ============================================

const GENDER_TAG_PATTERNS = {
    men: ['_related_men', 'men ', 'mens ', "men's", 'male', 'for men', 'for him'],
    women: ['_related_women', 'women ', 'womens ', "women's", 'female', 'for women', 'for her', 'ladies'],
    unisex: ['unisex', 'gender neutral'],
};

/**
 * Extract gender from Shopify tags
 */
function extractGender(tags: string[]): 'men' | 'women' | 'unisex' {
    const tagsLower = tags.map((t) => t.toLowerCase());
    const tagsJoined = tagsLower.join(' ');

    // Check for explicit unisex first
    for (const pattern of GENDER_TAG_PATTERNS.unisex) {
        if (tagsJoined.includes(pattern)) return 'unisex';
    }

    // Check men patterns
    for (const pattern of GENDER_TAG_PATTERNS.men) {
        if (tagsJoined.includes(pattern)) return 'men';
    }

    // Check women patterns
    for (const pattern of GENDER_TAG_PATTERNS.women) {
        if (tagsJoined.includes(pattern)) return 'women';
    }

    // Default to unisex if no gender found
    return 'unisex';
}

/**
 * Extract garment type from Shopify tags
 */
function extractGarmentType(tags: string[]): string | null {
    const tagsLower = tags.map((t) => t.toLowerCase());
    const tagsJoined = tagsLower.join(' ');

    for (const rule of SORTED_GARMENT_RULES) {
        for (const pattern of rule.tagPatterns) {
            if (tagsJoined.includes(pattern.toLowerCase())) {
                return rule.garmentType;
            }
        }
    }

    return null;
}

// ============================================
// PUBLIC API
// ============================================

export const DEFAULT_CATEGORY = 'uncategorized';

/**
 * Resolve product category from Shopify product data
 *
 * @param input - Shopify product with product_type and tags
 * @returns Category string (garment type only, gender is stored separately in Product.gender)
 *
 * @example
 * resolveProductCategory({ product_type: 'Shirt', tags: '_related_men' })
 * // Returns: 'shirt'
 *
 * @example
 * resolveProductCategory({ product_type: '', tags: 'mens shirts, Linen' })
 * // Returns: 'shirt'
 */
export function resolveProductCategory(input: ShopifyProductInput): string {
    // Normalize tags to array
    const tags: string[] = Array.isArray(input.tags)
        ? input.tags
        : typeof input.tags === 'string'
          ? input.tags.split(',').map((t) => t.trim())
          : [];

    // 1. First try product_type if not empty
    if (input.product_type && input.product_type.trim()) {
        let garmentType = input.product_type.trim().toLowerCase();
        // Strip any gender prefix from product_type (e.g., "Women Co-Ord Set" -> "co-ord set")
        garmentType = garmentType.replace(/^(men|women|mens|womens|men's|women's|unisex)\s+/i, '').trim();
        return garmentType || DEFAULT_CATEGORY;
    }

    // 2. Try to extract garment type from tags
    const garmentType = extractGarmentType(tags);
    if (garmentType) {
        return garmentType;
    }

    // 3. Fallback to default
    return DEFAULT_CATEGORY;
}

/**
 * Check if a category is the default/unset value
 */
export function isDefaultCategory(category: string): boolean {
    return category === DEFAULT_CATEGORY || category === 'dress';
}
