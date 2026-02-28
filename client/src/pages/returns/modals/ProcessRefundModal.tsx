import { useState, useMemo } from 'react';
import { X, Package, DollarSign } from 'lucide-react';
import { toast } from 'sonner';
import type { ReturnActionQueueItem as ServerReturnActionQueueItem } from '@coh/shared/schemas/returns';
import type { ReturnConfigResponse } from '../../../server/functions/returns';
import { REFUND_METHODS } from '../types';
import { getOptimizedImageUrl } from '../../../utils/imageOptimization';

export interface ProcessRefundModalProps {
    item: ServerReturnActionQueueItem;
    config?: ReturnConfigResponse;
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

export function ProcessRefundModal({ item, config, onSubmit, onClose }: ProcessRefundModalProps) {
    const suggestedGross = item.unitPrice * item.returnQty;

    // Calculate default fees from config
    const defaultFees = useMemo(() => {
        const shippingFee = config?.returnShippingFee ?? 0;
        let restockingFee = 0;
        if (config?.restockingFeeType === 'flat' && config.restockingFeeValue) {
            restockingFee = config.restockingFeeValue;
        } else if (config?.restockingFeeType === 'percent' && config.restockingFeeValue) {
            restockingFee = Math.round((suggestedGross * config.restockingFeeValue / 100) * 100) / 100;
        }
        return { shippingFee, restockingFee };
    }, [config, suggestedGross]);

    const [grossAmount, setGrossAmount] = useState(suggestedGross);
    const [discountClawback, setDiscountClawback] = useState(0);
    const [returnShippingFee, setReturnShippingFee] = useState(defaultFees.shippingFee);
    const [restockingFee, setRestockingFee] = useState(defaultFees.restockingFee);
    const [otherDeductions, setOtherDeductions] = useState(0);
    const [deductionNotes, setDeductionNotes] = useState('');
    const [refundMethod, setRefundMethod] = useState<'payment_link' | 'bank_transfer' | 'store_credit'>('payment_link');

    const totalDeductions = returnShippingFee + restockingFee + otherDeductions;
    const netRefund = grossAmount - discountClawback - totalDeductions;

    // Build deduction notes from structured fees
    const buildDeductionNotes = (): string => {
        const parts: string[] = [];
        if (returnShippingFee > 0) parts.push(`Return shipping: ₹${returnShippingFee}`);
        if (restockingFee > 0) {
            const label = config?.restockingFeeType === 'percent'
                ? `Restocking ${config.restockingFeeValue}%: ₹${restockingFee}`
                : `Restocking fee: ₹${restockingFee}`;
            parts.push(label);
        }
        if (otherDeductions > 0 && deductionNotes) parts.push(deductionNotes);
        else if (otherDeductions > 0) parts.push(`Other: ₹${otherDeductions}`);
        return parts.join(' | ');
    };

    const handleSubmit = () => {
        if (netRefund <= 0) {
            toast.error('Net refund amount must be positive');
            return;
        }
        onSubmit(
            item.id,
            grossAmount,
            discountClawback,
            totalDeductions,
            buildDeductionNotes() || undefined,
            refundMethod
        );
    };

    return (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
            <div className="bg-white rounded-lg max-w-lg w-full max-h-[90vh] overflow-y-auto">
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

                        {/* Structured Fees */}
                        <div className="border border-gray-200 rounded-lg p-4 space-y-3">
                            <h4 className="text-sm font-medium text-gray-700">Fees & Deductions</h4>

                            <div className="grid grid-cols-2 gap-3">
                                <div>
                                    <label className="block text-xs text-gray-600 mb-1">
                                        Return Shipping Fee
                                    </label>
                                    <div className="relative">
                                        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm">₹</span>
                                        <input
                                            type="number"
                                            value={returnShippingFee}
                                            onChange={(e) => setReturnShippingFee(Number(e.target.value))}
                                            className="w-full pl-7 pr-3 py-1.5 border border-gray-300 rounded-lg text-sm"
                                            min={0}
                                        />
                                    </div>
                                    {config?.returnShippingFee ? (
                                        <p className="text-xs text-gray-400 mt-0.5">Default: ₹{config.returnShippingFee}</p>
                                    ) : null}
                                </div>

                                <div>
                                    <label className="block text-xs text-gray-600 mb-1">
                                        Restocking Fee
                                        {config?.restockingFeeType === 'percent' && config.restockingFeeValue
                                            ? ` (${config.restockingFeeValue}%)`
                                            : ''}
                                    </label>
                                    <div className="relative">
                                        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm">₹</span>
                                        <input
                                            type="number"
                                            value={restockingFee}
                                            onChange={(e) => setRestockingFee(Number(e.target.value))}
                                            className="w-full pl-7 pr-3 py-1.5 border border-gray-300 rounded-lg text-sm"
                                            min={0}
                                        />
                                    </div>
                                    {defaultFees.restockingFee > 0 ? (
                                        <p className="text-xs text-gray-400 mt-0.5">Default: ₹{defaultFees.restockingFee}</p>
                                    ) : null}
                                </div>
                            </div>

                            <div>
                                <label className="block text-xs text-gray-600 mb-1">
                                    Other Deductions
                                </label>
                                <div className="relative">
                                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm">₹</span>
                                    <input
                                        type="number"
                                        value={otherDeductions}
                                        onChange={(e) => setOtherDeductions(Number(e.target.value))}
                                        className="w-full pl-7 pr-3 py-1.5 border border-gray-300 rounded-lg text-sm"
                                        min={0}
                                    />
                                </div>
                            </div>

                            {otherDeductions > 0 && (
                                <div>
                                    <label className="block text-xs text-gray-600 mb-1">
                                        Deduction Notes
                                    </label>
                                    <input
                                        type="text"
                                        value={deductionNotes}
                                        onChange={(e) => setDeductionNotes(e.target.value)}
                                        placeholder="e.g., Item damage fee, missing accessories"
                                        className="w-full px-3 py-1.5 border border-gray-300 rounded-lg text-sm"
                                    />
                                </div>
                            )}
                        </div>

                        {/* Net Refund Display */}
                        <div className="bg-purple-50 border border-purple-200 rounded-lg p-4">
                            <div className="flex justify-between items-center">
                                <span className="font-medium text-purple-900">Net Refund Amount</span>
                                <span className={`text-xl font-bold ${netRefund >= 0 ? 'text-purple-700' : 'text-red-600'}`}>
                                    ₹{netRefund.toLocaleString()}
                                </span>
                            </div>
                            <div className="text-xs text-purple-600 mt-2 space-y-0.5">
                                <div className="flex justify-between">
                                    <span>Gross amount</span>
                                    <span>₹{grossAmount.toLocaleString()}</span>
                                </div>
                                {discountClawback > 0 && (
                                    <div className="flex justify-between text-red-600">
                                        <span>Discount clawback</span>
                                        <span>- ₹{discountClawback.toLocaleString()}</span>
                                    </div>
                                )}
                                {returnShippingFee > 0 && (
                                    <div className="flex justify-between text-red-600">
                                        <span>Return shipping</span>
                                        <span>- ₹{returnShippingFee.toLocaleString()}</span>
                                    </div>
                                )}
                                {restockingFee > 0 && (
                                    <div className="flex justify-between text-red-600">
                                        <span>Restocking fee</span>
                                        <span>- ₹{restockingFee.toLocaleString()}</span>
                                    </div>
                                )}
                                {otherDeductions > 0 && (
                                    <div className="flex justify-between text-red-600">
                                        <span>Other deductions</span>
                                        <span>- ₹{otherDeductions.toLocaleString()}</span>
                                    </div>
                                )}
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
                        className="px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
                    >
                        <DollarSign size={16} />
                        Process Refund
                    </button>
                </div>
            </div>
        </div>
    );
}
