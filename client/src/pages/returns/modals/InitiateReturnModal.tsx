import { useState } from 'react';
import { X, Search, Truck, Package, AlertCircle, CheckCircle2 } from 'lucide-react';
import type { OrderForReturn } from '@coh/shared/schemas/returns';
import { reasonOptions, resolutionOptions } from '../types';
import { ProductSearch, type SKUData } from '../../../components/common/ProductSearch';
import { getOptimizedImageUrl } from '../../../utils/imageOptimization';

export interface InitiateReturnModalProps {
    orderSearchTerm: string;
    setOrderSearchTerm: (val: string) => void;
    searchedOrder: OrderForReturn | null;
    selectedLines: Set<string>;
    returnQtyMap: Record<string, number>;
    setReturnQtyMap: (map: Record<string, number>) => void;
    returnReasonCategory: string;
    setReturnReasonCategory: (val: string) => void;
    returnReasonDetail: string;
    setReturnReasonDetail: (val: string) => void;
    returnResolution: 'refund' | 'exchange' | 'rejected';
    setReturnResolution: (val: 'refund' | 'exchange' | 'rejected') => void;
    returnPickupType: 'arranged_by_us' | 'customer_shipped';
    setReturnPickupType: (val: 'arranged_by_us' | 'customer_shipped') => void;
    returnNotes: string;
    setReturnNotes: (val: string) => void;
    exchangeSkuId: string;
    setExchangeSkuId: (val: string) => void;
    onSearchOrder: () => void;
    onToggleLine: (lineId: string) => void;
    onInitiate: () => void;
    onClose: () => void;
}

