/**
 * Product Taxonomy & Attributes Configuration
 *
 * Single source of truth for:
 * 1. Garment groups (Level 1) — 5 high-level groups for analytics
 * 2. Category → garmentGroup + Google Product Category mapping
 * 3. Google Product Category registry with human-readable paths
 * 4. Product attribute enums and Zod schema
 *
 * TO ADD A NEW CATEGORY:
 *   Add one entry to CATEGORY_TAXONOMY with garmentGroup + googleCategoryId.
 *   No migration needed — the app derives garmentGroup on create/update.
 */

import { z } from 'zod';

// ============================================
// GARMENT GROUPS (Level 1)
// ============================================

/** High-level product groupings for analytics and reporting */
export const GARMENT_GROUPS = ['tops', 'bottoms', 'dresses', 'sets', 'accessories'] as const;
export type GarmentGroup = (typeof GARMENT_GROUPS)[number];

export const GARMENT_GROUP_LABELS: Record<GarmentGroup, string> = {
  tops: 'Tops',
  bottoms: 'Bottoms',
  dresses: 'Dresses',
  sets: 'Sets',
  accessories: 'Accessories',
};

// ============================================
// GOOGLE PRODUCT CATEGORIES (Level 3)
// ============================================

/**
 * Google Product Category registry.
 * IDs from Google's official taxonomy (https://support.google.com/merchants/answer/6324436).
 * Meta/Facebook uses the same taxonomy.
 *
 * Only IDs are stored in DB — paths are for human readability.
 */
export const GOOGLE_PRODUCT_CATEGORIES: Record<number, { id: number; path: string }> = {
  212: { id: 212, path: 'Apparel & Accessories > Clothing > Shirts & Tops' },
  2271: { id: 2271, path: 'Apparel & Accessories > Clothing > Dresses' },
  204: { id: 204, path: 'Apparel & Accessories > Clothing > Pants' },
  207: { id: 207, path: 'Apparel & Accessories > Clothing > Shorts' },
  1581: { id: 1581, path: 'Apparel & Accessories > Clothing > Skirts' },
  5598: { id: 5598, path: 'Apparel & Accessories > Clothing > Outerwear > Coats & Jackets' },
  6553: { id: 6553, path: 'Apparel & Accessories > Handbags, Wallets & Cases > Handbags > Tote Handbags' },
};

// ============================================
// CATEGORY TAXONOMY (Level 2 → Level 1 + Level 3)
// ============================================

interface CategoryMapping {
  garmentGroup: GarmentGroup;
  googleCategoryId: number;
}

/**
 * Master mapping from product category (garment sub-type) to:
 * - garmentGroup: high-level group for analytics
 * - googleCategoryId: Google/Meta product category for shopping feeds
 *
 * Every value that exists in Product.category should have an entry here.
 */
