/**
 * ProductSearch - Reusable product search component for order modals
 *
 * Features:
 * - Multi-word search across product name, color, size, and SKU code
 * - Size-based sorting (XS -> 4XL)
 * - Stock badge display with on-demand balance fetching
 * - Auto-focus on mount
 *
 * Usage:
 * // With pre-loaded SKUs
 * <ProductSearch
 *   allSkus={skuList}
 *   inventoryBalance={balanceList}
 *   onSelect={(sku, stock) => handleSelect(sku, stock)}
 *   onCancel={() => setIsSearching(false)}
 * />
 *
 * // Self-fetching mode (fetches SKUs and balances internally)
 * <ProductSearch
 *   onSelect={(sku, stock) => handleSelect(sku, stock)}
 *   onCancel={() => setIsSearching(false)}
 * />
 */

import { useState, useMemo, useRef, useEffect, useCallback } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useServerFn } from '@tanstack/react-start';
import { Package, Search, Loader2 } from 'lucide-react';
import { sortBySizeOrder } from '../../constants/sizes';
import { getProductsList } from '../../server/functions/products';
import { getInventoryBalances } from '../../server/functions/inventory';

/** Balance info for a SKU */
interface BalanceInfo {
  skuId: string;
  availableBalance: number;
  currentBalance: number;
}

/** SKU structure (matches existing codebase patterns) */
export interface SKUData {
  id: string;
  skuCode?: string;
  size?: string;
  mrp?: number | string;
  variation?: {
    colorName?: string;
    imageUrl?: string;
    product?: {
      name?: string;
      imageUrl?: string;
    };
  };
}

/** Inventory balance structure */
export interface InventoryBalanceData {
  skuId: string;
  availableBalance?: number;
  currentBalance?: number;
}

export interface ProductSearchProps {
  /** Pre-loaded SKU list. If not provided, SKUs will be fetched via tRPC */
  allSkus?: SKUData[];
  /** Pre-loaded inventory balance. If not provided, balances will be fetched on-demand */
  inventoryBalance?: InventoryBalanceData[];
  /** Called when user selects a SKU */
  onSelect: (sku: SKUData, stock: number) => void;
  /** Called when user cancels the search */
  onCancel: () => void;
  /** Placeholder text for search input */
  placeholder?: string;
  /** Pre-fetched balances map (for advanced usage with CreateOrderModal) */
  fetchedBalances?: Map<string, number>;
  /** Callback to fetch balances on-demand (for advanced usage with CreateOrderModal) */
  onFetchBalances?: (skuIds: string[]) => void;
  /** Maximum height for results container (default: 18rem / 288px) */
  maxResultsHeight?: string;
  /** Additional CSS classes for the container */
  className?: string;
}