export function InitiateReturnModal({
    orderSearchTerm,
    setOrderSearchTerm,
    searchedOrder,
    selectedLines,
    returnQtyMap,
    setReturnQtyMap,
    returnReasonCategory,
    setReturnReasonCategory,
    returnReasonDetail,
    setReturnReasonDetail,
    returnResolution,
    setReturnResolution,
    returnPickupType,
    setReturnPickupType,
    returnNotes,
    setReturnNotes,
    exchangeSkuId,
    setExchangeSkuId,
    onSearchOrder,
    onToggleLine,
    onInitiate,
    onClose,
}: InitiateReturnModalProps) {
    // Track selected exchange SKU details for display
    const [exchangeSkuInfo, setExchangeSkuInfo] = useState<{
        name: string;
        color: string;
        size: string;
        skuCode: string;
        mrp: number;
        stock: number;
        imageUrl: string | null;
    } | null>(null);

    const handleExchangeSkuSelect = (sku: SKUData, stock: number) => {
        setExchangeSkuId(sku.id);
        setExchangeSkuInfo({
            name: sku.variation?.product?.name || 'Unknown',
            color: sku.variation?.colorName || '',
            size: sku.size || '',
            skuCode: sku.skuCode || '',
            mrp: Number(sku.mrp) || 0,
            stock,
            imageUrl: sku.variation?.imageUrl || sku.variation?.product?.imageUrl || null,
        });
    };

    const clearExchangeSku = () => {
        setExchangeSkuId('');
        setExchangeSkuInfo(null);
    };

    // When resolution changes away from exchange, clear exchange SKU
    const handleResolutionChange = (val: 'refund' | 'exchange' | 'rejected') => {
        setReturnResolution(val);
        if (val !== 'exchange') {
            clearExchangeSku();
        }
    };

    // Calculate price diff for exchange
    const getExchangePriceDiff = () => {
        if (!exchangeSkuInfo || selectedLines.size === 0 || !searchedOrder) return null;

        const selectedLineData = searchedOrder.lines.filter(l => selectedLines.has(l.id));
        if (selectedLineData.length === 0) return null;

        const totalReturnQty = selectedLineData.reduce((sum, l) => sum + (returnQtyMap[l.id] || l.qty), 0);
        const totalReturnValue = selectedLineData.reduce(
            (sum, l) => sum + (returnQtyMap[l.id] || l.qty) * l.unitPrice,
            0
        );

        // Same product = same productName (size swap). Server does precise variationId check.
        const firstLine = selectedLineData[0];
        const isSameProduct = firstLine.productName === exchangeSkuInfo.name;

        if (isSameProduct) {
            return { diff: 0, exchangeValue: totalReturnValue, returnValue: totalReturnValue, isSameProduct: true };
        }

        const exchangeValue = exchangeSkuInfo.mrp * totalReturnQty;
        const diff = exchangeValue - totalReturnValue;
        return { diff, exchangeValue, returnValue: totalReturnValue, isSameProduct: false };
    };

    const priceDiff = returnResolution === 'exchange' && exchangeSkuInfo ? getExchangePriceDiff() : null;

    const canInitiate = selectedLines.size > 0 &&
        returnReasonCategory &&
        (returnResolution !== 'exchange' || exchangeSkuId);

    return (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
            <div className="bg-white rounded-lg max-w-4xl w-full max-h-[90vh] overflow-y-auto">
                <div className="p-6 border-b border-gray-200 flex items-center justify-between sticky top-0 bg-white z-10">
                    <h2 className="text-xl font-bold">Initiate Return</h2>
                    <button onClick={onClose} className="text-gray-500 hover:text-gray-700">
                        <X size={24} />
                    </button>
                </div>

                <div className="p-6 space-y-6">
                    {/* Step 1: Search Order */}
                    <div>
                        <label className="block text-sm font-medium mb-2">Search Order</label>
                        <div className="flex gap-2">
                            <input
                                type="text"
                                placeholder="Enter order number..."
                                value={orderSearchTerm}
                                onChange={(e) => setOrderSearchTerm(e.target.value)}
                                onKeyDown={(e) => e.key === 'Enter' && onSearchOrder()}
                                className="flex-1 px-4 py-2 border border-gray-300 rounded-lg"
                            />
                            <button
                                onClick={onSearchOrder}
                                className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
                            >
                                <Search size={16} />
                            </button>
                        </div>
                    </div>

                    {/* Step 2: Select Lines */}
                    {searchedOrder && (
                        <div>
                            <h3 className="text-sm font-medium mb-2">
                                Order {searchedOrder.orderNumber} - {searchedOrder.customerName}
                            </h3>
                            <div className="space-y-2">
                                {searchedOrder.lines.map((line) => {
                                    const hasWarning = line.eligibility.eligible && line.eligibility.warning;
                                    const borderClass = !line.eligibility.eligible
                                        ? 'border-red-200 bg-red-50'
                                        : hasWarning
                                        ? 'border-yellow-200 bg-yellow-50 hover:border-yellow-300 cursor-pointer'
                                        : 'border-gray-200 hover:border-blue-300 cursor-pointer';

                                    return (
                                        <div
                                            key={line.id}
                                            className={`p-3 border rounded-lg ${borderClass}`}
                                            onClick={() => line.eligibility.eligible && onToggleLine(line.id)}
                                        >
                                            <div className="flex items-center gap-3">
                                                {line.eligibility.eligible && (
                                                    <input
                                                        type="checkbox"
                                                        checked={selectedLines.has(line.id)}
                                                        onChange={() => onToggleLine(line.id)}
                                                        className="w-4 h-4"
                                                    />
                                                )}
                                                <div className="flex-1">
                                                    <div className="font-medium">
                                                        {line.productName} - {line.colorName} - {line.size}
                                                    </div>
                                                    <div className="text-sm text-gray-500">
                                                        SKU: {line.skuCode} | Qty: {line.qty} | {'\u20B9'}{line.unitPrice.toLocaleString()}
                                                        {line.eligibility.daysRemaining !== null && (
                                                            <span className="ml-2">
                                                                ({line.eligibility.daysRemaining >= 0
                                                                    ? `${line.eligibility.daysRemaining}d left`
                                                                    : `${Math.abs(line.eligibility.daysRemaining)}d overdue`})
                                                            </span>
                                                        )}
                                                    </div>
                                                    {!line.eligibility.eligible && (
                                                        <div className="text-sm text-red-600 mt-1">
                                                            Not eligible: {line.eligibility.reason}
                                                        </div>
                                                    )}
                                                    {hasWarning && (
                                                        <div className="text-sm text-yellow-700 mt-1 flex items-center gap-1">
                                                            <AlertCircle size={14} />
                                                            Warning: {line.eligibility.warning?.replace(/_/g, ' ')}
                                                        </div>
                                                    )}
                                                </div>
                                                {selectedLines.has(line.id) && (
                                                    <input
                                                        type="number"
                                                        min="1"
                                                        max={line.qty}
                                                        value={returnQtyMap[line.id] || 1}
                                                        onChange={(e) =>
                                                            setReturnQtyMap({
                                                                ...returnQtyMap,
                                                                [line.id]: parseInt(e.target.value, 10),
                                                            })
                                                        }
                                                        className="w-20 px-2 py-1 border border-gray-300 rounded"
                                                        onClick={(e) => e.stopPropagation()}
                                                    />
                                                )}
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        </div>
                    )}

                    {/* Step 3: Return Details */}
                    {selectedLines.size > 0 && (
                        <div className="space-y-4">
                            <div>
                                <label className="block text-sm font-medium mb-2">Reason Category</label>
                                <select
                                    value={returnReasonCategory}
                                    onChange={(e) => setReturnReasonCategory(e.target.value)}
                                    className="w-full px-4 py-2 border border-gray-300 rounded-lg"
                                >
                                    <option value="">Select reason...</option>
                                    {reasonOptions.map((cat) => (
                                        <option key={cat.value} value={cat.value}>
                                            {cat.label}
                                        </option>
                                    ))}
                                </select>
                            </div>

                            <div>
                                <label className="block text-sm font-medium mb-2">Reason Detail (Optional)</label>
                                <textarea
                                    value={returnReasonDetail}
                                    onChange={(e) => setReturnReasonDetail(e.target.value)}
                                    className="w-full px-4 py-2 border border-gray-300 rounded-lg"
                                    rows={2}
                                />
                            </div>

                            <div>
                                <label className="block text-sm font-medium mb-2">Resolution</label>
                                <div className="flex gap-2">
                                    {resolutionOptions.map((res) => (
                                        <button
                                            key={res.value}
                                            onClick={() => handleResolutionChange(res.value)}
                                            className={`px-4 py-2 rounded-lg border ${
                                                returnResolution === res.value
                                                    ? 'border-blue-600 bg-blue-50 text-blue-700'
                                                    : 'border-gray-300'
                                            }`}
                                        >
                                            {res.label}
                                        </button>
                                    ))}
                                </div>
                            </div>

                            <div>
                                <label className="block text-sm font-medium mb-2">Pickup Method</label>
                                <div className="flex gap-2">
                                    <button
                                        onClick={() => setReturnPickupType('arranged_by_us')}
                                        className={`flex-1 px-4 py-3 rounded-lg border text-left ${
                                            returnPickupType === 'arranged_by_us'
                                                ? 'border-blue-600 bg-blue-50 text-blue-700'
                                                : 'border-gray-300'
                                        }`}
                                    >
                                        <div className="flex items-center gap-2">
                                            <Truck size={18} />
                                            <div>
                                                <div className="font-medium">We'll arrange pickup</div>
                                                <div className="text-xs text-gray-500">Schedule reverse pickup via courier</div>
                                            </div>
                                        </div>
                                    </button>
                                    <button
                                        onClick={() => setReturnPickupType('customer_shipped')}
                                        className={`flex-1 px-4 py-3 rounded-lg border text-left ${
                                            returnPickupType === 'customer_shipped'
                                                ? 'border-blue-600 bg-blue-50 text-blue-700'
                                                : 'border-gray-300'
                                        }`}
                                    >
                                        <div className="flex items-center gap-2">
                                            <Package size={18} />
                                            <div>
                                                <div className="font-medium">Customer ships</div>
                                                <div className="text-xs text-gray-500">Customer will ship the item themselves</div>
                                            </div>
                                        </div>
                                    </button>
                                </div>
                            </div>

                            {/* Exchange SKU Picker */}
                            {returnResolution === 'exchange' && (
                                <div>
                                    <label className="block text-sm font-medium mb-2">
                                        Exchange SKU <span className="text-red-500">*</span>
                                    </label>
                                    <p className="text-xs text-gray-500 mb-3">
                                        Exchange order will be created immediately for JIT production.
                                    </p>

                                    {exchangeSkuInfo ? (
                                        /* Selected exchange SKU display */
                                        <div className="border border-blue-200 bg-blue-50 rounded-lg p-4">
                                            <div className="flex items-start gap-3">
                                                <div className="w-12 h-12 bg-white rounded-lg overflow-hidden shrink-0">
                                                    {exchangeSkuInfo.imageUrl ? (
                                                        <img
                                                            src={getOptimizedImageUrl(exchangeSkuInfo.imageUrl, 'sm') || exchangeSkuInfo.imageUrl}
                                                            alt=""
                                                            className="w-full h-full object-cover"
                                                            loading="lazy"
                                                        />
                                                    ) : (
                                                        <div className="w-full h-full flex items-center justify-center text-gray-400">
                                                            <Package size={20} />
                                                        </div>
                                                    )}
                                                </div>
                                                <div className="flex-1 min-w-0">
                                                    <div className="font-medium text-sm text-gray-800">
                                                        {exchangeSkuInfo.name}
                                                    </div>
                                                    <div className="text-xs text-gray-600 mt-0.5">
                                                        {exchangeSkuInfo.color} / {exchangeSkuInfo.size} — {exchangeSkuInfo.skuCode}
                                                    </div>
                                                    <div className="flex items-center gap-3 mt-1.5">
                                                        <span className="text-xs font-medium text-gray-700">
                                                            MRP: {'\u20B9'}{exchangeSkuInfo.mrp.toLocaleString()}
                                                        </span>
                                                        <span className={`text-xs px-1.5 py-0.5 rounded ${
                                                            exchangeSkuInfo.stock <= 0
                                                                ? 'bg-red-100 text-red-700'
                                                                : exchangeSkuInfo.stock <= 3
                                                                ? 'bg-amber-100 text-amber-700'
                                                                : 'bg-green-100 text-green-700'
                                                        }`}>
                                                            Stock: {exchangeSkuInfo.stock}
                                                        </span>
                                                    </div>
                                                </div>
                                                <button
                                                    onClick={clearExchangeSku}
                                                    className="text-gray-400 hover:text-red-600 p-1"
                                                    title="Change exchange SKU"
                                                >
                                                    <X size={16} />
                                                </button>
                                            </div>

                                            {/* Price diff */}
                                            {priceDiff && (
                                                <div className="mt-3 pt-3 border-t border-blue-200">
                                                    {priceDiff.isSameProduct ? (
                                                        <div className="flex items-center gap-2 text-sm">
                                                            <CheckCircle2 size={14} className="text-green-600" />
                                                            <span className="text-green-700 font-medium">
                                                                Same product size swap — no price difference
                                                            </span>
                                                        </div>
                                                    ) : (
                                                        <div className="space-y-1 text-xs">
                                                            <div className="flex justify-between text-gray-600">
                                                                <span>Return value</span>
                                                                <span>{'\u20B9'}{priceDiff.returnValue.toLocaleString()}</span>
                                                            </div>
                                                            <div className="flex justify-between text-gray-600">
                                                                <span>Exchange value</span>
                                                                <span>{'\u20B9'}{priceDiff.exchangeValue.toLocaleString()}</span>
                                                            </div>
                                                            <div className={`flex justify-between font-semibold pt-1 border-t border-blue-200 ${
                                                                priceDiff.diff > 0 ? 'text-red-700' : priceDiff.diff < 0 ? 'text-green-700' : 'text-gray-700'
                                                            }`}>
                                                                <span>
                                                                    {priceDiff.diff > 0 ? 'Customer pays extra' : priceDiff.diff < 0 ? 'Customer gets credit' : 'No difference'}
                                                                </span>
                                                                <span>
                                                                    {priceDiff.diff > 0 ? '+' : ''}{'\u20B9'}{priceDiff.diff.toLocaleString()}
                                                                </span>
                                                            </div>
                                                        </div>
                                                    )}
                                                </div>
                                            )}
                                        </div>
                                    ) : (
                                        /* Search for exchange SKU */
                                        <ProductSearch
                                            onSelect={handleExchangeSkuSelect}
                                            onCancel={() => {}}
                                            placeholder="Search for exchange product..."
                                            maxResultsHeight="16rem"
                                        />
                                    )}
                                </div>
                            )}

                            <div>
                                <label className="block text-sm font-medium mb-2">Notes (Optional)</label>
                                <textarea
                                    value={returnNotes}
                                    onChange={(e) => setReturnNotes(e.target.value)}
                                    className="w-full px-4 py-2 border border-gray-300 rounded-lg"
                                    rows={2}
                                />
                            </div>
                        </div>
                    )}
                </div>

                <div className="p-6 border-t border-gray-200 flex justify-end gap-2 sticky bottom-0 bg-white">
                    <button onClick={onClose} className="px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50">
                        Cancel
                    </button>
                    <button
                        onClick={onInitiate}
                        disabled={!canInitiate}
                        className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                        Initiate Return
                    </button>
                </div>
            </div>
        </div>
    );
}
