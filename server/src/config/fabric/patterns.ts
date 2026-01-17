/**
 * Fabric Pattern Configuration
 *
 * Defines textile classification dimensions for the Material hierarchy:
 * - Construction types: knit, woven
 * - Patterns: specific weave/knit patterns (single jersey, french terry, twill, etc.)
 * - Weight units: gsm, lea, oz
 *
 * These are config-driven values used in the Fabric model.
 * Add new patterns here without requiring schema migrations.
 *
 * TO ADD A NEW PATTERN:
 * 1. Add entry to FABRIC_PATTERNS under the appropriate construction type
 * 2. Code should be lowercase_snake_case (stored in DB)
 * 3. Name is display text (shown in UI)
 */

// ============================================
// CONSTRUCTION TYPES
// ============================================

export const CONSTRUCTION_TYPES = ['knit', 'woven'] as const;
export type ConstructionType = (typeof CONSTRUCTION_TYPES)[number];

export const CONSTRUCTION_TYPE_LABELS: Record<ConstructionType, string> = {
  knit: 'Knit',
  woven: 'Woven',
};

// ============================================
// FABRIC PATTERNS BY CONSTRUCTION TYPE
// ============================================

export interface FabricPattern {
  /** Unique code stored in DB (lowercase_snake_case) */
  code: string;
  /** Display name for UI */
  name: string;
  /** Optional description */
  description?: string;
}

export const FABRIC_PATTERNS: Record<ConstructionType, FabricPattern[]> = {
  knit: [
    { code: 'single_jersey', name: 'Single Jersey', description: 'Basic knit, smooth on one side' },
    { code: 'french_terry', name: 'French Terry', description: 'Looped back, soft and absorbent' },
    { code: 'rib', name: 'Rib', description: 'Vertical ridges, stretchy' },
    { code: 'interlock', name: 'Interlock', description: 'Double knit, smooth both sides' },
    { code: 'fleece', name: 'Fleece', description: 'Brushed knit, warm and soft' },
    { code: 'pique', name: 'Pique', description: 'Textured knit, used in polos' },
    { code: 'ponte', name: 'Ponte', description: 'Heavy knit, structured drape' },
    { code: 'waffle', name: 'Waffle', description: 'Grid texture, breathable' },
  ],
  woven: [
    { code: 'plain', name: 'Plain Weave', description: 'Basic over-under weave' },
    { code: 'twill', name: 'Twill', description: 'Diagonal rib pattern' },
    { code: 'satin', name: 'Satin', description: 'Smooth, lustrous surface' },
    { code: 'poplin', name: 'Poplin', description: 'Fine crosswise rib' },
    { code: 'chambray', name: 'Chambray', description: 'Colored warp, white weft' },
    { code: 'linen_regular', name: 'Linen Regular', description: 'Standard linen weave' },
    { code: 'oxford', name: 'Oxford', description: 'Basket weave, soft texture' },
    { code: 'dobby', name: 'Dobby', description: 'Small geometric patterns' },
    { code: 'jacquard', name: 'Jacquard', description: 'Complex woven patterns' },
    { code: 'voile', name: 'Voile', description: 'Sheer, lightweight plain weave' },
    { code: 'canvas', name: 'Canvas', description: 'Heavy, durable plain weave' },
    { code: 'denim', name: 'Denim', description: 'Twill with indigo warp' },
  ],
} as const;

/** Get all patterns as a flat array */
export function getAllPatterns(): FabricPattern[] {
  return Object.values(FABRIC_PATTERNS).flat();
}

/** Get patterns for a specific construction type */
export function getPatternsByType(type: ConstructionType): FabricPattern[] {
  return FABRIC_PATTERNS[type] || [];
}

/** Get pattern by code */
export function getPatternByCode(code: string): FabricPattern | undefined {
  return getAllPatterns().find((p) => p.code === code);
}

/** Validate pattern code exists */
export function isValidPattern(code: string): boolean {
  return getAllPatterns().some((p) => p.code === code);
}

// ============================================
// WEIGHT UNITS
// ============================================

export interface WeightUnit {
  /** Unique code stored in DB */
  code: string;
  /** Display name */
  name: string;
  /** Full description */
  description: string;
  /** Higher number = heavier fabric (for sorting) */
  direction: 'higher_heavier' | 'higher_lighter';
}

export const WEIGHT_UNITS: WeightUnit[] = [
  {
    code: 'gsm',
    name: 'GSM',
    description: 'Grams per square meter - standard metric weight',
    direction: 'higher_heavier',
  },
  {
    code: 'lea',
    name: 'Lea',
    description: 'Linen count - higher number means finer/lighter fabric',
    direction: 'higher_lighter',
  },
  {
    code: 'oz',
    name: 'oz/yd²',
    description: 'Ounces per square yard - imperial weight',
    direction: 'higher_heavier',
  },
];

/** Get weight unit by code */
export function getWeightUnit(code: string): WeightUnit | undefined {
  return WEIGHT_UNITS.find((u) => u.code === code);
}

/** Validate weight unit code */
export function isValidWeightUnit(code: string): boolean {
  return WEIGHT_UNITS.some((u) => u.code === code);
}

// ============================================
// STANDARD COLORS (for normalization)
// ============================================

/**
 * Standard color names for normalization
 * Map color variants to a standard base color for grouping/filtering
 */
export const STANDARD_COLORS = [
  'white',
  'black',
  'grey',
  'navy',
  'blue',
  'red',
  'green',
  'yellow',
  'orange',
  'pink',
  'purple',
  'brown',
  'beige',
  'cream',
  'ivory',
  'khaki',
  'olive',
  'teal',
  'maroon',
  'burgundy',
  'rust',
  'coral',
  'gold',
  'silver',
  'indigo',
  'natural',
  'multicolor',
] as const;

export type StandardColor = (typeof STANDARD_COLORS)[number];

/** Normalize a color name to standard color */
export function normalizeColor(colorName: string): StandardColor | null {
  const lower = colorName.toLowerCase().trim();

  // Direct match
  if (STANDARD_COLORS.includes(lower as StandardColor)) {
    return lower as StandardColor;
  }

  // Common mappings
  const mappings: Record<string, StandardColor> = {
    // White variants
    'off-white': 'cream',
    'off white': 'cream',
    offwhite: 'cream',
    ecru: 'cream',
    // Grey variants
    gray: 'grey',
    charcoal: 'grey',
    'grey melange': 'grey',
    'gray melange': 'grey',
    // Blue variants
    'navy blue': 'navy',
    'royal blue': 'blue',
    'sky blue': 'blue',
    cobalt: 'blue',
    // Brown variants
    tan: 'brown',
    chocolate: 'brown',
    coffee: 'brown',
    camel: 'beige',
    // Pink variants
    blush: 'pink',
    rose: 'pink',
    salmon: 'coral',
    // Green variants
    sage: 'green',
    mint: 'green',
    emerald: 'green',
    forest: 'green',
    // Red variants
    wine: 'burgundy',
    crimson: 'red',
    scarlet: 'red',
  };

  return mappings[lower] || null;
}
