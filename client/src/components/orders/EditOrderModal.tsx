/**
 * EditOrderModal component
 * Modal for editing order customer details and line items
 */

import { useState, useEffect } from 'react';
import { X, Undo2, Plus } from 'lucide-react';

interface EditOrderModalProps {
    order: any;
    allSkus: any[];
    onUpdateOrder: (data: { customerName: string; customerPhone: string; shippingAddress: string }) => void;
    onUpdateLine: (lineId: string, data: any) => void;
    onAddLine: (orderId: string, data: any) => void;
    onCancelLine: (lineId: string) => void;
    onUncancelLine: (lineId: string) => void;
    onClose: () => void;
    isUpdating: boolean;
    isAddingLine: boolean;
}

export function EditOrderModal({
    order,
    allSkus,
    onUpdateOrder,
    onUpdateLine,
    onAddLine,
    onCancelLine,
    onUncancelLine,
    onClose,
    isUpdating,
    isAddingLine,
}: EditOrderModalProps) {
    const [editForm, setEditForm] = useState({
        customerName: '',
        customerPhone: '',
        shippingAddress: '',
    });

    useEffect(() => {
        if (order) {
            setEditForm({
                customerName: order.customerName || '',
                customerPhone: order.customerPhone || '',
                shippingAddress: order.shippingAddress || '',
            });
        }
    }, [order]);

    const handleAddLine = () => {
        const skuSelect = document.getElementById('addLineSku') as HTMLSelectElement;
        const qtyInput = document.getElementById('addLineQty') as HTMLInputElement;

        if (skuSelect.value) {
            const sku = allSkus?.find((s: any) => s.id === skuSelect.value);
            onAddLine(order.id, {
                skuId: skuSelect.value,
                qty: parseInt(qtyInput.value) || 1,
                unitPrice: sku?.mrp || 0,
            });
            skuSelect.value = '';
            qtyInput.value = '1';
        }
    };

    return (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
            <div className="bg-white rounded-xl p-6 w-full max-w-2xl max-h-[90vh] overflow-y-auto">
                <div className="flex items-center justify-between mb-4">
                    <div>
                        <h2 className="text-lg font-semibold">Edit Order</h2>
                        <p className="text-sm text-gray-500">{order.orderNumber}</p>
                    </div>
                    <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
                        <X size={20} />
                    </button>
                </div>

                {/* Customer Details */}
                <div className="grid grid-cols-2 gap-4 mb-6">
                    <div>
                        <label className="text-xs text-gray-500 mb-1 block">Customer Name</label>
                        <input
                            className="input text-sm"
                            value={editForm.customerName}
                            onChange={(e) =>
                                setEditForm((f) => ({ ...f, customerName: e.target.value }))
                            }
                        />
                    </div>
                    <div>
                        <label className="text-xs text-gray-500 mb-1 block">Phone</label>
                        <input
                            className="input text-sm"
                            value={editForm.customerPhone}
                            onChange={(e) =>
                                setEditForm((f) => ({ ...f, customerPhone: e.target.value }))
                            }
                        />
                    </div>
                </div>

                {/* Order Lines */}
                <div className="mb-6">
                    <h3 className="text-sm font-semibold text-gray-700 mb-2">Order Items</h3>
                    <div className="border rounded-lg overflow-hidden">
                        <table className="w-full text-sm">
                            <thead className="bg-gray-50">
                                <tr>
                                    <th className="text-left py-2 px-3 font-medium text-gray-600">
                                        Item
                                    </th>
                                    <th className="text-center py-2 px-3 font-medium text-gray-600 w-20">
                                        Qty
                                    </th>
                                    <th className="text-right py-2 px-3 font-medium text-gray-600 w-24">
                                        Price
                                    </th>
                                    <th className="text-center py-2 px-3 font-medium text-gray-600 w-20">
                                        Status
                                    </th>
                                    <th className="w-12"></th>
                                </tr>
                            </thead>
                            <tbody>
                                {order.orderLines?.map((line: any) => (
                                    <tr
                                        key={line.id}
                                        className={`border-t ${
                                            line.lineStatus === 'cancelled'
                                                ? 'bg-gray-50 text-gray-400'
                                                : ''
                                        }`}
                                    >
                                        <td
                                            className={`py-2 px-3 ${
                                                line.lineStatus === 'cancelled' ? 'line-through' : ''
                                            }`}
                                        >
                                            <p className="font-medium">
                                                {line.sku?.variation?.product?.name}
                                            </p>
                                            <p className="text-xs text-gray-500">
                                                {line.sku?.variation?.colorName} - {line.sku?.size}
                                            </p>
                                        </td>
                                        <td className="py-2 px-3 text-center">
                                            {line.lineStatus === 'pending' ? (
                                                <input
                                                    type="number"
                                                    min="1"
                                                    defaultValue={line.qty}
                                                    className="w-16 text-center border rounded px-1 py-0.5 text-sm"
                                                    onBlur={(e) => {
                                                        const newQty = parseInt(e.target.value);
                                                        if (newQty !== line.qty && newQty > 0) {
                                                            onUpdateLine(line.id, { qty: newQty });
                                                        }
                                                    }}
                                                />
                                            ) : (
                                                line.qty
                                            )}
                                        </td>
                                        <td className="py-2 px-3 text-right">
                                            ₹{Number(line.unitPrice).toLocaleString()}
                                        </td>
                                        <td className="py-2 px-3 text-center">
                                            <span
                                                className={`text-xs px-1.5 py-0.5 rounded ${
                                                    line.lineStatus === 'cancelled'
                                                        ? 'bg-red-100 text-red-700'
                                                        : line.lineStatus === 'pending'
                                                        ? 'bg-gray-100 text-gray-600'
                                                        : 'bg-blue-100 text-blue-700'
                                                }`}
                                            >
                                                {line.lineStatus}
                                            </span>
                                        </td>
                                        <td className="py-2 px-3 text-center">
                                            {line.lineStatus === 'cancelled' ? (
                                                <button
                                                    onClick={() => onUncancelLine(line.id)}
                                                    className="text-green-500 hover:text-green-700"
                                                    title="Restore"
                                                >
                                                    <Undo2 size={14} />
                                                </button>
                                            ) : line.lineStatus === 'pending' ? (
                                                <button
                                                    onClick={() => onCancelLine(line.id)}
                                                    className="text-gray-400 hover:text-red-500"
                                                    title="Cancel"
                                                >
                                                    <X size={14} />
                                                </button>
                                            ) : null}
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>

                    {/* Add New Item */}
                    <div className="mt-3 p-3 bg-gray-50 rounded-lg">
                        <p className="text-xs font-medium text-gray-600 mb-2">Add Item</p>
                        <div className="flex gap-2">
                            <select
                                className="flex-1 text-sm border rounded px-2 py-1"
                                id="addLineSku"
                                defaultValue=""
                            >
                                <option value="">Select SKU...</option>
                                {allSkus?.map((sku: any) => (
                                    <option key={sku.id} value={sku.id}>
                                        {sku.skuCode} - {sku.variation?.product?.name} ({sku.size}) - ₹
                                        {sku.mrp}
                                    </option>
                                ))}
                            </select>
                            <input
                                type="number"
                                min="1"
                                defaultValue="1"
                                className="w-16 text-center border rounded px-2 py-1 text-sm"
                                id="addLineQty"
                            />
                            <button
                                type="button"
                                onClick={handleAddLine}
                                className="btn-primary text-sm px-3 py-1"
                                disabled={isAddingLine}
                            >
                                <Plus size={14} />
                            </button>
                        </div>
                    </div>
                </div>

                {/* Action Buttons */}
                <div className="flex gap-3 pt-2 border-t">
                    <button
                        type="button"
                        onClick={onClose}
                        className="btn-secondary flex-1 text-sm"
                    >
                        Close
                    </button>
                    <button
                        type="button"
                        onClick={() => onUpdateOrder(editForm)}
                        className="btn-primary flex-1 text-sm"
                        disabled={isUpdating}
                    >
                        {isUpdating ? 'Saving...' : 'Save Customer Details'}
                    </button>
                </div>
            </div>
        </div>
    );
}

export default EditOrderModal;
