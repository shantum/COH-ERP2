/**
 * Catalog Data Aggregation Functions
 *
 * Provides aggregation strategies for transforming flat SKU data into different view levels:
 * - Variation: Group by color (product + color)
 * - Product: Group by style (all colors/sizes per product)
 * - Consumption: Fabric matrix (sizes × fabric consumption)
 */

import { getGstRate } from '@coh/shared/domain/constants';

// Standard sizes for consumption matrix
export const CONSUMPTION_SIZES = ['XS', 'S', 'M', 'L', 'XL', '2XL', '3XL', '4XL', 'Free'];

/**
 * Catalog SKU item from server — dynamic row shape used across all aggregation levels.
 * Using Record because server returns many optional fields and aggregation
 * adds/removes temporary sum fields dynamically.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type CatalogRow = Record<string, any>;

/**
 * Groups SKUs by variation (color). Sums: balances, shopifyQty. Uses variation-level costs.
 * @param items - Flat SKU list from API with inventory + pricing data
 * @returns Aggregated rows keyed by variationId, skuIds[] for bulk updates
 */
export function aggregateByVariation(items: CatalogRow[]): CatalogRow[] {
    const groups = new Map<string, CatalogRow>();

    for (const item of items) {
        const key = item.variationId;
        if (!key) continue;

        if (!groups.has(key)) {
            groups.set(key, {
                ...item,
                skuCode: `${item.styleCode}-${item.colorName}`,
                size: '-',
                currentBalance: 0,
                reservedBalance: 0,
                availableBalance: 0,
                shopifyQty: null,
                targetStockQty: null,
                skuCount: 0,
                skuIds: [], // Track all SKU IDs for bulk updates
                // Use variation-level costs for editing
                packagingCost: item.variationPackagingCost ?? item.productPackagingCost ?? item.globalPackagingCost ?? null,
                laborMinutes: item.variationLaborMinutes ?? item.productLaborMinutes ?? null,
                // Track sums for averaging
                _mrpSum: 0,
                _fabricConsumptionSum: 0,
                _bomCostSum: 0,
                _laborCostSum: 0,
                _totalCostSum: 0,
                _exGstPriceSum: 0,
                _gstAmountSum: 0,
            });
        }

        const group = groups.get(key)!;
        group.skuIds.push(item.skuId); // Collect SKU IDs
        group.currentBalance += item.currentBalance || 0;
        group.reservedBalance += item.reservedBalance || 0;
        group.availableBalance += item.availableBalance || 0;
        group.skuCount += 1;
        // Sum values for averaging
        group._mrpSum += item.mrp || 0;
        group._fabricConsumptionSum += item.fabricConsumption || 0;
        group._bomCostSum += item.bomCost || 0;
        group._laborCostSum += item.laborCost || 0;
        group._totalCostSum += item.totalCost || 0;
        group._exGstPriceSum += item.exGstPrice || 0;
        group._gstAmountSum += item.gstAmount || 0;
    }

    // Calculate averages and status
    for (const group of groups.values()) {
        // Show SKU count in SKU Code column at variation level
        group.skuCode = group.skuCount === 1 ? '1 SKU' : `${group.skuCount} SKUs`;
        group.status = group.availableBalance === 0 ? 'out_of_stock' :
                       group.availableBalance < 10 ? 'below_target' : 'ok';
        // Calculate averages
        if (group.skuCount > 0) {
            group.mrp = Math.round(group._mrpSum / group.skuCount);
            group.fabricConsumption = Math.round((group._fabricConsumptionSum / group.skuCount) * 100) / 100;
            group.bomCost = Math.round(group._bomCostSum / group.skuCount);
            group.laborCost = Math.round(group._laborCostSum / group.skuCount);
            group.totalCost = Math.round(group._totalCostSum / group.skuCount);
            group.exGstPrice = Math.round(group._exGstPriceSum / group.skuCount);
            group.gstAmount = Math.round(group._gstAmountSum / group.skuCount);
            // Calculate cost multiple from averaged values
            group.costMultiple = group.totalCost > 0 ? Math.round((group.mrp / group.totalCost) * 100) / 100 : null;
            // GST rate based on averaged MRP (threshold-based)
            group.gstRate = getGstRate(group.mrp);
        }
        // Clean up temp fields
        delete group._mrpSum;
        delete group._fabricConsumptionSum;
        delete group._bomCostSum;
        delete group._laborCostSum;
        delete group._totalCostSum;
        delete group._exGstPriceSum;
        delete group._gstAmountSum;
    }

    return Array.from(groups.values());
}

/**
 * Groups SKUs by product (across all colors). Sums: balances, shopifyQty. Uses product-level costs.
 * @param items - Flat SKU list from API with inventory + pricing data
 * @returns Aggregated rows keyed by productId, skuIds[] for bulk updates
 */
