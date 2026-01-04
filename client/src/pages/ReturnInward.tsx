/**
 * Return Inward Page
 * Receive returned/exchanged items via barcode scan
 * Items go to Repacking Queue for inspection and processing
 */

import { useState, useEffect, useRef } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { returnsApi, productsApi, ordersApi, inventoryApi } from '../services/api';
import { Package, Search, RotateCcw, Check, AlertTriangle, X, Link } from 'lucide-react';

interface SkuInfo {
    id: string;
    skuCode: string;
    barcode: string | null;
    size: string;
    mrp: number;
    variation: {
        id: string;
        colorName: string;
        imageUrl: string | null;
        product: {
            id: string;
            name: string;
            imageUrl: string | null;
        };
    };
}

interface OrderInfo {
    id: string;
    orderNumber: string;
    shopifyOrderNumber: string | null;
    customer: {
        id: string;
        name: string;
        email: string | null;
    } | null;
    orderDate: string;
}

const REASON_CATEGORIES = [
    { value: 'size_issue', label: 'Size Issue' },
    { value: 'quality_defect', label: 'Quality Defect' },
    { value: 'wrong_product', label: 'Wrong Product Received' },
    { value: 'color_mismatch', label: 'Color Mismatch' },
    { value: 'damaged_in_transit', label: 'Damaged in Transit' },
    { value: 'changed_mind', label: 'Changed Mind' },
    { value: 'other', label: 'Other' },
];

const CONDITIONS = [
    { value: 'unused', label: 'Unused (tags intact)', color: 'green' },
    { value: 'used', label: 'Used (can be repacked)', color: 'blue' },
    { value: 'damaged', label: 'Damaged (needs repair)', color: 'orange' },
    { value: 'defective', label: 'Defective (manufacturing issue)', color: 'red' },
    { value: 'destroyed', label: 'Destroyed (unsalvageable)', color: 'red' },
];

