import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { inventoryApi, productsApi } from '../services/api';
import { useState, useMemo } from 'react';
import { Plus, Eye, X, ArrowDownCircle, ArrowUpCircle, ChevronRight, Package, AlertTriangle } from 'lucide-react';

interface InventoryItem {
    skuId: string;
    skuCode: string;
    productId: string;
    productName: string;
    productType: string;
    gender: string | null;
    colorName: string;
    variationId: string;
    size: string;
    category: string;
    imageUrl: string | null;
    currentBalance: number;
    reservedBalance: number;
    availableBalance: number;
    totalInward: number;
    totalOutward: number;
    targetStockQty: number;
    status: string;
    mrp: number;
    shopifyQty: number | null;
}

interface GroupedInventory {
    productName: string;
    productId: string;
    productType: string;
    gender: string | null;
    imageUrl: string | null;
    colors: {
        colorName: string;
        variationId: string;
        imageUrl: string | null;
        items: InventoryItem[];
        totalStock: number;
        totalShopify: number;
    }[];
    totalStock: number;
    totalShopify: number;
}

export default function Inventory() {
    const queryClient = useQueryClient();
    const { data: balance, isLoading } = useQuery<InventoryItem[]>({ queryKey: ['inventoryBalance'], queryFn: () => inventoryApi.getBalance().then(r => r.data) });
    const { data: alerts } = useQuery({ queryKey: ['stockAlerts'], queryFn: () => inventoryApi.getAlerts().then(r => r.data) });
    const { data: skus } = useQuery({ queryKey: ['allSkus'], queryFn: () => productsApi.getAllSkus().then(r => r.data) });

    const [showInward, setShowInward] = useState(false);
    const [inwardForm, setInwardForm] = useState({ skuCode: '', qty: 1, reason: 'production', notes: '' });
    const [filter, setFilter] = useState({ belowTarget: false, search: '', gender: '', productType: '', colorName: '' });
    const [showDetail, setShowDetail] = useState<InventoryItem | null>(null);
    const [expandedProducts, setExpandedProducts] = useState<Set<string>>(new Set());
    const [expandedColors, setExpandedColors] = useState<Set<string>>(new Set());

    // Fetch transactions when detail view is open
    const { data: transactions, isLoading: txnLoading } = useQuery({
        queryKey: ['skuTransactions', showDetail?.skuId],
        queryFn: () => inventoryApi.getSkuTransactions(showDetail!.skuId).then(r => r.data),
        enabled: !!showDetail?.skuId
    });

    const quickInward = useMutation({
        mutationFn: (data: { skuCode: string; qty: number; reason: string; notes: string }) => inventoryApi.quickInward(data),
        onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['inventoryBalance'] }); setShowInward(false); setInwardForm({ skuCode: '', qty: 1, reason: 'production', notes: '' }); }
    });

    // Get unique genders, product types and colors for filters
    const filterOptions = useMemo(() => {
        if (!balance) return { genders: [] as string[], productTypes: [] as string[], colors: [] as string[] };

        // Get unique genders
        const genders = Array.from(new Set(balance.map(b => b.gender).filter(Boolean))).sort() as string[];

        // Products filtered by selected gender (if any)
        let filteredByGender = balance;
        if (filter.gender) {
            filteredByGender = balance.filter(b => b.gender === filter.gender);
        }
        const productTypes = Array.from(new Set(filteredByGender.map(b => b.productName))).sort();

        // Colors filtered by selected product type
        let colors: string[] = [];
        if (filter.productType) {
            colors = Array.from(new Set(balance
                .filter(b => b.productName === filter.productType)
                .map(b => b.colorName)
            )).sort();
        }

        return { genders, productTypes, colors };
    }, [balance, filter.gender, filter.productType]);

    // Group and filter inventory data
    const groupedInventory = useMemo(() => {
        if (!balance) return [];

        // Filter first
        const filtered = balance.filter(b => {
            if (filter.belowTarget && b.status !== 'below_target') return false;
            if (filter.gender && b.gender !== filter.gender) return false;
            if (filter.productType && b.productName !== filter.productType) return false;
            if (filter.colorName && b.colorName !== filter.colorName) return false;
            if (filter.search) {
                const searchLower = filter.search.toLowerCase();
                if (!b.skuCode.toLowerCase().includes(searchLower) &&
                    !b.productName.toLowerCase().includes(searchLower) &&
                    !b.colorName.toLowerCase().includes(searchLower)) {
                    return false;
                }
            }
            return true;
        });

        // Group by product, then by color
        const productMap = new Map<string, GroupedInventory>();

        filtered.forEach(item => {
            if (!productMap.has(item.productId)) {
                productMap.set(item.productId, {
                    productName: item.productName,
                    productId: item.productId,
                    productType: item.productType,
                    gender: item.gender,
                    imageUrl: item.imageUrl,
                    colors: [],
                    totalStock: 0,
                    totalShopify: 0,
                });
            }

            const product = productMap.get(item.productId)!;
            let colorGroup = product.colors.find(c => c.variationId === item.variationId);

            if (!colorGroup) {
                colorGroup = {
                    colorName: item.colorName,
                    variationId: item.variationId,
                    imageUrl: item.imageUrl,
                    items: [],
                    totalStock: 0,
                    totalShopify: 0,
                };
                product.colors.push(colorGroup);
            }

            colorGroup.items.push(item);
            colorGroup.totalStock += item.availableBalance;
            colorGroup.totalShopify += item.shopifyQty ?? 0;
            product.totalStock += item.availableBalance;
            product.totalShopify += item.shopifyQty ?? 0;
        });

        // Sort products by name, colors by name, items by size order
        const sizeOrder = ['XS', 'S', 'M', 'L', 'XL', '2XL', '3XL', '4XL', 'Free'];

        return Array.from(productMap.values())
            .sort((a, b) => a.productName.localeCompare(b.productName))
            .map(product => ({
                ...product,
                colors: product.colors
                    .sort((a, b) => a.colorName.localeCompare(b.colorName))
                    .map(color => ({
                        ...color,
                        items: color.items.sort((a, b) => {
                            const aIdx = sizeOrder.indexOf(a.size);
                            const bIdx = sizeOrder.indexOf(b.size);
                            if (aIdx === -1 && bIdx === -1) return a.size.localeCompare(b.size);
                            if (aIdx === -1) return 1;
                            if (bIdx === -1) return -1;
                            return aIdx - bIdx;
                        })
                    }))
            }));
    }, [balance, filter]);

    // Detect duplicate SKU codes
    const duplicateSkus = useMemo(() => {
        if (!balance) return [];
        const skuCodeCount: Record<string, { count: number; items: InventoryItem[] }> = {};
        balance.forEach(item => {
            if (!skuCodeCount[item.skuCode]) {
                skuCodeCount[item.skuCode] = { count: 0, items: [] };
            }
            skuCodeCount[item.skuCode].count++;
            skuCodeCount[item.skuCode].items.push(item);
        });
        return Object.entries(skuCodeCount)
            .filter(([_, data]) => data.count > 1)
            .map(([skuCode, data]) => ({
                skuCode,
                count: data.count,
                items: data.items.map(i => `${i.productName} - ${i.colorName} (${i.size})`)
            }));
    }, [balance]);

    const toggleProduct = (productId: string) => {
        const newExpanded = new Set(expandedProducts);
        if (newExpanded.has(productId)) {
            newExpanded.delete(productId);
        } else {
            newExpanded.add(productId);
        }
        setExpandedProducts(newExpanded);
    };

    const toggleColor = (key: string) => {
        const newExpanded = new Set(expandedColors);
        if (newExpanded.has(key)) {
            newExpanded.delete(key);
        } else {
            newExpanded.add(key);
        }
        setExpandedColors(newExpanded);
    };

    const expandAll = () => {
        const allProducts = new Set(groupedInventory.map(p => p.productId));
        const allColors = new Set(groupedInventory.flatMap(p => p.colors.map(c => `${p.productId}-${c.variationId}`)));
        setExpandedProducts(allProducts);
        setExpandedColors(allColors);
    };

    const collapseAll = () => {
        setExpandedProducts(new Set());
        setExpandedColors(new Set());
    };

    if (isLoading) return <div className="flex justify-center p-8"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600"></div></div>;

    return (
        <div className="space-y-6">
            <div className="flex items-center justify-between">
                <h1 className="text-2xl font-bold text-gray-900">Inventory</h1>
                <button onClick={() => setShowInward(true)} className="btn-primary flex items-center"><Plus size={20} className="mr-2" />Quick Inward</button>
            </div>

            {/* Duplicate SKU Warning */}
            {duplicateSkus.length > 0 && (
                <div className="bg-red-50 border border-red-200 rounded-lg p-4">
                    <div className="flex items-center gap-3">
                        <AlertTriangle className="text-red-600" />
                        <span className="text-red-800 font-medium">
                            {duplicateSkus.length} duplicate SKU code{duplicateSkus.length > 1 ? 's' : ''} detected
                        </span>
                    </div>
                    <div className="mt-2 text-sm text-red-700">
                        {duplicateSkus.map(dup => (
                            <div key={dup.skuCode} className="ml-8">
                                <span className="font-mono font-medium">{dup.skuCode}</span>
                                <span className="text-red-600"> → {dup.items.join(', ')}</span>
                            </div>
                        ))}
                    </div>
                </div>
            )}

            {/* Alerts Banner */}
            {alerts?.length > 0 && (
                <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4 flex items-center gap-3">
                    <AlertTriangle className="text-yellow-600" />
                    <span className="text-yellow-800 font-medium">{alerts.length} SKUs below target stock</span>
                </div>
            )}

            {/* Filters */}
            <div className="card">
                <div className="flex flex-wrap gap-4 items-end">
                    {/* Gender Filter */}
                    <div className="w-32">
                        <label className="label">Gender</label>
                        <select
                            className="input"
                            value={filter.gender}
                            onChange={(e) => setFilter(f => ({ ...f, gender: e.target.value, productType: '', colorName: '' }))}
                        >
                            <option value="">All</option>
                            {filterOptions.genders.map((g: string) => (
                                <option key={g} value={g}>{g.charAt(0).toUpperCase() + g.slice(1)}</option>
                            ))}
                        </select>
                    </div>

                    {/* Product Filter */}
                    <div className="flex-1 min-w-[200px]">
                        <label className="label">Product</label>
                        <select
                            className="input"
                            value={filter.productType}
                            onChange={(e) => setFilter(f => ({ ...f, productType: e.target.value, colorName: '' }))}
                        >
                            <option value="">All Products</option>
                            {filterOptions.productTypes.map((pt: string) => (
                                <option key={pt} value={pt}>{pt}</option>
                            ))}
                        </select>
                    </div>

                    {/* Color Filter (only when product selected) */}
                    <div className="flex-1 min-w-[150px]">
                        <label className="label">Color</label>
                        <select
                            className="input"
                            value={filter.colorName}
                            onChange={(e) => setFilter(f => ({ ...f, colorName: e.target.value }))}
                            disabled={!filter.productType}
                        >
                            <option value="">All Colors</option>
                            {filterOptions.colors.map((c: string) => (
                                <option key={c} value={c}>{c}</option>
                            ))}
                        </select>
                    </div>

                    {/* Search */}
                    <div className="flex-1 min-w-[200px]">
                        <label className="label">Search</label>
                        <input
                            type="text"
                            placeholder="Search SKU, product, color..."
                            className="input"
                            value={filter.search}
                            onChange={(e) => setFilter(f => ({ ...f, search: e.target.value }))}
                        />
                    </div>

                    {/* Below Target Toggle */}
                    <label className="flex items-center gap-2 pb-2">
                        <input
                            type="checkbox"
                            checked={filter.belowTarget}
                            onChange={(e) => setFilter(f => ({ ...f, belowTarget: e.target.checked }))}
                            className="rounded border-gray-300"
                        />
                        <span className="text-sm whitespace-nowrap">Below target only</span>
                    </label>

                    {/* Expand/Collapse buttons */}
                    <div className="flex gap-2 pb-2">
                        <button onClick={expandAll} className="btn-secondary text-xs py-1.5 px-3">Expand All</button>
                        <button onClick={collapseAll} className="btn-secondary text-xs py-1.5 px-3">Collapse All</button>
                    </div>
                </div>
            </div>

            {/* Grouped Inventory View */}
            <div className="space-y-3">
                {groupedInventory.length === 0 ? (
                    <div className="card text-center py-12 text-gray-500">
                        No inventory items match your filters
                    </div>
                ) : (
                    groupedInventory.map((product) => (
                        <div key={product.productId} className="card p-0 overflow-hidden">
                            {/* Product Header */}
                            <div
                                className="flex items-center gap-3 p-3 bg-gray-50 cursor-pointer hover:bg-gray-100 transition-colors"
                                onClick={() => toggleProduct(product.productId)}
                            >
                                <ChevronRight
                                    size={20}
                                    className={`text-gray-400 transition-transform ${expandedProducts.has(product.productId) ? 'rotate-90' : ''}`}
                                />

                                {/* Product Image (2:3 aspect ratio) */}
                                {product.imageUrl ? (
                                    <img
                                        src={product.imageUrl}
                                        alt={product.productName}
                                        className="w-10 object-cover rounded flex-shrink-0"
                                        style={{ height: '60px' }}
                                    />
                                ) : (
                                    <div className="w-10 bg-gray-200 rounded flex items-center justify-center flex-shrink-0" style={{ height: '60px' }}>
                                        <Package size={20} className="text-gray-400" />
                                    </div>
                                )}

                                <div className="flex-1">
                                    <div className="flex items-center gap-2">
                                        <h3 className="font-semibold text-gray-900">{product.productName}</h3>
                                        {product.gender && product.gender !== 'unisex' && (
                                            <span className={`text-xs px-1.5 py-0.5 rounded ${
                                                product.gender === 'women' ? 'bg-pink-100 text-pink-700' :
                                                product.gender === 'men' ? 'bg-blue-100 text-blue-700' :
                                                'bg-gray-100 text-gray-600'
                                            }`}>
                                                {product.gender.charAt(0).toUpperCase() + product.gender.slice(1)}
                                            </span>
                                        )}
                                    </div>
                                    <p className="text-xs text-gray-500">{product.colors.length} colors • {product.colors.reduce((sum, c) => sum + c.items.length, 0)} SKUs</p>
                                </div>

                                {/* Totals */}
                                <div className="flex gap-6 text-sm">
                                    <div className="text-right">
                                        <p className="text-xs text-gray-500">ERP Stock</p>
                                        <p className="font-semibold text-primary-600">{product.totalStock}</p>
                                    </div>
                                    <div className="text-right">
                                        <p className="text-xs text-gray-500">Shopify</p>
                                        <p className="font-semibold text-green-600">{product.totalShopify}</p>
                                    </div>
                                </div>
                            </div>

                            {/* Colors */}
                            {expandedProducts.has(product.productId) && (
                                <div className="border-t">
                                    {product.colors.map((color) => {
                                        const colorKey = `${product.productId}-${color.variationId}`;
                                        return (
                                            <div key={color.variationId}>
                                                {/* Color Header */}
                                                <div
                                                    className="flex items-center gap-3 px-4 py-2 pl-10 bg-white cursor-pointer hover:bg-gray-50 border-b"
                                                    onClick={() => toggleColor(colorKey)}
                                                >
                                                    <ChevronRight
                                                        size={16}
                                                        className={`text-gray-400 transition-transform ${expandedColors.has(colorKey) ? 'rotate-90' : ''}`}
                                                    />

                                                    {/* Color Image (2:3 aspect ratio) */}
                                                    {color.imageUrl ? (
                                                        <img
                                                            src={color.imageUrl}
                                                            alt={color.colorName}
                                                            className="w-8 object-cover rounded flex-shrink-0"
                                                            style={{ height: '48px' }}
                                                        />
                                                    ) : (
                                                        <div className="w-8 bg-gray-100 rounded flex items-center justify-center flex-shrink-0" style={{ height: '48px' }}>
                                                            <div className="w-4 h-4 rounded-full bg-gray-300"></div>
                                                        </div>
                                                    )}

                                                    <div className="flex-1">
                                                        <span className="font-medium text-gray-800">{color.colorName}</span>
                                                        <span className="text-xs text-gray-400 ml-2">({color.items.length} sizes)</span>
                                                    </div>

                                                    <div className="flex gap-6 text-sm">
                                                        <div className="text-right w-16">
                                                            <p className="font-medium text-primary-600">{color.totalStock}</p>
                                                        </div>
                                                        <div className="text-right w-16">
                                                            <p className="font-medium text-green-600">{color.totalShopify}</p>
                                                        </div>
                                                    </div>
                                                </div>

                                                {/* Size Rows */}
                                                {expandedColors.has(colorKey) && (
                                                    <div className="bg-gray-50">
                                                        <table className="w-full text-sm">
                                                            <thead>
                                                                <tr className="text-xs text-gray-500 border-b">
                                                                    <th className="py-2 px-4 pl-20 text-left font-medium">Size</th>
                                                                    <th className="py-2 px-2 text-left font-medium">SKU</th>
                                                                    <th className="py-2 px-2 text-right font-medium">ERP Stock</th>
                                                                    <th className="py-2 px-2 text-right font-medium">Reserved</th>
                                                                    <th className="py-2 px-2 text-right font-medium">Available</th>
                                                                    <th className="py-2 px-2 text-right font-medium">Shopify</th>
                                                                    <th className="py-2 px-2 text-right font-medium">Target</th>
                                                                    <th className="py-2 px-2 text-center font-medium">Status</th>
                                                                    <th className="py-2 px-2"></th>
                                                                </tr>
                                                            </thead>
                                                            <tbody>
                                                                {color.items.map((item) => (
                                                                    <tr key={item.skuId} className="border-b last:border-0 hover:bg-white">
                                                                        <td className="py-2 px-4 pl-20 font-medium">{item.size}</td>
                                                                        <td className="py-2 px-2 font-mono text-xs text-gray-600">{item.skuCode}</td>
                                                                        <td className="py-2 px-2 text-right font-medium">{item.currentBalance}</td>
                                                                        <td className="py-2 px-2 text-right text-yellow-600">
                                                                            {item.reservedBalance > 0 ? item.reservedBalance : '-'}
                                                                        </td>
                                                                        <td className="py-2 px-2 text-right font-medium text-primary-600">{item.availableBalance}</td>
                                                                        <td className="py-2 px-2 text-right font-medium text-green-600">
                                                                            {item.shopifyQty !== null ? item.shopifyQty : '-'}
                                                                        </td>
                                                                        <td className="py-2 px-2 text-right text-gray-500">{item.targetStockQty}</td>
                                                                        <td className="py-2 px-2 text-center">
                                                                            <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${item.status === 'ok' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
                                                                                {item.status === 'ok' ? 'OK' : 'Low'}
                                                                            </span>
                                                                        </td>
                                                                        <td className="py-2 px-2">
                                                                            <button
                                                                                onClick={(e) => { e.stopPropagation(); setShowDetail(item); }}
                                                                                className="text-primary-600 hover:text-primary-800"
                                                                            >
                                                                                <Eye size={16} />
                                                                            </button>
                                                                        </td>
                                                                    </tr>
                                                                ))}
                                                            </tbody>
                                                        </table>
                                                    </div>
                                                )}
                                            </div>
                                        );
                                    })}
                                </div>
                            )}
                        </div>
                    ))
                )}
            </div>

            {/* Quick Inward Modal */}
            {showInward && (
                <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
                    <div className="bg-white rounded-xl p-6 w-full max-w-md">
                        <h2 className="text-lg font-semibold mb-4">Quick Inward Entry</h2>
                        <form onSubmit={(e) => { e.preventDefault(); quickInward.mutate(inwardForm); }} className="space-y-4">
                            <div><label className="label">SKU Code</label><input className="input" value={inwardForm.skuCode} onChange={(e) => setInwardForm(f => ({ ...f, skuCode: e.target.value }))} required list="sku-list" />
                                <datalist id="sku-list">{skus?.map((s: { id: string; skuCode: string }) => <option key={s.id} value={s.skuCode} />)}</datalist>
                            </div>
                            <div><label className="label">Quantity</label><input type="number" className="input" value={inwardForm.qty} onChange={(e) => setInwardForm(f => ({ ...f, qty: Number(e.target.value) }))} min={1} required /></div>
                            <div><label className="label">Reason</label><select className="input" value={inwardForm.reason} onChange={(e) => setInwardForm(f => ({ ...f, reason: e.target.value }))}>
                                <option value="production">Production</option><option value="return_receipt">Return</option><option value="adjustment">Adjustment</option>
                            </select></div>
                            <div><label className="label">Notes</label><input className="input" value={inwardForm.notes} onChange={(e) => setInwardForm(f => ({ ...f, notes: e.target.value }))} /></div>
                            <div className="flex gap-3">
                                <button type="button" onClick={() => setShowInward(false)} className="btn-secondary flex-1">Cancel</button>
                                <button type="submit" className="btn-primary flex-1" disabled={quickInward.isPending}>{quickInward.isPending ? 'Saving...' : 'Add Inward'}</button>
                            </div>
                        </form>
                    </div>
                </div>
            )}

            {/* SKU Detail Modal with Transaction Ledger */}
            {showDetail && (
                <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
                    <div className="bg-white rounded-xl p-6 w-full max-w-2xl max-h-[85vh] overflow-hidden flex flex-col">
                        <div className="flex items-center justify-between mb-4">
                            <div className="flex items-center gap-3">
                                {showDetail.imageUrl ? (
                                    <img src={showDetail.imageUrl} alt="" className="w-12 object-cover rounded" style={{ height: '72px' }} />
                                ) : (
                                    <div className="w-12 bg-gray-100 rounded flex items-center justify-center" style={{ height: '72px' }}>
                                        <Package size={24} className="text-gray-400" />
                                    </div>
                                )}
                                <div>
                                    <h2 className="text-lg font-semibold">{showDetail.skuCode}</h2>
                                    <p className="text-sm text-gray-500">{showDetail.productName} • {showDetail.colorName} • {showDetail.size}</p>
                                </div>
                            </div>
                            <button onClick={() => setShowDetail(null)} className="text-gray-400 hover:text-gray-600"><X size={20} /></button>
                        </div>

                        {/* Summary Stats */}
                        <div className="grid grid-cols-4 gap-3 mb-4">
                            <div className="bg-gray-50 rounded-lg p-3 text-center">
                                <p className="text-xs text-gray-500">Physical Stock</p>
                                <p className="text-xl font-semibold">{showDetail.currentBalance}</p>
                            </div>
                            <div className="bg-yellow-50 rounded-lg p-3 text-center">
                                <p className="text-xs text-yellow-600">Reserved/Held</p>
                                <p className="text-xl font-semibold text-yellow-700">{showDetail.reservedBalance || 0}</p>
                            </div>
                            <div className="bg-primary-50 rounded-lg p-3 text-center">
                                <p className="text-xs text-primary-600">Available</p>
                                <p className="text-xl font-semibold text-primary-700">{showDetail.availableBalance}</p>
                            </div>
                            <div className="bg-green-50 rounded-lg p-3 text-center">
                                <p className="text-xs text-green-600">Shopify Qty</p>
                                <p className="text-xl font-semibold text-green-700">{showDetail.shopifyQty ?? '-'}</p>
                            </div>
                        </div>
                        <div className="grid grid-cols-4 gap-3 mb-4">
                            <div className="bg-green-50 rounded-lg p-3 text-center">
                                <p className="text-xs text-green-600">Total Inward</p>
                                <p className="text-xl font-semibold text-green-700">{showDetail.totalInward}</p>
                            </div>
                            <div className="bg-red-50 rounded-lg p-3 text-center">
                                <p className="text-xs text-red-600">Total Outward</p>
                                <p className="text-xl font-semibold text-red-700">{showDetail.totalOutward}</p>
                            </div>
                            <div className="bg-blue-50 rounded-lg p-3 text-center">
                                <p className="text-xs text-blue-600">Target</p>
                                <p className="text-xl font-semibold text-blue-700">{showDetail.targetStockQty}</p>
                            </div>
                            <div className={`${showDetail.status === 'ok' ? 'bg-green-50' : 'bg-red-50'} rounded-lg p-3 text-center`}>
                                <p className="text-xs text-gray-600">Status</p>
                                <p className={`text-sm font-semibold ${showDetail.status === 'ok' ? 'text-green-600' : 'text-red-600'}`}>
                                    {showDetail.status === 'ok' ? 'OK' : 'Below Target'}
                                </p>
                            </div>
                        </div>

                        {/* Transaction Ledger */}
                        <div className="flex-1 overflow-y-auto">
                            <h3 className="font-medium text-gray-700 mb-3">Transaction Ledger</h3>
                            {txnLoading ? (
                                <div className="flex justify-center py-8">
                                    <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-primary-600"></div>
                                </div>
                            ) : transactions?.length === 0 ? (
                                <div className="text-center py-8 text-gray-500">No transactions yet</div>
                            ) : (
                                <div className="space-y-2">
                                    {transactions?.map((txn: { id: string; txnType: string; qty: number; reason: string; createdAt: string; createdBy?: { name: string }; referenceId?: string; notes?: string }) => (
                                        <div key={txn.id} className={`p-3 rounded-lg border ${txn.txnType === 'inward' ? 'bg-green-50 border-green-200' : 'bg-red-50 border-red-200'}`}>
                                            <div className="flex items-center justify-between">
                                                <div className="flex items-center gap-3">
                                                    {txn.txnType === 'inward' ? (
                                                        <ArrowDownCircle size={20} className="text-green-600" />
                                                    ) : (
                                                        <ArrowUpCircle size={20} className="text-red-600" />
                                                    )}
                                                    <div>
                                                        <p className="font-medium">
                                                            {txn.txnType === 'inward' ? '+' : '-'}{txn.qty} units
                                                            <span className="ml-2 text-xs text-gray-500 font-normal capitalize">
                                                                {txn.reason.replace(/_/g, ' ')}
                                                            </span>
                                                        </p>
                                                        <div className="flex items-center gap-2 text-xs text-gray-500">
                                                            <span>{new Date(txn.createdAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}</span>
                                                            <span>•</span>
                                                            <span>{txn.createdBy?.name || 'System'}</span>
                                                            {txn.referenceId && (
                                                                <>
                                                                    <span>•</span>
                                                                    <span className="font-mono text-xs">Ref: {txn.referenceId.slice(0, 8)}...</span>
                                                                </>
                                                            )}
                                                        </div>
                                                        {txn.notes && <p className="text-xs text-gray-600 mt-1">{txn.notes}</p>}
                                                    </div>
                                                </div>
                                                <div className={`text-lg font-semibold ${txn.txnType === 'inward' ? 'text-green-600' : 'text-red-600'}`}>
                                                    {txn.txnType === 'inward' ? '+' : '-'}{txn.qty}
                                                </div>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>

                        {/* Footer */}
                        <div className="flex gap-3 pt-4 mt-4 border-t">
                            <button onClick={() => setShowDetail(null)} className="btn-secondary flex-1">Close</button>
                            <button
                                onClick={() => { setInwardForm(f => ({ ...f, skuCode: showDetail.skuCode })); setShowInward(true); setShowDetail(null); }}
                                className="btn-primary flex-1 flex items-center justify-center gap-2"
                            >
                                <Plus size={16} /> Add Inward
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
