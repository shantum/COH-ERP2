/**
 * Shopify Metafield Sync Configuration
 *
 * Maps ERP fields to Shopify metafields for bidirectional sync.
 * All pushEnabled flags are OFF by default — pushing requires explicit user action.
 *
 * Metafield keys verified against live Shopify API data (2026-02-27).
 */

export interface MetafieldSyncField {
  /** Human-readable label for UI */
  label: string;
  /** Shopify metafield namespace */
  shopifyNamespace: string;
  /** Shopify metafield key */
  shopifyKey: string;
  /** Shopify metafield value type (must match exactly or mutation fails) */
  shopifyType: string;
  /** Where this lives in ERP: 'attributes.{key}' for JSONB, or top-level field name */
  erpPath: string;
  /** Pull from Shopify → ERP during product sync */
  pullEnabled: boolean;
  /** Push from ERP → Shopify (OFF by default for safety) */
  pushEnabled: boolean;
}

/**
 * All known Shopify metafields for COH products.
 * Keys are internal identifiers used in push/pull operations.
 */
export const METAFIELD_SYNC_FIELDS: Record<string, MetafieldSyncField> = {
  washcare: {
    label: 'Wash Care',
    shopifyNamespace: 'my_fields',
    shopifyKey: 'washcare',
    shopifyType: 'multi_line_text_field',
    erpPath: 'attributes.washcare',
    pullEnabled: true,
    pushEnabled: false,
  },
  fabric: {
    label: 'Fabric',
    shopifyNamespace: 'my_fields',
    shopifyKey: 'fabric',
    shopifyType: 'single_line_text_field',
    erpPath: 'attributes.fabricComposition',
    pullEnabled: true,
    pushEnabled: false,
  },
  sleeveLength: {
    label: 'Sleeve Length',
    shopifyNamespace: 'my_fields',
    shopifyKey: 'sleeve_lenght', // typo is in Shopify — do NOT fix
    shopifyType: 'single_line_text_field',
    erpPath: 'attributes.shopifySleeveLength',
    pullEnabled: true,
    pushEnabled: false,
  },
  gender: {
    label: 'Gender',
    shopifyNamespace: 'my_fields',
    shopifyKey: 'gender',
    shopifyType: 'single_line_text_field',
    erpPath: 'gender', // top-level Product field
    pullEnabled: false, // has its own extraction logic in product sync
    pushEnabled: false,
  },
  modelDetails: {
    label: 'Model Details',
    shopifyNamespace: 'my_fields',
    shopifyKey: 'model_instruction',
    shopifyType: 'single_line_text_field',
    erpPath: 'attributes.modelDetails',
    pullEnabled: true,
    pushEnabled: false,
  },
  productTypeForFeed: {
    label: 'Product Type for Feed',
    shopifyNamespace: 'custom',
    shopifyKey: 'product_type_for_feed',
    shopifyType: 'single_line_text_field',
    erpPath: 'attributes.productTypeForFeed',
    pullEnabled: true,
    pushEnabled: false,
  },
  productVariants: {
    label: 'Product Variants (color siblings)',
    shopifyNamespace: 'custom',
    shopifyKey: 'product_variants',
    shopifyType: 'list.product_reference',
    erpPath: 'attributes.linkedProductGids',
    pullEnabled: true,
    pushEnabled: false,
  },
  colorUrls: {
    label: 'Color URLs',
    shopifyNamespace: 'custom',
    shopifyKey: 'product_color_url',
    shopifyType: 'list.url',
    erpPath: 'attributes.colorUrls',
    pullEnabled: true,
    pushEnabled: false,
  },
  colorSwatches: {
    label: 'Color Swatches',
    shopifyNamespace: 'custom',
    shopifyKey: 'pr_color',
    shopifyType: 'list.color',
    erpPath: 'attributes.colorSwatches',
    pullEnabled: true,
    pushEnabled: false,
  },
  moreColorText: {
    label: 'More Color Text',
    shopifyNamespace: 'custom',
    shopifyKey: 'more_color_text',
    shopifyType: 'single_line_text_field',
    erpPath: 'attributes.moreColorText',
    pullEnabled: true,
    pushEnabled: false,
  },
  offerText: {
    label: 'Offer Text',
    shopifyNamespace: 'custom',
    shopifyKey: 'offer_text',
    shopifyType: 'single_line_text_field',
    erpPath: 'attributes.offerText',
    pullEnabled: true,
    pushEnabled: false,
  },
  googleProductCategory: {
    label: 'Google Product Category',
    shopifyNamespace: 'mm-google-shopping',
    shopifyKey: 'google_product_category',
    shopifyType: 'string',
    erpPath: 'googleProductCategoryId', // top-level Product field
    pullEnabled: false, // ERP derives this from category — don't overwrite
    pushEnabled: false,
  },
  recommendedProducts: {
    label: 'Recommended Products',
    shopifyNamespace: 'recommended_products',
    shopifyKey: 'product_1',
    shopifyType: 'list.product_reference',
    erpPath: 'attributes.recommendedProductGids',
    pullEnabled: true,
    pushEnabled: false,
  },
};

/** Get all field keys that support pushing */
export function getPushableFieldKeys(): string[] {
  return Object.keys(METAFIELD_SYNC_FIELDS);
}

/** Get fields currently enabled for pull */
export function getPullEnabledFields(): Array<[string, MetafieldSyncField]> {
  return Object.entries(METAFIELD_SYNC_FIELDS).filter(([, f]) => f.pullEnabled);
}

/** Get fields currently enabled for push */
export function getPushEnabledFields(): Array<[string, MetafieldSyncField]> {
  return Object.entries(METAFIELD_SYNC_FIELDS).filter(([, f]) => f.pushEnabled);
}
