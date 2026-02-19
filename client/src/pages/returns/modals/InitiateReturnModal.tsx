import { X, Search, Truck, Package, AlertCircle } from 'lucide-react';
import type { OrderForReturn } from '@coh/shared/schemas/returns';
import { reasonOptions, resolutionOptions } from '../types';

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
    return (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
            <div className="bg-white rounded-lg max-w-4xl w-full max-h-[90vh] overflow-y-auto">
                <div className="p-6 border-b border-gray-200 flex items-center justify-between sticky top-0 bg-white">
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
                                onKeyPress={(e) => e.key === 'Enter' && onSearchOrder()}
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
                                                        SKU: {line.skuCode} | Qty: {line.qty}
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
                                            onClick={() => setReturnResolution(res.value)}
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

                            {returnResolution === 'exchange' && (
                                <div>
                                    <label className="block text-sm font-medium mb-2">Exchange SKU ID</label>
                                    <input
                                        type="text"
                                        value={exchangeSkuId}
                                        onChange={(e) => setExchangeSkuId(e.target.value)}
                                        className="w-full px-4 py-2 border border-gray-300 rounded-lg"
                                        placeholder="Enter SKU ID for exchange..."
                                    />
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
                        disabled={selectedLines.size === 0 || !returnReasonCategory}
                        className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
                    >
                        Initiate Return
                    </button>
                </div>
            </div>
        </div>
    );
}