export default function ReturnInward() {
    const queryClient = useQueryClient();
    const inputRef = useRef<HTMLInputElement>(null);
    const orderInputRef = useRef<HTMLInputElement>(null);

    // SKU state
    const [searchInput, setSearchInput] = useState('');
    const [selectedSku, setSelectedSku] = useState<SkuInfo | null>(null);
    const [currentStock, setCurrentStock] = useState<number | null>(null);

    // Order linking
    const [orderSearchInput, setOrderSearchInput] = useState('');
    const [linkedOrder, setLinkedOrder] = useState<OrderInfo | null>(null);
    const [orderSearching, setOrderSearching] = useState(false);

    // Return details
    const [requestType, setRequestType] = useState<'return' | 'exchange'>('return');
    const [reasonCategory, setReasonCategory] = useState('size_issue');
    const [condition, setCondition] = useState('used');
    const [inspectionNotes, setInspectionNotes] = useState('');

    // Messages
    const [successMessage, setSuccessMessage] = useState<string | null>(null);
    const [errorMessage, setErrorMessage] = useState<string | null>(null);

    // Focus input on mount
    useEffect(() => {
        inputRef.current?.focus();
    }, []);

    // Auto-clear messages
    useEffect(() => {
        if (successMessage) {
            const timer = setTimeout(() => setSuccessMessage(null), 5000);
            return () => clearTimeout(timer);
        }
    }, [successMessage]);

    useEffect(() => {
        if (errorMessage) {
            const timer = setTimeout(() => setErrorMessage(null), 5000);
            return () => clearTimeout(timer);
        }
    }, [errorMessage]);

    // Search for SKU
    const handleSearch = async () => {
        if (!searchInput.trim()) return;

        try {
            const res = await productsApi.getAllSkus();
            const skus = res.data as SkuInfo[];

            const found = skus.find(
                (s) =>
                    s.barcode === searchInput.trim() ||
                    s.skuCode.toLowerCase() === searchInput.trim().toLowerCase()
            );

            if (found) {
                setSelectedSku(found);

                // Fetch current stock
                const balanceRes = await inventoryApi.getSkuBalance(found.id);
                setCurrentStock(balanceRes.data.currentBalance || 0);
            } else {
                setErrorMessage('SKU not found');
                setSelectedSku(null);
                setCurrentStock(null);
            }
        } catch (error) {
            console.error('Search error:', error);
            setErrorMessage('Failed to search SKU');
        }

        setSearchInput('');
        inputRef.current?.focus();
    };

    // Search for Order
    const handleOrderSearch = async () => {
        if (!orderSearchInput.trim()) return;

        setOrderSearching(true);
        try {
            const res = await ordersApi.getAll({ search: orderSearchInput.trim() });
            const orders = res.data.orders || res.data || [];

            if (orders.length > 0) {
                // Take the first match
                const order = orders[0];
                setLinkedOrder({
                    id: order.id,
                    orderNumber: order.orderNumber,
                    shopifyOrderNumber: order.shopifyOrderNumber,
                    customer: order.customer,
                    orderDate: order.orderDate,
                });
            } else {
                setErrorMessage('Order not found');
                setLinkedOrder(null);
            }
        } catch (error) {
            console.error('Order search error:', error);
            setErrorMessage('Failed to search order');
        }
        setOrderSearching(false);
        setOrderSearchInput('');
    };

    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            handleSearch();
        }
    };

    const handleOrderKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            handleOrderSearch();
        }
    };

    // Inward mutation
    const inwardMutation = useMutation({
        mutationFn: async () => {
            if (!selectedSku) throw new Error('No SKU selected');
            return returnsApi.inward({
                skuId: selectedSku.id,
                qty: 1,
                condition,
                requestType,
                reasonCategory,
                originalOrderId: linkedOrder?.id,
                inspectionNotes: inspectionNotes || undefined,
            });
        },
        onSuccess: (res) => {
            const data = res.data;
            queryClient.invalidateQueries({ queryKey: ['repacking-queue'] });
            queryClient.invalidateQueries({ queryKey: ['repacking-queue-stats'] });

            setSuccessMessage(data.message || `${selectedSku?.skuCode} added to repacking queue`);

            // Reset form
            setSelectedSku(null);
            setLinkedOrder(null);
            setCurrentStock(null);
            setRequestType('return');
            setReasonCategory('size_issue');
            setCondition('used');
            setInspectionNotes('');

            inputRef.current?.focus();
        },
        onError: (error: any) => {
            setErrorMessage(error.response?.data?.error || 'Failed to process return inward');
        },
    });

    const clearSelection = () => {
        setSelectedSku(null);
        setLinkedOrder(null);
        setCurrentStock(null);
        setInspectionNotes('');
        inputRef.current?.focus();
    };

    return (
        <div className="space-y-6">
            {/* Header */}
            <div className="flex items-center gap-3">
                <RotateCcw className="text-orange-600" size={28} />
                <h1 className="text-2xl font-bold">Return Inward</h1>
            </div>

            {/* Messages */}
            {successMessage && (
                <div className="bg-green-50 border border-green-200 text-green-700 px-4 py-3 rounded-lg flex items-center gap-2">
                    <Check size={20} />
                    <span>{successMessage}</span>
                </div>
            )}

            {errorMessage && (
                <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg flex items-center gap-2">
                    <AlertTriangle size={20} />
                    <span>{errorMessage}</span>
                </div>
            )}

            {/* Barcode Search */}
            <div className="card">
                <div className="flex items-center gap-3">
                    <div className="relative flex-1 max-w-md">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={20} />
                        <input
                            ref={inputRef}
                            type="text"
                            value={searchInput}
                            onChange={(e) => setSearchInput(e.target.value)}
                            onKeyDown={handleKeyDown}
                            placeholder="Scan barcode or enter SKU code..."
                            className="input pl-10 w-full text-lg"
                            autoFocus
                        />
                    </div>
                    <button onClick={handleSearch} className="btn btn-primary">
                        Search
                    </button>
                </div>
            </div>

            {/* SKU Preview Card */}
            {selectedSku && (
                <div className="card border-2 border-orange-200 bg-orange-50/30">
                    <div className="flex gap-6">
                        {/* Image */}
                        <div className="w-32 h-32 bg-gray-100 rounded-lg overflow-hidden flex-shrink-0">
                            {(selectedSku.variation.imageUrl || selectedSku.variation.product.imageUrl) ? (
                                <img
                                    src={selectedSku.variation.imageUrl || selectedSku.variation.product.imageUrl || ''}
                                    alt={selectedSku.skuCode}
                                    className="w-full h-full object-cover"
                                />
                            ) : (
                                <div className="w-full h-full flex items-center justify-center text-gray-400">
                                    <Package size={40} />
                                </div>
                            )}
                        </div>

                        {/* Info */}
                        <div className="flex-1 space-y-2">
                            <div className="flex items-start justify-between">
                                <div>
                                    <h2 className="text-xl font-semibold">{selectedSku.variation.product.name}</h2>
                                    <p className="text-gray-600">
                                        {selectedSku.variation.colorName} / {selectedSku.size}
                                    </p>
                                </div>
                                <button onClick={clearSelection} className="text-gray-400 hover:text-gray-600">
                                    <X size={20} />
                                </button>
                            </div>

                            <div className="flex gap-6 text-sm">
                                <div>
                                    <span className="text-gray-500">SKU:</span>{' '}
                                    <span className="font-mono font-medium">{selectedSku.skuCode}</span>
                                </div>
                                {selectedSku.barcode && (
                                    <div>
                                        <span className="text-gray-500">Barcode:</span>{' '}
                                        <span className="font-mono">{selectedSku.barcode}</span>
                                    </div>
                                )}
                                <div>
                                    <span className="text-gray-500">MRP:</span>{' '}
                                    <span className="font-medium">₹{selectedSku.mrp}</span>
                                </div>
                            </div>

                            <div className="flex gap-6 text-sm pt-2">
                                <div className="bg-white px-3 py-1 rounded border">
                                    <span className="text-gray-500">Current Stock:</span>{' '}
                                    <span className="font-semibold text-blue-600">{currentStock ?? '...'} pcs</span>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {/* Return Details Form */}
            {selectedSku && (
                <div className="card space-y-6">
                    {/* Link to Order */}
                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">
                            <Link size={16} className="inline mr-2" />
                            Link to Order (Optional)
                        </label>
                        {linkedOrder ? (
                            <div className="flex items-center gap-3 bg-blue-50 border border-blue-200 rounded-lg px-4 py-3">
                                <div className="flex-1">
                                    <span className="font-medium">{linkedOrder.orderNumber}</span>
                                    {linkedOrder.shopifyOrderNumber && (
                                        <span className="text-gray-500 ml-2">({linkedOrder.shopifyOrderNumber})</span>
                                    )}
                                    {linkedOrder.customer && (
                                        <span className="text-gray-600 ml-3">{linkedOrder.customer.name}</span>
                                    )}
                                </div>
                                <button
                                    onClick={() => setLinkedOrder(null)}
                                    className="text-gray-400 hover:text-gray-600"
                                >
                                    <X size={18} />
                                </button>
                            </div>
                        ) : (
                            <div className="flex items-center gap-3">
                                <div className="relative flex-1 max-w-sm">
                                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={16} />
                                    <input
                                        ref={orderInputRef}
                                        type="text"
                                        value={orderSearchInput}
                                        onChange={(e) => setOrderSearchInput(e.target.value)}
                                        onKeyDown={handleOrderKeyDown}
                                        placeholder="Order # or Shopify #..."
                                        className="input pl-9 w-full"
                                    />
                                </div>
                                <button
                                    onClick={handleOrderSearch}
                                    disabled={orderSearching}
                                    className="btn btn-secondary"
                                >
                                    {orderSearching ? 'Searching...' : 'Find Order'}
                                </button>
                            </div>
                        )}
                    </div>

                    {/* Return Type */}
                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">Type</label>
                        <div className="flex gap-4">
                            <label className="flex items-center gap-2 cursor-pointer">
                                <input
                                    type="radio"
                                    name="requestType"
                                    checked={requestType === 'return'}
                                    onChange={() => setRequestType('return')}
                                    className="text-orange-600"
                                />
                                <span>Return</span>
                            </label>
                            <label className="flex items-center gap-2 cursor-pointer">
                                <input
                                    type="radio"
                                    name="requestType"
                                    checked={requestType === 'exchange'}
                                    onChange={() => setRequestType('exchange')}
                                    className="text-orange-600"
                                />
                                <span>Exchange</span>
                            </label>
                        </div>
                    </div>

                    {/* Reason */}
                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">Reason</label>
                        <select
                            value={reasonCategory}
                            onChange={(e) => setReasonCategory(e.target.value)}
                            className="input max-w-sm"
                        >
                            {REASON_CATEGORIES.map((r) => (
                                <option key={r.value} value={r.value}>{r.label}</option>
                            ))}
                        </select>
                    </div>

                    {/* Condition */}
                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">Condition</label>
                        <div className="flex flex-wrap gap-3">
                            {CONDITIONS.map((c) => (
                                <label
                                    key={c.value}
                                    className={`flex items-center gap-2 px-4 py-2 rounded-lg border cursor-pointer transition-colors ${
                                        condition === c.value
                                            ? c.color === 'green' ? 'bg-green-50 border-green-300 text-green-700' :
                                              c.color === 'blue' ? 'bg-blue-50 border-blue-300 text-blue-700' :
                                              c.color === 'orange' ? 'bg-orange-50 border-orange-300 text-orange-700' :
                                              'bg-red-50 border-red-300 text-red-700'
                                            : 'bg-white border-gray-200 hover:border-gray-300'
                                    }`}
                                >
                                    <input
                                        type="radio"
                                        name="condition"
                                        value={c.value}
                                        checked={condition === c.value}
                                        onChange={(e) => setCondition(e.target.value)}
                                        className="sr-only"
                                    />
                                    <span>{c.label}</span>
                                </label>
                            ))}
                        </div>
                    </div>

                    {/* Notes */}
                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">
                            Inspection Notes (Optional)
                        </label>
                        <textarea
                            value={inspectionNotes}
                            onChange={(e) => setInspectionNotes(e.target.value)}
                            placeholder="Any notes about the item condition..."
                            className="input w-full max-w-lg"
                            rows={2}
                        />
                    </div>

                    {/* Submit */}
                    <div className="pt-4 border-t">
                        <button
                            onClick={() => inwardMutation.mutate()}
                            disabled={inwardMutation.isPending}
                            className="btn bg-orange-600 hover:bg-orange-700 text-white px-8 py-3 text-lg"
                        >
                            {inwardMutation.isPending ? 'Processing...' : 'Add to Repacking Queue'}
                        </button>
                        <p className="text-sm text-gray-500 mt-2">
                            Item will be added to the repacking queue for inspection and processing.
                        </p>
                    </div>
                </div>
            )}

            {/* Help text when no SKU selected */}
            {!selectedSku && (
                <div className="card bg-gray-50 text-center py-12">
                    <RotateCcw size={48} className="mx-auto text-gray-300 mb-4" />
                    <h3 className="text-lg font-medium text-gray-600">Scan a returned item</h3>
                    <p className="text-gray-500 mt-1">
                        Scan the barcode or enter SKU code to start the return inward process
                    </p>
                </div>
            )}
        </div>
    );
}