export const CATEGORY_TAXONOMY: Record<string, CategoryMapping> = {
  // ── TOPS: t-shirts ──
  't-shirt': { garmentGroup: 'tops', googleCategoryId: 212 },
  'crew neck t-shirt': { garmentGroup: 'tops', googleCategoryId: 212 },
  'v-neck t-shirt': { garmentGroup: 'tops', googleCategoryId: 212 },
  'polo t-shirt': { garmentGroup: 'tops', googleCategoryId: 212 },
  'henley t-shirt': { garmentGroup: 'tops', googleCategoryId: 212 },
  'oversized t-shirt': { garmentGroup: 'tops', googleCategoryId: 212 },

  // ── TOPS: tank tops ──
  'tank top': { garmentGroup: 'tops', googleCategoryId: 212 },
  'crop tank top': { garmentGroup: 'tops', googleCategoryId: 212 },
  'v-neck tank top': { garmentGroup: 'tops', googleCategoryId: 212 },
  'flared tank top': { garmentGroup: 'tops', googleCategoryId: 212 },

  // ── TOPS: tops & blouses ──
  'top': { garmentGroup: 'tops', googleCategoryId: 212 },
  'v-neck top': { garmentGroup: 'tops', googleCategoryId: 212 },
  'wrap top': { garmentGroup: 'tops', googleCategoryId: 212 },
  'flared top': { garmentGroup: 'tops', googleCategoryId: 212 },
  'shirt blouse': { garmentGroup: 'tops', googleCategoryId: 212 },

  // ── TOPS: shirts ──
  'shirt': { garmentGroup: 'tops', googleCategoryId: 212 },
  'oversized shirt': { garmentGroup: 'tops', googleCategoryId: 212 },
  'buttondown shirt': { garmentGroup: 'tops', googleCategoryId: 212 },
  'bandhgala shirt': { garmentGroup: 'tops', googleCategoryId: 212 },

  // ── TOPS: outerwear (still "tops" for analytics — goes on top half) ──
  'jacket': { garmentGroup: 'tops', googleCategoryId: 5598 },
  'bomber jacket': { garmentGroup: 'tops', googleCategoryId: 5598 },
  'hoodie': { garmentGroup: 'tops', googleCategoryId: 5598 },
  'sweatshirt': { garmentGroup: 'tops', googleCategoryId: 5598 },
  'pullover': { garmentGroup: 'tops', googleCategoryId: 5598 },
  'waistcoat': { garmentGroup: 'tops', googleCategoryId: 5598 },
  'bandhgala': { garmentGroup: 'tops', googleCategoryId: 5598 },

  // ── BOTTOMS: pants ──
  'pants': { garmentGroup: 'bottoms', googleCategoryId: 204 },
  'joggers': { garmentGroup: 'bottoms', googleCategoryId: 204 },
  'cargo pants': { garmentGroup: 'bottoms', googleCategoryId: 204 },
  'flared pants': { garmentGroup: 'bottoms', googleCategoryId: 204 },
  'pleated pants': { garmentGroup: 'bottoms', googleCategoryId: 204 },
  'oversized pants': { garmentGroup: 'bottoms', googleCategoryId: 204 },
  'wide leg pants': { garmentGroup: 'bottoms', googleCategoryId: 204 },
  'baggy pants': { garmentGroup: 'bottoms', googleCategoryId: 204 },
  'panelled pants': { garmentGroup: 'bottoms', googleCategoryId: 204 },
  'lounge pants': { garmentGroup: 'bottoms', googleCategoryId: 204 },
  'chinos': { garmentGroup: 'bottoms', googleCategoryId: 204 },

  // ── BOTTOMS: shorts ──
  'shorts': { garmentGroup: 'bottoms', googleCategoryId: 207 },
  'cargo shorts': { garmentGroup: 'bottoms', googleCategoryId: 207 },
  'chino shorts': { garmentGroup: 'bottoms', googleCategoryId: 207 },
  'lounge shorts': { garmentGroup: 'bottoms', googleCategoryId: 207 },

  // ── BOTTOMS: skirts ──
  'skirt': { garmentGroup: 'bottoms', googleCategoryId: 1581 },
  'midi skirt': { garmentGroup: 'bottoms', googleCategoryId: 1581 },

  // ── DRESSES ──
  'dress': { garmentGroup: 'dresses', googleCategoryId: 2271 },
  'midi dress': { garmentGroup: 'dresses', googleCategoryId: 2271 },
  'maxi dress': { garmentGroup: 'dresses', googleCategoryId: 2271 },
  'mini dress': { garmentGroup: 'dresses', googleCategoryId: 2271 },
  'slip dress': { garmentGroup: 'dresses', googleCategoryId: 2271 },
  'tee dress': { garmentGroup: 'dresses', googleCategoryId: 2271 },
  'shirt dress': { garmentGroup: 'dresses', googleCategoryId: 2271 },
  'skater dress': { garmentGroup: 'dresses', googleCategoryId: 2271 },
  'flow dress': { garmentGroup: 'dresses', googleCategoryId: 2271 },
  'princess dress': { garmentGroup: 'dresses', googleCategoryId: 2271 },
  'flared dress': { garmentGroup: 'dresses', googleCategoryId: 2271 },
  'pocket dress': { garmentGroup: 'dresses', googleCategoryId: 2271 },
  'drawstring dress': { garmentGroup: 'dresses', googleCategoryId: 2271 },
  'satin dress': { garmentGroup: 'dresses', googleCategoryId: 2271 },

  // ── SETS ──
  'co-ord set': { garmentGroup: 'sets', googleCategoryId: 2271 },

  // ── ACCESSORIES ──
  'tote bag': { garmentGroup: 'accessories', googleCategoryId: 6553 },

  // ── FALLBACKS ──
  'uncategorized': { garmentGroup: 'tops', googleCategoryId: 212 },
  'Other': { garmentGroup: 'tops', googleCategoryId: 212 },
};

