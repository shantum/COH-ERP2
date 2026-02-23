/**
 * Products Server Functions
 *
 * Barrel export for all products-related server functions.
 */

export { getProductsTree, type ProductsTreeInput, type ProductsTreeResponse, type ProductNode, type VariationNode, type SkuNode, type ShopifyStatus } from './tree';
export { getProductsList, type GetProductsListInput } from './list';
export { getProductById, type ProductDetailResponse, type VariationDetailResponse, type SkuDetailResponse } from './detail';
export { getCatalogFilters, type CatalogFiltersResponse } from './catalog';
export { getStyleCodes, type StyleCodesResponse } from './styleCodes';
export { searchSkusForAutocomplete, resolveSkuCodes } from './skuSearch';
