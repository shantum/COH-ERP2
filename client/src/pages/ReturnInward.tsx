/**
 * Return Inward Page
 * Receive returned/exchanged items via barcode scan
 * Flow: 1. Link Order → 2. View Order Items → 3. Scan Item → 4. Select Condition → Add to Queue
 */

import { useState, useEffect, useRef } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { returnsApi, ordersApi, productsApi } from '../services/api';
import { Package, Search, RotateCcw, Check, AlertTriangle, X, ChevronRight } from 'lucide-react';

interface OrderItem {
    orderLineId: string;
    skuId: string;
    skuCode: string;
    barcode: string | null;
    productName: string;
    colorName: string;
    size: string;
    qty: number;
    imageUrl: string | null;
}

interface LinkedOrder {
    id: string;
    orderNumber: string;
    shopifyOrderNumber: string | null;
    orderDate: string;
    customer: {
        id: string;
        name: string;
        email: string | null;
    } | null;
    items: OrderItem[];
}

interface SkuInfo {
    id: string;
    skuCode: string;
    barcode: string | null;
    size: string;
    variation: {
        colorName: string;
        imageUrl: string | null;
        product: {
            name: string;
            imageUrl: string | null;
        };
    };
}

type Condition = 'correct_product' | 'incorrect_product' | 'damaged_product';

const CONDITIONS: { value: Condition; label: string; description: string; color: string }[] = [
    {
        value: 'correct_product',
        label: 'Correct Product',
        description: 'Item matches what was ordered',
        color: 'green',
    },
    {
        value: 'incorrect_product',
        label: 'Incorrect Product',
        description: 'Different item than what was ordered',
        color: 'orange',
    },
    {
        value: 'damaged_product',
        label: 'Damaged Product',
        description: 'Item arrived damaged',
        color: 'red',
    },
];

