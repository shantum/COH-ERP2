import { ShopifyClient } from './client.js';
import { shopifyLogger } from '../../utils/logger.js';

// Export the class for typing purposes
export { ShopifyClient } from './client.js';

// Re-export all types so existing `import type { ShopifyOrder } from '...services/shopify.js'` works
export type {
    ShopifyOrder,
    ShopifyCustomer,
    ShopifyProduct,
    ShopifyVariant,
    ShopifyLineItem,
    ShopifyFulfillment,
    ShopifyMetafield,
    ShopifyTransaction,
    ShopifyAddress,
    FormattedAddress,
    OrderOptions,
    CustomerOptions,
    ProductOptions,
    MarkPaidResult,
    ShopifyConfigStatus,
    ShopifyLocation,
    SetInventoryResult,
    InventoryItemInfo,
    VariantFeedData,
    ProductFeedData,
} from './types.js';

export type { MetafieldSetResult, CategorySetResult } from './metafields.js';
export { extractMetafieldAttributes } from './metafields.js';

// Export singleton instance
const shopifyClient = new ShopifyClient();

// Load configuration from database on startup
shopifyClient.loadFromDatabase().catch(err => shopifyLogger.error({ error: err.message }, 'Failed to load Shopify config'));

export default shopifyClient;
