import { useState } from 'react';
import { X, Package, DollarSign } from 'lucide-react';
import type { ReturnActionQueueItem as ServerReturnActionQueueItem } from '@coh/shared/schemas/returns';
import { REFUND_METHODS } from '../types';
import { getOptimizedImageUrl } from '../../../utils/imageOptimization';

export interface ProcessRefundModalProps {
    item: ServerReturnActionQueueItem;
    onSubmit: (
        lineId: string,
        grossAmount: number,
        discountClawback: number,
        deductions: number,
        deductionNotes?: string,
        refundMethod?: 'payment_link' | 'bank_transfer' | 'store_credit'
    ) => void;
    onClose: () => void;
}

export function ProcessRefundModal({ item, onSubmit, onClose }: ProcessRefundModalProps) {
    // Calculate suggested gross amount from unit price * return qty
    const suggestedGross = item.unitPrice * item.returnQty;

    const [grossAmount, setGrossAmount] = useState(suggestedGross);
    const [discountClawback, setDiscountClawback] = useState(0);
    const [deductions, setDeductions] = useState(0);
    const [deductionNotes, setDeductionNotes] = useState('');
    const [refundMethod, setRefundMethod] = useState<'payment_link' | 'bank_transfer' | 'store_credit'>('payment_link');

    const netRefund = grossAmount - discountClawback - deductions;

    const handleSubmit = () => {
        if (netRefund <= 0) {
            alert('Net refund amount must be positive');
            return;
        }
        onSubmit(
            item.id,
            grossAmount,
            discountClawback,
            deductions,
            deductionNotes || undefined,
            refundMethod
        );
    };

    return (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
            <div className="bg-white rounded-lg max-w-lg w-full">
                <div className="p-6 border-b border-gray-200 flex items-center justify-between">
                    <h2 className="text-xl font-bold">Process Refund</h2>
                    <button onClick={onClose} className="text-gray-500 hover:text-gray-700">
                        <X size={24} />
                    </button>
                </div>

                <div className="p-6 space-y-4">
                    {/* Item Info */}
                    <div className="bg-gray-50 rounded-lg p-4">
                        <div className="flex items-start gap-3">
                            <div className="w-12 h-12 bg-gray-200 rounded flex items-center justify-center shrink-0">
                                {item.imageUrl ? (
                                    <img src={getOptimizedImageUrl(item.imageUrl, 'sm') || item.imageUrl} alt="" className="w-full h-full object-cover rounded" loading="lazy" />
                                ) : (
                                    <Package size={20} className="text-gray-400" />
                                )}
                            </div>
                            <div>
                                <div className="font-medium">{item.productName}</div>
                                <div className="text-sm text-gray-500">
                                    {item.colorName} - {item.size} ({item.skuCode})
                                </div>
                                <div className="text-sm text-gray-600 mt-1">
                                    Return Qty: {item.returnQty} x ₹{item.unitPrice.toLocaleString()} = ₹{suggestedGross.toLocaleString()}
                                </div>
                            </div>
                        </div>
                        <div className="mt-3 pt-3 border-t border-gray-200 text-sm text-gray-600">
                            <div>Order: <span className="font-medium">{item.orderNumber}</span></div>
                            <div>Customer: <span className="font-medium">{item.customerName}</span></div>
                            {item.returnCondition && (
                                <div>Item Condition: <span className="font-medium capitalize">{item.returnCondition.replace(/_/g, ' ')}</span></div>
                            )}
                        </div>
                    </div>

                    {/* Refund Calculation */}
                    <div className="space-y-3">
                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">
                                Gross Refund Amount
                            </label>
                            <div className="relative">
                                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500">₹</span>
                                <input
                                    type="number"
                                    value={grossAmount}
                                    onChange={(e) => setGrossAmount(Number(e.target.value))}
                                    className="w-full pl-8 pr-4 py-2 border border-gray-300 rounded-lg"
                                    min={0}
                                />
                            </div>
                            <p className="text-xs text-gray-500 mt-1">
                                Suggested: ₹{suggestedGross.toLocaleString()} based on unit price x return qty
                            </p>
                        </div>

                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">
                                Discount Clawback
                            </label>
                            <div className="relative">
                                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500">₹</span>
                                <input
                                    type="number"
                                    value={discountClawback}
                                    onChange={(e) => setDiscountClawback(Number(e.target.value))}
                                    className="w-full pl-8 pr-4 py-2 border border-gray-300 rounded-lg"
                                    min={0}
                                />
                            </div>
                            <p className="text-xs text-gray-500 mt-1">
                                Amount to recover if original order had promotional discount
                            </p>
                        </div>

                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">
                                Other Deductions
                            </label>
                            <div className="relative">
                                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500">₹</span>
                                <input
                                    type="number"
                                    value={deductions}
                                    onChange={(e) => setDeductions(Number(e.target.value))}
                                    className="w-full pl-8 pr-4 py-2 border border-gray-300 rounded-lg"
                                    min={0}
                                />
                            </div>
                        </div>

                        {deductions > 0 && (
                            <div>
                                <label className="block text-sm font-medium text-gray-700 mb-1">
                                    Deduction Notes
                                </label>
                                <input
                                    type="text"
                                    value={deductionNotes}
                                    onChange={(e) => setDeductionNotes(e.target.value)}
                                    placeholder="e.g., Return shipping charged, item damage fee"
                                    className="w-full px-4 py-2 border border-gray-300 rounded-lg"
                                />
                            </div>
                        )}

                        {/* Net Refund Display */}
                        <div className="bg-purple-50 border border-purple-200 rounded-lg p-4">
                            <div className="flex justify-between items-center">
                                <span className="font-medium text-purple-900">Net Refund Amount</span>
                                <span className={`text-xl font-bold ${netRefund >= 0 ? 'text-purple-700' : 'text-red-600'}`}>
                                    ₹{netRefund.toLocaleString()}
                                </span>
                            </div>
                            <div className="text-xs text-purple-600 mt-1">
                                = ₹{grossAmount.toLocaleString()} - ₹{discountClawback.toLocaleString()} - ₹{deductions.toLocaleString()}
                            </div>
                        </div>

                        {/* Refund Method */}
                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-2">
                                Refund Method
                            </label>
                            <div className="grid grid-cols-3 gap-2">
                                {REFUND_METHODS.map((method) => (
                                    <button
                                        key={method.value}
                                        onClick={() => setRefundMethod(method.value)}
                                        className={`px-3 py-2 text-sm rounded-lg border ${
                                            refundMethod === method.value
                                                ? 'border-purple-600 bg-purple-50 text-purple-700'
                                                : 'border-gray-300 hover:border-gray-400'
                                        }`}
                                    >
                                        {method.label}
                                    </button>
                                ))}
                            </div>
                        </div>
                    </div>
                </div>

                <div className="p-6 border-t border-gray-200 flex justify-end gap-2">
                    <button onClick={onClose} className="px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50">
                        Cancel
                    </button>
                    <button
                        onClick={handleSubmit}
                        disabled={netRefund <= 0}
                        className="px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 disabled:opacity-50 flex items-center gap-2"
                    >
                        <DollarSign size={16} />
                        Process Refund
                    </button>
                </div>
            </div>
        </div>
    );
}