export default function ReturnInward() {
    const queryClient = useQueryClient();
    const orderInputRef = useRef<HTMLInputElement>(null);
    const barcodeInputRef = useRef<HTMLInputElement>(null);

    // Step tracking
    const [step, setStep] = useState<1 | 2 | 3>(1); // 1: Link Order, 2: Scan Item, 3: Confirm

    // Order state
    const [orderSearchInput, setOrderSearchInput] = useState('');
    const [linkedOrder, setLinkedOrder] = useState<LinkedOrder | null>(null);
    const [orderSearching, setOrderSearching] = useState(false);

    // Item state
    const [barcodeInput, setBarcodeInput] = useState('');
    const [selectedItem, setSelectedItem] = useState<OrderItem | null>(null);
    const [scannedSku, setScannedSku] = useState<SkuInfo | null>(null);
    const [isItemInOrder, setIsItemInOrder] = useState<boolean>(true);

    // Return details
    const [requestType, setRequestType] = useState<'return' | 'exchange'>('return');
    const [condition, setCondition] = useState<Condition>('correct_product');

    // Messages
    const [successMessage, setSuccessMessage] = useState<string | null>(null);
    const [errorMessage, setErrorMessage] = useState<string | null>(null);

    // Focus order input on mount
    useEffect(() => {
        orderInputRef.current?.focus();
    }, []);

    // Focus barcode input when step changes to 2
    useEffect(() => {
        if (step === 2 && barcodeInputRef.current) {
            barcodeInputRef.current.focus();
        }
    }, [step]);

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

    // Search for Order
    const handleOrderSearch = async () => {
        if (!orderSearchInput.trim()) return;

        setOrderSearching(true);
        setErrorMessage(null);

        try {
            // First search for the order
            const searchRes = await ordersApi.getAll({ search: orderSearchInput.trim() });
            const orders = searchRes.data.orders || searchRes.data || [];

            if (orders.length === 0) {
                setErrorMessage('Order not found');
                setOrderSearching(false);
                return;
            }

            // Get full order details with items
            const orderRes = await returnsApi.getOrderForInward(orders[0].id);
            setLinkedOrder(orderRes.data);
            setStep(2);
        } catch (error: any) {
            console.error('Order search error:', error);
            setErrorMessage(error.response?.data?.error || 'Failed to search order');
        }

        setOrderSearching(false);
        setOrderSearchInput('');
    };

    // Scan barcode to find item
    const handleBarcodeScan = async () => {
        if (!barcodeInput.trim() || !linkedOrder) return;

        setErrorMessage(null);
        const input = barcodeInput.trim().toLowerCase();

        // First check if item is in the order
        const orderItem = linkedOrder.items.find(
            (item) =>
                item.skuCode.toLowerCase() === input ||
                item.barcode?.toLowerCase() === input
        );

        if (orderItem) {
            // Item found in order
            setSelectedItem(orderItem);
            setScannedSku(null);
            setIsItemInOrder(true);
            setCondition('correct_product');
            setStep(3);
        } else {
            // Item not in order - search for it in products
            try {
                const res = await productsApi.getAllSkus();
                const skus = res.data as SkuInfo[];

                const foundSku = skus.find(
                    (s) =>
                        s.skuCode.toLowerCase() === input ||
                        s.barcode?.toLowerCase() === input
                );

                if (foundSku) {
                    // Found SKU but not in order
                    setScannedSku(foundSku);
                    setSelectedItem(null);
                    setIsItemInOrder(false);
                    setCondition('incorrect_product');
                    setStep(3);
                } else {
                    setErrorMessage('SKU not found in system');
                }
            } catch (error) {
                setErrorMessage('Failed to search SKU');
            }
        }

        setBarcodeInput('');
    };

    const handleOrderKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            handleOrderSearch();
        }
    };

    const handleBarcodeKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            handleBarcodeScan();
        }
    };

    // Inward mutation
    const inwardMutation = useMutation({
        mutationFn: async () => {
            if (!linkedOrder) throw new Error('No order linked');

            const skuId = selectedItem?.skuId || scannedSku?.id;
            if (!skuId) throw new Error('No item selected');

            return returnsApi.inward({
                skuId,
                orderLineId: selectedItem?.orderLineId,
                qty: 1,
                condition,
                requestType,
                originalOrderId: linkedOrder.id,
            });
        },
        onSuccess: (res) => {
            const data = res.data;
            queryClient.invalidateQueries({ queryKey: ['repacking-queue'] });
            queryClient.invalidateQueries({ queryKey: ['repacking-queue-stats'] });

            setSuccessMessage(data.message || 'Item added to repacking queue');

            // Reset for next item
            setSelectedItem(null);
            setScannedSku(null);
            setIsItemInOrder(true);
            setCondition('correct_product');
            setStep(2);
            barcodeInputRef.current?.focus();
        },
        onError: (error: any) => {
            setErrorMessage(error.response?.data?.error || 'Failed to process return inward');
        },
    });

    const resetAll = () => {
        setLinkedOrder(null);
        setSelectedItem(null);
        setScannedSku(null);
        setIsItemInOrder(true);
        setCondition('correct_product');
        setRequestType('return');
        setStep(1);
        orderInputRef.current?.focus();
    };

    const goBack = () => {
        if (step === 3) {
            setSelectedItem(null);
            setScannedSku(null);
            setStep(2);
            barcodeInputRef.current?.focus();
        } else if (step === 2) {
            resetAll();
        }
    };

    // Get current item info for display
    const currentItemInfo = selectedItem
        ? {
              productName: selectedItem.productName,
              colorName: selectedItem.colorName,
              size: selectedItem.size,
              skuCode: selectedItem.skuCode,
              imageUrl: selectedItem.imageUrl,
          }
        : scannedSku
        ? {
              productName: scannedSku.variation.product.name,
              colorName: scannedSku.variation.colorName,
              size: scannedSku.size,
              skuCode: scannedSku.skuCode,
              imageUrl: scannedSku.variation.imageUrl || scannedSku.variation.product.imageUrl,
          }
        : null;

    return (
        <div className="space-y-6">
            {/* Header */}
            <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                    <RotateCcw className="text-orange-600" size={28} />
                    <h1 className="text-2xl font-bold">Return Inward</h1>
                </div>

                {/* Step indicator */}
                <div className="flex items-center gap-2 text-sm">
                    <span className={`px-3 py-1 rounded-full ${step >= 1 ? 'bg-orange-100 text-orange-700' : 'bg-gray-100 text-gray-500'}`}>
                        1. Link Order
                    </span>
                    <ChevronRight size={16} className="text-gray-400" />
                    <span className={`px-3 py-1 rounded-full ${step >= 2 ? 'bg-orange-100 text-orange-700' : 'bg-gray-100 text-gray-500'}`}>
                        2. Scan Item
                    </span>
                    <ChevronRight size={16} className="text-gray-400" />
                    <span className={`px-3 py-1 rounded-full ${step >= 3 ? 'bg-orange-100 text-orange-700' : 'bg-gray-100 text-gray-500'}`}>
                        3. Confirm
                    </span>
                </div>
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

            {/* Step 1: Link Order */}
            {step === 1 && (
                <div className="card">
                    <h3 className="text-lg font-semibold mb-4">Step 1: Link to Order</h3>
                    <p className="text-gray-600 mb-4">
                        Enter the order number to begin the return process.
                    </p>

                    <div className="flex items-center gap-3">
                        <div className="relative flex-1 max-w-md">
                            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={20} />
                            <input
                                ref={orderInputRef}
                                type="text"
                                value={orderSearchInput}
                                onChange={(e) => setOrderSearchInput(e.target.value)}
                                onKeyDown={handleOrderKeyDown}
                                placeholder="Order # or Shopify #..."
                                className="input pl-10 w-full text-lg"
                                autoFocus
                            />
                        </div>
                        <button
                            onClick={handleOrderSearch}
                            disabled={orderSearching}
                            className="btn btn-primary"
                        >
                            {orderSearching ? 'Searching...' : 'Find Order'}
                        </button>
                    </div>
                </div>
            )}

            {/* Step 2 & 3: Order Details and Item Selection */}
            {step >= 2 && linkedOrder && (
                <>
                    {/* Order Summary Card */}
                    <div className="card border-2 border-blue-200 bg-blue-50/30">
                        <div className="flex items-start justify-between">
                            <div>
                                <h3 className="text-lg font-semibold">
                                    Order {linkedOrder.orderNumber}
                                    {linkedOrder.shopifyOrderNumber && (
                                        <span className="text-gray-500 font-normal ml-2">
                                            ({linkedOrder.shopifyOrderNumber})
                                        </span>
                                    )}
                                </h3>
                                {linkedOrder.customer && (
                                    <p className="text-gray-600">{linkedOrder.customer.name}</p>
                                )}
                                <p className="text-sm text-gray-500">
                                    {new Date(linkedOrder.orderDate).toLocaleDateString('en-IN', {
                                        day: '2-digit',
                                        month: 'short',
                                        year: 'numeric',
                                    })}
                                </p>
                            </div>
                            <button onClick={resetAll} className="text-gray-400 hover:text-gray-600">
                                <X size={20} />
                            </button>
                        </div>

                        {/* Order Items */}
                        <div className="mt-4 pt-4 border-t border-blue-200">
                            <h4 className="text-sm font-medium text-gray-600 mb-2">Order Items:</h4>
                            <div className="space-y-2">
                                {linkedOrder.items.map((item) => (
                                    <div
                                        key={item.orderLineId}
                                        className={`flex items-center gap-3 p-2 rounded-lg ${
                                            selectedItem?.orderLineId === item.orderLineId
                                                ? 'bg-green-100 border border-green-300'
                                                : 'bg-white border border-gray-200'
                                        }`}
                                    >
                                        {item.imageUrl ? (
                                            <img
                                                src={item.imageUrl}
                                                alt={item.skuCode}
                                                className="w-10 h-10 rounded object-cover"
                                            />
                                        ) : (
                                            <div className="w-10 h-10 rounded bg-gray-100 flex items-center justify-center">
                                                <Package size={16} className="text-gray-400" />
                                            </div>
                                        )}
                                        <div className="flex-1">
                                            <p className="font-medium text-sm">{item.productName}</p>
                                            <p className="text-xs text-gray-500">
                                                {item.colorName} / {item.size} · <span className="font-mono">{item.skuCode}</span>
                                            </p>
                                        </div>
                                        <span className="text-sm text-gray-600">x{item.qty}</span>
                                    </div>
                                ))}
                            </div>
                        </div>
                    </div>

                    {/* Step 2: Scan Item */}
                    {step === 2 && (
                        <div className="card">
                            <h3 className="text-lg font-semibold mb-4">Step 2: Scan Returned Item</h3>
                            <p className="text-gray-600 mb-4">
                                Scan the barcode of the item being returned.
                            </p>

                            <div className="flex items-center gap-3">
                                <div className="relative flex-1 max-w-md">
                                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={20} />
                                    <input
                                        ref={barcodeInputRef}
                                        type="text"
                                        value={barcodeInput}
                                        onChange={(e) => setBarcodeInput(e.target.value)}
                                        onKeyDown={handleBarcodeKeyDown}
                                        placeholder="Scan barcode or enter SKU..."
                                        className="input pl-10 w-full text-lg"
                                        autoFocus
                                    />
                                </div>
                                <button onClick={handleBarcodeScan} className="btn btn-primary">
                                    Search
                                </button>
                            </div>

                            <div className="mt-4 flex gap-4">
                                <button onClick={goBack} className="btn btn-secondary">
                                    ← Back
                                </button>

                                {/* Return Type Toggle */}
                                <div className="flex items-center gap-4 ml-auto">
                                    <span className="text-sm text-gray-600">Type:</span>
                                    <label className="flex items-center gap-2 cursor-pointer">
                                        <input
                                            type="radio"
                                            name="requestType"
                                            checked={requestType === 'return'}
                                            onChange={() => setRequestType('return')}
                                        />
                                        <span>Return</span>
                                    </label>
                                    <label className="flex items-center gap-2 cursor-pointer">
                                        <input
                                            type="radio"
                                            name="requestType"
                                            checked={requestType === 'exchange'}
                                            onChange={() => setRequestType('exchange')}
                                        />
                                        <span>Exchange</span>
                                    </label>
                                </div>
                            </div>
                        </div>
                    )}

                    {/* Step 3: Confirm */}
                    {step === 3 && currentItemInfo && (
                        <div className="card border-2 border-orange-200 bg-orange-50/30">
                            <h3 className="text-lg font-semibold mb-4">Step 3: Confirm & Add to Queue</h3>

                            {/* Item being returned */}
                            <div className="flex gap-4 mb-6">
                                {currentItemInfo.imageUrl ? (
                                    <img
                                        src={currentItemInfo.imageUrl}
                                        alt={currentItemInfo.skuCode}
                                        className="w-24 h-24 rounded-lg object-cover"
                                    />
                                ) : (
                                    <div className="w-24 h-24 rounded-lg bg-gray-100 flex items-center justify-center">
                                        <Package size={32} className="text-gray-400" />
                                    </div>
                                )}
                                <div>
                                    <h4 className="text-xl font-semibold">{currentItemInfo.productName}</h4>
                                    <p className="text-gray-600">
                                        {currentItemInfo.colorName} / {currentItemInfo.size}
                                    </p>
                                    <p className="font-mono text-sm text-gray-500">{currentItemInfo.skuCode}</p>

                                    {!isItemInOrder && (
                                        <div className="mt-2 px-3 py-1 bg-orange-100 text-orange-700 rounded-lg text-sm inline-block">
                                            ⚠️ This item is NOT in the order
                                        </div>
                                    )}
                                </div>
                            </div>

                            {/* Condition Selection */}
                            <div className="mb-6">
                                <label className="block text-sm font-medium text-gray-700 mb-3">
                                    Received Condition
                                </label>
                                <div className="grid grid-cols-3 gap-3">
                                    {CONDITIONS.map((c) => (
                                        <label
                                            key={c.value}
                                            className={`flex flex-col items-center p-4 rounded-lg border-2 cursor-pointer transition-colors ${
                                                condition === c.value
                                                    ? c.color === 'green'
                                                        ? 'bg-green-50 border-green-400'
                                                        : c.color === 'orange'
                                                        ? 'bg-orange-50 border-orange-400'
                                                        : 'bg-red-50 border-red-400'
                                                    : 'bg-white border-gray-200 hover:border-gray-300'
                                            }`}
                                        >
                                            <input
                                                type="radio"
                                                name="condition"
                                                value={c.value}
                                                checked={condition === c.value}
                                                onChange={(e) => setCondition(e.target.value as Condition)}
                                                className="sr-only"
                                            />
                                            <span className={`font-medium ${
                                                condition === c.value
                                                    ? c.color === 'green'
                                                        ? 'text-green-700'
                                                        : c.color === 'orange'
                                                        ? 'text-orange-700'
                                                        : 'text-red-700'
                                                    : 'text-gray-700'
                                            }`}>
                                                {c.label}
                                            </span>
                                            <span className="text-xs text-gray-500 text-center mt-1">
                                                {c.description}
                                            </span>
                                        </label>
                                    ))}
                                </div>
                            </div>

                            {/* Actions */}
                            <div className="flex items-center gap-4 pt-4 border-t">
                                <button onClick={goBack} className="btn btn-secondary">
                                    ← Back
                                </button>
                                <button
                                    onClick={() => inwardMutation.mutate()}
                                    disabled={inwardMutation.isPending}
                                    className="btn bg-orange-600 hover:bg-orange-700 text-white px-8 py-3 flex-1"
                                >
                                    {inwardMutation.isPending ? 'Processing...' : 'Add to Repacking Queue'}
                                </button>
                            </div>
                        </div>
                    )}
                </>
            )}

            {/* Help text */}
            {step === 1 && (
                <div className="card bg-gray-50 text-center py-8">
                    <RotateCcw size={40} className="mx-auto text-gray-300 mb-3" />
                    <p className="text-gray-500">
                        Start by entering the order number for the return.
                        <br />
                        Items will be added to the repacking queue for QC inspection.
                    </p>
                </div>
            )}
        </div>
    );
}