export function ProductSearch({
  allSkus: propsSkus,
  inventoryBalance,
  onSelect,
  onCancel,
  placeholder = 'e.g. pima crew blue xs',
  fetchedBalances,
  onFetchBalances,
  maxResultsHeight = '18rem',
  className = '',
}: ProductSearchProps) {
  const [query, setQuery] = useState('');
  const [localBalances, setLocalBalances] = useState<Map<string, BalanceInfo>>(new Map());
  const [fetchingBalanceFor, setFetchingBalanceFor] = useState<Set<string>>(new Set());
  const inputRef = useRef<HTMLInputElement>(null);

  // Server function for fetching inventory balances
  const getInventoryBalancesFn = useServerFn(getInventoryBalances);

  // Determine if we need to fetch SKUs internally
  const shouldFetchSkus = !propsSkus;

  // Fetch SKUs from Server Function if not provided
  const getProductsListFn = useServerFn(getProductsList);
  const { data: productsData, isLoading: isLoadingProducts } = useQuery({
    queryKey: ['products', 'list', { limit: 1000 }],
    queryFn: () => getProductsListFn({ data: { limit: 1000 } }),
    enabled: shouldFetchSkus,
    staleTime: 60000, // SKU list doesn't change often
    refetchOnWindowFocus: false,
  });

  // Transform products data into flat SKU list (for self-fetching mode)
  const fetchedSkus = useMemo(() => {
    if (!productsData?.products) return [];
    const skus: SKUData[] = [];
    productsData.products.forEach((product: any) => {
      product.variations?.forEach((variation: any) => {
        variation.skus?.forEach((sku: any) => {
          skus.push({
            ...sku,
            variation: {
              ...variation,
              product,
            },
          });
        });
      });
    });
    return skus;
  }, [productsData]);

  // Use provided SKUs or fetched SKUs
  const allSkus = propsSkus || fetchedSkus;

  // Auto-focus input on mount
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // Filter SKUs based on search query - supports multi-word search
  const filteredSkus = useMemo(() => {
    if (!query.trim()) return allSkus?.slice(0, 30) || [];

    // Split query into words and check if ALL words match somewhere
    const words = query.toLowerCase().split(/\s+/).filter(Boolean);

    return (allSkus || []).filter((sku: SKUData) => {
      const productName = sku.variation?.product?.name?.toLowerCase() || '';
      const colorName = sku.variation?.colorName?.toLowerCase() || '';
      const size = sku.size?.toLowerCase() || '';
      const skuCode = sku.skuCode?.toLowerCase() || '';

      // Combined searchable text
      const searchText = `${productName} ${colorName} ${size} ${skuCode}`;

      // All words must match somewhere in the combined text
      return words.every(word => searchText.includes(word));
    }).slice(0, 50);
  }, [allSkus, query]);

  // Sort results: by product name, then color, then size order (XS -> 4XL)
  const sortedSkus = useMemo(() => {
    return [...filteredSkus].sort((a: SKUData, b: SKUData) => {
      // First sort by product name
      const nameA = a.variation?.product?.name || '';
      const nameB = b.variation?.product?.name || '';
      const nameCompare = nameA.localeCompare(nameB);
      if (nameCompare !== 0) return nameCompare;

      // Then by color
      const colorA = a.variation?.colorName || '';
      const colorB = b.variation?.colorName || '';
      const colorCompare = colorA.localeCompare(colorB);
      if (colorCompare !== 0) return colorCompare;

      // Then by size order (XS -> 4XL)
      return sortBySizeOrder(a.size || '', b.size || '');
    });
  }, [filteredSkus]);

  // Fetch balances on-demand for displayed SKUs (self-managed mode)
  const fetchBalancesForSkus = useCallback(async (skuIds: string[]) => {
    // Filter out SKUs we already have balances for or are currently fetching
    const idsToFetch = skuIds.filter(
      id => !localBalances.has(id) && !fetchingBalanceFor.has(id)
    );

    if (idsToFetch.length === 0) return;

    // Mark as fetching
    setFetchingBalanceFor(prev => {
      const next = new Set(prev);
      idsToFetch.forEach(id => next.add(id));
      return next;
    });

    try {
      // Fetch balances via Server Function
      const balances = await getInventoryBalancesFn({ data: { skuIds: idsToFetch } });

      // Update local balances map
      setLocalBalances(prev => {
        const next = new Map(prev);
        balances.forEach((balance: any) => {
          next.set(balance.skuId, {
            skuId: balance.skuId,
            availableBalance: balance.availableBalance ?? balance.currentBalance ?? 0,
            currentBalance: balance.currentBalance ?? 0,
          });
        });
        return next;
      });
    } catch (error) {
      console.error('Failed to fetch inventory balances:', error);
      // On error, set balance to 0 for all requested SKUs to stop loading indicator
      setLocalBalances(prev => {
        const next = new Map(prev);
        idsToFetch.forEach(id => {
          next.set(id, {
            skuId: id,
            availableBalance: 0,
            currentBalance: 0,
          });
        });
        return next;
      });
    } finally {
      // Clear fetching state
      setFetchingBalanceFor(prev => {
        const next = new Set(prev);
        idsToFetch.forEach(id => next.delete(id));
        return next;
      });
    }
  }, [localBalances, fetchingBalanceFor, getInventoryBalancesFn]);

  // Trigger balance fetch when sorted SKUs change
  useEffect(() => {
    if (sortedSkus.length > 0) {
      // If external balance management is provided, use that
      if (onFetchBalances) {
        const skusToFetch = sortedSkus
          .filter((sku: SKUData) => getBalance(sku.id) === null)
          .map((sku: SKUData) => sku.id);
        if (skusToFetch.length > 0) {
          onFetchBalances(skusToFetch);
        }
      } else if (!inventoryBalance) {
        // Otherwise use internal balance fetching
        const skuIds = sortedSkus.map((sku: SKUData) => sku.id);
        fetchBalancesForSkus(skuIds);
      }
    }
  }, [sortedSkus, onFetchBalances, inventoryBalance, fetchBalancesForSkus]);

  // Get balance for a SKU from various sources
  const getBalance = useCallback((skuId: string): number | null => {
    // Check pre-fetched inventory balance first (passed via props)
    if (inventoryBalance) {
      const preloaded = inventoryBalance.find((i) => i.skuId === skuId);
      if (preloaded) return preloaded.availableBalance ?? preloaded.currentBalance ?? 0;
    }

    // Check external fetchedBalances (CreateOrderModal pattern)
    if (fetchedBalances?.has(skuId)) {
      return fetchedBalances.get(skuId)!;
    }

    // Check local balances (self-managed fetching)
    const localBalance = localBalances.get(skuId);
    if (localBalance) return localBalance.availableBalance;

    // Currently fetching
    if (fetchingBalanceFor.has(skuId)) return null;

    return null; // Not yet fetched
  }, [inventoryBalance, fetchedBalances, localBalances, fetchingBalanceFor]);

  return (
    <div className={`border border-slate-200 rounded-xl bg-white overflow-hidden shadow-sm ${className}`}>
      {/* Search Input */}
      <div className="p-3 border-b border-slate-100">
        <div className="relative">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={placeholder}
            className="w-full pl-10 pr-4 py-2.5 text-sm border border-slate-200 rounded-lg bg-slate-50 focus:bg-white focus:border-sky-400 focus:ring-2 focus:ring-sky-100 outline-none transition-all"
            autoComplete="off"
          />
        </div>
      </div>

      {/* Results */}
      <div className="overflow-y-auto" style={{ maxHeight: maxResultsHeight }}>
        {shouldFetchSkus && isLoadingProducts ? (
          <div className="p-6 text-center">
            <Loader2 size={24} className="mx-auto text-sky-500 animate-spin mb-2" />
            <p className="text-sm text-slate-500">Loading products...</p>
          </div>
        ) : sortedSkus.length === 0 ? (
          <div className="p-6 text-center">
            <Package size={24} className="mx-auto text-slate-300 mb-2" />
            <p className="text-sm text-slate-500">No products found</p>
          </div>
        ) : (
          <div className="divide-y divide-slate-50">
            {sortedSkus.map((sku: SKUData) => {
              const balance = getBalance(sku.id);
              const stockNum = balance ?? 0;
              const isLoading = balance === null;
              const isOutOfStock = stockNum <= 0 && !isLoading;
              const isLowStock = stockNum > 0 && stockNum <= 3;

              // Use variation image if available, fallback to product image
              const imageUrl = sku.variation?.imageUrl || sku.variation?.product?.imageUrl;

              return (
                <button
                  key={sku.id}
                  type="button"
                  onClick={() => onSelect(sku, stockNum)}
                  className="w-full px-3 py-2.5 flex items-center gap-3 hover:bg-sky-50 transition-colors text-left"
                >
                  {/* Thumbnail */}
                  <div className={`shrink-0 w-10 h-10 rounded-lg overflow-hidden bg-slate-100 ${isOutOfStock ? 'opacity-50' : ''}`}>
                    {imageUrl ? (
                      <img
                        src={imageUrl}
                        alt={sku.variation?.product?.name || 'Product'}
                        className="w-full h-full object-cover"
                      />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center">
                        <Package size={16} className="text-slate-300" />
                      </div>
                    )}
                  </div>
                  {/* Product Info */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className={`text-sm font-medium truncate ${isOutOfStock ? 'text-slate-400' : 'text-slate-900'}`}>
                        {sku.variation?.product?.name}
                      </span>
                    </div>
                    <div className="flex items-center gap-1.5 mt-0.5">
                      <span className={`text-xs ${isOutOfStock ? 'text-slate-400' : 'text-slate-600'}`}>
                        {sku.variation?.colorName}
                      </span>
                      <span className="text-slate-300">.</span>
                      <span className={`text-xs font-medium ${isOutOfStock ? 'text-slate-400' : 'text-slate-700'}`}>
                        {sku.size}
                      </span>
                      <span className="text-slate-300">.</span>
                      <span className="text-xs text-slate-400 font-mono">
                        {sku.skuCode}
                      </span>
                    </div>
                  </div>
                  <div className={`shrink-0 ml-3 px-2 py-1 rounded text-xs font-medium ${
                    isLoading
                      ? 'bg-slate-100 text-slate-400'
                      : isOutOfStock
                      ? 'bg-slate-100 text-slate-500'
                      : isLowStock
                      ? 'bg-amber-100 text-amber-700'
                      : 'bg-emerald-100 text-emerald-700'
                  }`}>
                    {isLoading ? (
                      <Loader2 size={12} className="animate-spin" />
                    ) : (
                      stockNum
                    )}
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="px-3 py-2 border-t border-slate-100 bg-slate-50 flex items-center justify-between">
        <span className="text-xs text-slate-400">
          {sortedSkus.length} result{sortedSkus.length !== 1 ? 's' : ''}
        </span>
        <button
          type="button"
          onClick={onCancel}
          className="px-3 py-1.5 text-xs text-slate-600 hover:text-slate-800 hover:bg-slate-200 rounded transition-colors"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

export default ProductSearch;