// ============================================
// HELPER FUNCTIONS
// ============================================

const DEFAULT_MAPPING: CategoryMapping = { garmentGroup: 'tops', googleCategoryId: 212 };

/** Get garment group for a category. Falls back to 'tops' for unknown categories. */
export function getGarmentGroup(category: string): GarmentGroup {
  return (CATEGORY_TAXONOMY[category] ?? DEFAULT_MAPPING).garmentGroup;
}

/** Get Google Product Category ID for a category. Falls back to 212 (Shirts & Tops). */
export function getGoogleCategoryId(category: string): number {
  return (CATEGORY_TAXONOMY[category] ?? DEFAULT_MAPPING).googleCategoryId;
}

/** Get the human-readable Google Product Category path from an ID. */
export function getGoogleCategoryPath(googleCategoryId: number): string {
  return GOOGLE_PRODUCT_CATEGORIES[googleCategoryId]?.path ?? 'Apparel & Accessories > Clothing';
}

/** Derive both garmentGroup and googleCategoryId from a category string. */
export function deriveTaxonomy(category: string): CategoryMapping {
  return CATEGORY_TAXONOMY[category] ?? DEFAULT_MAPPING;
}

// ============================================
// PRODUCT ATTRIBUTES
// ============================================

/** Construction method */
export const CONSTRUCTION_TYPES = ['knit', 'woven'] as const;
export type ConstructionType = (typeof CONSTRUCTION_TYPES)[number];

/** Sleeve style */
export const SLEEVE_TYPES = ['sleeveless', 'short-sleeve', 'three-quarter', 'long-sleeve'] as const;
export type SleeveType = (typeof SLEEVE_TYPES)[number];

/** Neckline style */
export const NECKLINES = ['crew', 'v-neck', 'polo', 'henley', 'collar', 'band-collar', 'notched-collar', 'hoodie', 'scoop', 'square'] as const;
export type Neckline = (typeof NECKLINES)[number];

/** Garment fit */
export const FIT_TYPES = ['slim', 'regular', 'relaxed', 'oversized'] as const;
export type FitType = (typeof FIT_TYPES)[number];

/** Garment length relative to body */
export const GARMENT_LENGTHS = ['cropped', 'regular', 'midi', 'maxi'] as const;
export type GarmentLength = (typeof GARMENT_LENGTHS)[number];

/** Primary closure mechanism */
export const CLOSURES = ['pullover', 'button-front', 'half-button', 'zip', 'elastic', 'drawstring', 'wrap'] as const;
export type Closure = (typeof CLOSURES)[number];

/**
 * Zod schema for product attributes stored in Product.attributes (JSONB).
 * All fields optional — not every attribute applies to every garment type.
 */
export const productAttributesSchema = z.object({
  // ── ERP-managed attributes ──
  constructionType: z.enum(CONSTRUCTION_TYPES).optional(),
  sleeveType: z.enum(SLEEVE_TYPES).optional(),
  neckline: z.enum(NECKLINES).optional(),
  fit: z.enum(FIT_TYPES).optional(),
  garmentLength: z.enum(GARMENT_LENGTHS).optional(),
  closure: z.enum(CLOSURES).optional(),
  fabricComposition: z.string().optional(),
  fabricWeight: z.number().positive().optional(),
  season: z.string().optional(),
  // ── Synced from Shopify metafields (see shopifyMetafieldSync.ts) ──
  washcare: z.string().optional(),
  shopifySleeveLength: z.string().optional(), // free-text from Shopify (key has typo: "sleeve_lenght")
  modelDetails: z.string().optional(),
  productTypeForFeed: z.string().optional(),
  offerText: z.string().optional(),
  moreColorText: z.string().optional(),
  linkedProductGids: z.array(z.string()).optional(), // Shopify product GIDs for color siblings
  colorUrls: z.array(z.string()).optional(),
  colorSwatches: z.array(z.string()).optional(), // hex codes
  recommendedProductGids: z.array(z.string()).optional(),
});

export type ProductAttributes = z.infer<typeof productAttributesSchema>;
