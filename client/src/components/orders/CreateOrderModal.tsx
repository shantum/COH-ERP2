/**
 * CreateOrderModal component
 * Multi-step form for creating a new order with product/color/size cascade selection
 */

import { useState } from 'react';
import { X, Trash2 } from 'lucide-react';
import {
    getUniqueProducts,
    getColorsForProduct,
    getSizesForVariation,
    getSkuBalance,
} from '../../utils/orderHelpers';

interface OrderLine {
    skuId: string;
    qty: number;
    unitPrice: number;
}

interface LineSelection {
    productId: string;
    variationId: string;
}

interface CreateOrderModalProps {
    allSkus: any[];
    channels: any[];
    inventoryBalance: any[];
    onCreate: (data: any) => void;
    onClose: () => void;
    isCreating: boolean;
}

export function CreateOrderModal({
    allSkus,
    channels,
    inventoryBalance,
    onCreate,
    onClose,
    isCreating,
}: CreateOrderModalProps) {
    const [orderForm, setOrderForm] = useState({
        customerName: '',
        customerEmail: '',
        customerPhone: '',
        channel: 'offline',
    });
    const [orderLines, setOrderLines] = useState<OrderLine[]>([]);
    const [lineSelections, setLineSelections] = useState<Record<number, LineSelection>>({});

    const addFormLine = () => {
        setOrderLines([...orderLines, { skuId: '', qty: 1, unitPrice: 0 }]);
    };

    const removeLine = (idx: number) => {
        setOrderLines(orderLines.filter((_, i) => i !== idx));
        const newSelections = { ...lineSelections };
        delete newSelections[idx];
        setLineSelections(newSelections);
    };

    const updateFormLine = (idx: number, field: string, value: any) => {
        const newLines = [...orderLines];
        (newLines[idx] as any)[field] = value;
        if (field === 'skuId') {
            const sku = allSkus?.find((s: any) => s.id === value);
            if (sku) newLines[idx].unitPrice = Number(sku.mrp);
        }
        setOrderLines(newLines);
    };

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        if (orderLines.length === 0) {
            alert('Add at least one item');
            return;
        }
        const totalAmount = orderLines.reduce((sum, l) => sum + l.qty * l.unitPrice, 0);
        onCreate({
            ...orderForm,
            orderNumber: `COH-${Date.now().toString().slice(-6)}`,
            totalAmount,
            lines: orderLines.map((l) => ({
                skuId: l.skuId,
                qty: l.qty,
                unitPrice: l.unitPrice,
            })),
        });
    };

    const products = getUniqueProducts(allSkus);

    return (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 overflow-y-auto py-8">
            <div className="bg-white rounded-xl p-6 w-full max-w-lg">
                <div className="flex items-center justify-between mb-4">
                    <h2 className="text-lg font-semibold">New Order</h2>
                    <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
                        <X size={20} />
                    </button>
                </div>

                <form onSubmit={handleSubmit} className="space-y-4">
                    <div className="grid grid-cols-2 gap-3">
                        <div>
                            <label className="text-xs text-gray-500 mb-1 block">Customer Name</label>
                            <input
                                className="input text-sm"
                                value={orderForm.customerName}
                                onChange={(e) =>
                                    setOrderForm((f) => ({ ...f, customerName: e.target.value }))
                                }
                                required
                            />
                        </div>
                        <div>
                            <label className="text-xs text-gray-500 mb-1 block">Channel</label>
                            <select
                                className="input text-sm"
                                value={orderForm.channel}
                                onChange={(e) =>
                                    setOrderForm((f) => ({ ...f, channel: e.target.value }))
                                }
                            >
                                {channels?.map((ch: any) => (
                                    <option key={ch.id} value={ch.id}>
                                        {ch.name}
                                    </option>
                                ))}
                                {(!channels || channels.length === 0) && (
                                    <option value="offline">Offline</option>
                                )}
                            </select>
                        </div>
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                        <div>
                            <label className="text-xs text-gray-500 mb-1 block">Email</label>
                            <input
                                type="email"
                                className="input text-sm"
                                value={orderForm.customerEmail}
                                onChange={(e) =>
                                    setOrderForm((f) => ({ ...f, customerEmail: e.target.value }))
                                }
                            />
                        </div>
                        <div>
                            <label className="text-xs text-gray-500 mb-1 block">Phone</label>
                            <input
                                className="input text-sm"
                                value={orderForm.customerPhone}
                                onChange={(e) =>
                                    setOrderForm((f) => ({ ...f, customerPhone: e.target.value }))
                                }
                            />
                        </div>
                    </div>

                    <div>
                        <div className="flex items-center justify-between mb-2">
                            <label className="text-xs text-gray-500">Items</label>
                            <button
                                type="button"
                                onClick={addFormLine}
                                className="text-xs text-primary-600 hover:underline"
                            >
                                + Add Item
                            </button>
                        </div>

                        {orderLines.length === 0 && (
                            <p className="text-sm text-gray-400 text-center py-4">No items added</p>
                        )}

                        <div className="space-y-3">
                            {orderLines.map((line, idx) => {
                                const selection = lineSelections[idx] || {
                                    productId: '',
                                    variationId: '',
                                };
                                const colors = getColorsForProduct(allSkus, selection.productId);
                                const sizes = getSizesForVariation(
                                    allSkus,
                                    selection.variationId,
                                    inventoryBalance
                                );
                                const selectedSku = allSkus?.find((s: any) => s.id === line.skuId);

                                return (
                                    <div
                                        key={idx}
                                        className="border border-gray-200 rounded-lg p-3 space-y-2"
                                    >
                                        <div className="flex justify-between items-center">
                                            <span className="text-xs text-gray-400">Item {idx + 1}</span>
                                            <button
                                                type="button"
                                                onClick={() => removeLine(idx)}
                                                className="text-gray-400 hover:text-red-500"
                                            >
                                                <Trash2 size={14} />
                                            </button>
                                        </div>

                                        {/* Product, Color, Size selection */}
                                        <div className="grid grid-cols-3 gap-2">
                                            <select
                                                className="input text-sm"
                                                value={selection.productId}
                                                onChange={(e) => {
                                                    setLineSelections((s) => ({
                                                        ...s,
                                                        [idx]: { productId: e.target.value, variationId: '' },
                                                    }));
                                                    updateFormLine(idx, 'skuId', '');
                                                }}
                                            >
                                                <option value="">Product...</option>
                                                {products.map((p: any) => (
                                                    <option key={p.id} value={p.id}>
                                                        {p.name}
                                                    </option>
                                                ))}
                                            </select>
                                            <select
                                                className="input text-sm"
                                                value={selection.variationId}
                                                onChange={(e) => {
                                                    setLineSelections((s) => ({
                                                        ...s,
                                                        [idx]: { ...s[idx], variationId: e.target.value },
                                                    }));
                                                    updateFormLine(idx, 'skuId', '');
                                                }}
                                                disabled={!selection.productId}
                                            >
                                                <option value="">Colour...</option>
                                                {colors.map((c: any) => (
                                                    <option key={c.id} value={c.id}>
                                                        {c.name}
                                                    </option>
                                                ))}
                                            </select>
                                            <select
                                                className="input text-sm"
                                                value={line.skuId}
                                                onChange={(e) => updateFormLine(idx, 'skuId', e.target.value)}
                                                disabled={!selection.variationId}
                                                required
                                            >
                                                <option value="">Size...</option>
                                                {sizes.map((s: any) => (
                                                    <option key={s.id} value={s.id}>
                                                        {s.size} ({s.stock} in stock)
                                                    </option>
                                                ))}
                                            </select>
                                        </div>

                                        {/* Or search by SKU */}
                                        <div className="flex items-center gap-2 text-xs text-gray-400">
                                            <span>or</span>
                                            <select
                                                className="input text-xs flex-1"
                                                value={line.skuId}
                                                onChange={(e) => {
                                                    updateFormLine(idx, 'skuId', e.target.value);
                                                    const sku = allSkus?.find(
                                                        (s: any) => s.id === e.target.value
                                                    );
                                                    if (sku) {
                                                        setLineSelections((s) => ({
                                                            ...s,
                                                            [idx]: {
                                                                productId: sku.variation?.product?.id || '',
                                                                variationId: sku.variation?.id || '',
                                                            },
                                                        }));
                                                    }
                                                }}
                                            >
                                                <option value="">Search by SKU code...</option>
                                                {allSkus?.map((sku: any) => (
                                                    <option key={sku.id} value={sku.id}>
                                                        {sku.skuCode} - {sku.variation?.product?.name}{' '}
                                                        {sku.variation?.colorName} {sku.size} (
                                                        {getSkuBalance(inventoryBalance, sku.id)})
                                                    </option>
                                                ))}
                                            </select>
                                        </div>

                                        {/* Qty and Price */}
                                        <div className="flex items-center gap-2">
                                            {selectedSku && (
                                                <span className="text-xs text-gray-500 flex-1">
                                                    {selectedSku.skuCode}
                                                </span>
                                            )}
                                            <div className="flex items-center gap-1">
                                                <span className="text-xs text-gray-400">Qty:</span>
                                                <input
                                                    type="number"
                                                    className="input text-sm w-14 text-center"
                                                    value={line.qty}
                                                    onChange={(e) =>
                                                        updateFormLine(idx, 'qty', Number(e.target.value))
                                                    }
                                                    min={1}
                                                />
                                            </div>
                                            <div className="flex items-center gap-1">
                                                <span className="text-xs text-gray-400">₹</span>
                                                <input
                                                    type="number"
                                                    className="input text-sm w-20 text-right"
                                                    value={line.unitPrice}
                                                    onChange={(e) =>
                                                        updateFormLine(idx, 'unitPrice', Number(e.target.value))
                                                    }
                                                    min={0}
                                                />
                                            </div>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>

                        {orderLines.length > 0 && (
                            <p className="text-right text-sm font-medium mt-2">
                                Total: ₹
                                {orderLines
                                    .reduce((sum, l) => sum + l.qty * l.unitPrice, 0)
                                    .toLocaleString()}
                            </p>
                        )}
                    </div>

                    <div className="flex gap-3 pt-2">
                        <button
                            type="button"
                            onClick={onClose}
                            className="btn-secondary flex-1 text-sm"
                        >
                            Cancel
                        </button>
                        <button
                            type="submit"
                            className="btn-primary flex-1 text-sm"
                            disabled={isCreating}
                        >
                            {isCreating ? 'Creating...' : 'Create Order'}
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
}

export default CreateOrderModal;