export function aggregateByProduct(items: CatalogRow[]): CatalogRow[] {
    const groups = new Map<string, CatalogRow>();

    for (const item of items) {
        const key = item.productId;
        if (!key) continue;

        if (!groups.has(key)) {
            groups.set(key, {
                ...item,
                skuCode: item.styleCode,
                colorName: '-',
                fabricName: '-',
                // Keep first image URL for product thumbnail
                imageUrl: item.imageUrl || null,
                size: '-',
                currentBalance: 0,
                reservedBalance: 0,
                availableBalance: 0,
                shopifyQty: null,
                targetStockQty: null,
                variationCount: 0,
                skuCount: 0,
                skuIds: [], // Track all SKU IDs for bulk updates
                _uniqueFabricIds: new Set<string>(), // Track unique fabric IDs
                // Use product-level costs for editing
                packagingCost: item.productPackagingCost ?? item.globalPackagingCost ?? null,
                laborMinutes: item.productLaborMinutes ?? null,
                hasLining: false, // Will be set to true if any variation has lining
                // Track sums for averaging
                _mrpSum: 0,
                _fabricConsumptionSum: 0,
                _bomCostSum: 0,
                _laborCostSum: 0,
                _totalCostSum: 0,
                _exGstPriceSum: 0,
                _gstAmountSum: 0,
            });
        }

        const group = groups.get(key)!;
        group.skuIds.push(item.skuId); // Collect SKU IDs
        if (item.fabricId) group._uniqueFabricIds.add(item.fabricId); // Track unique fabrics
        group.currentBalance += item.currentBalance || 0;
        group.reservedBalance += item.reservedBalance || 0;
        group.availableBalance += item.availableBalance || 0;
        group.skuCount += 1;
        // Track if any variation has lining
        if (item.hasLining) group.hasLining = true;
        // Sum values for averaging
        group._mrpSum += item.mrp || 0;
        group._fabricConsumptionSum += item.fabricConsumption || 0;
        group._bomCostSum += item.bomCost || 0;
        group._laborCostSum += item.laborCost || 0;
        group._totalCostSum += item.totalCost || 0;
        group._exGstPriceSum += item.exGstPrice || 0;
        group._gstAmountSum += item.gstAmount || 0;
    }

    // Count unique variations per product and calculate status/averages
    const variationCounts = new Map<string, Set<string>>();
    for (const item of items) {
        if (!variationCounts.has(item.productId)) {
            variationCounts.set(item.productId, new Set());
        }
        variationCounts.get(item.productId)!.add(item.variationId);
    }

    for (const [productId, group] of groups.entries()) {
        group.variationCount = variationCounts.get(productId)?.size || 0;
        // Show color count, fabric count, and SKU count at product level
        const colorCount = group.variationCount;
        const fabricCount = group._uniqueFabricIds?.size || 0;
        group.colorName = colorCount === 1 ? '1 color' : `${colorCount} colors`;
        group.fabricName = fabricCount === 1 ? '1 fabric' : `${fabricCount} fabrics`;
        group.skuCode = group.skuCount === 1 ? '1 SKU' : `${group.skuCount} SKUs`;
        group.status = group.availableBalance === 0 ? 'out_of_stock' :
                       group.availableBalance < 20 ? 'below_target' : 'ok';
        // Calculate averages
        if (group.skuCount > 0) {
            group.mrp = Math.round(group._mrpSum / group.skuCount);
            group.fabricConsumption = Math.round((group._fabricConsumptionSum / group.skuCount) * 100) / 100;
            group.bomCost = Math.round(group._bomCostSum / group.skuCount);
            group.laborCost = Math.round(group._laborCostSum / group.skuCount);
            group.totalCost = Math.round(group._totalCostSum / group.skuCount);
            group.exGstPrice = Math.round(group._exGstPriceSum / group.skuCount);
            group.gstAmount = Math.round(group._gstAmountSum / group.skuCount);
            // Calculate cost multiple from averaged values
            group.costMultiple = group.totalCost > 0 ? Math.round((group.mrp / group.totalCost) * 100) / 100 : null;
            // GST rate based on averaged MRP (threshold-based)
            group.gstRate = getGstRate(group.mrp);
        }
        // Clean up temp fields
        delete group._mrpSum;
        delete group._fabricConsumptionSum;
        delete group._bomCostSum;
        delete group._laborCostSum;
        delete group._totalCostSum;
        delete group._exGstPriceSum;
        delete group._gstAmountSum;
        delete group._uniqueFabricIds;
    }

    return Array.from(groups.values());
}

/**
 * Aggregate SKU data by product for consumption matrix view.
 * Creates one row per product with size columns showing fabric consumption.
 * @param items - Flat SKU list from API
 * @returns Aggregated rows with consumption_<size> columns
 */
export function aggregateByConsumption(items: CatalogRow[]): CatalogRow[] {
    const groups = new Map<string, CatalogRow>();

    for (const item of items) {
        const key = item.productId;
        if (!key) continue;

        if (!groups.has(key)) {
            groups.set(key, {
                productId: item.productId,
                productName: item.productName,
                styleCode: item.styleCode,
                category: item.category,
                gender: item.gender,
                // Initialize size columns
                ...Object.fromEntries(CONSUMPTION_SIZES.map(size => [`consumption_${size}`, null])),
                // Track SKU IDs for each size (for updates)
                ...Object.fromEntries(CONSUMPTION_SIZES.map(size => [`skuIds_${size}`, []])),
            });
        }

        const group = groups.get(key)!;
        const sizeKey = `consumption_${item.size}`;
        const skuIdsKey = `skuIds_${item.size}`;

        // Set consumption value (should be same for all colors of same product+size)
        if (group[sizeKey] === null && item.fabricConsumption != null) {
            group[sizeKey] = item.fabricConsumption;
        }
        // Collect SKU IDs for this size
        if (group[skuIdsKey]) {
            group[skuIdsKey].push(item.skuId);
        }
    }

    return Array.from(groups.values());
}
