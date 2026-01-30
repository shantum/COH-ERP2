/**
 * BOM Services
 *
 * NOTE: This module uses dynamic imports internally to prevent
 * client bundling issues with Node.js-specific code.
 */

export {
  recalculateSkuBomCost,
  recalculateVariationBomCost,
  recalculateVariationAndSkuBomCosts,
  getVariationIdForSku,
  getVariationIdsForProduct,
} from './bomCostService.js';

export {
  getVariationMainFabric,
  getVariationsMainFabrics,
  getProductVariationsFabrics,
  hasMainFabricBom,
  type VariationMainFabric,
} from './fabricFromBom.js';
