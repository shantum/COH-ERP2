/**
 * SchedulePickupDialog - Dialog for scheduling return pickups
 *
 * Allows users to either:
 * 1. Book via iThink (Delhivery only) - auto-generates AWB
 * 2. Manual entry - user provides AWB and courier
 */

import { useState, useEffect } from 'react';
import {
    Truck,
    X,
    CheckCircle2,
    AlertCircle,
    Loader2,
    MapPin,
    Phone,
    Package,
} from 'lucide-react';
import type { Order, OrderLine } from '../../../../types';

// Pickup mode options
type PickupMode = 'ithink' | 'manual';

interface SchedulePickupDialogProps {
    isOpen: boolean;
    onClose: () => void;
    order: Order;
    orderLine: OrderLine;
    onSchedule: (params: {
        scheduleWithIthink: boolean;
        courier?: string;
        awbNumber?: string;
    }) => Promise<{ success: boolean; awbNumber?: string; courier?: string; error?: string }>;
}

interface ServiceabilityStatus {
    checking: boolean;
    serviceable: boolean | null;
    message?: string;
}

// Parse address (could be JSON string or object)
function parseAddress(addr: unknown): Record<string, unknown> | null {
    if (!addr) return null;
    if (typeof addr === 'object') return addr as Record<string, unknown>;
    if (typeof addr === 'string') {
        try {
            return JSON.parse(addr);
        } catch {
            return null;
        }
    }
    return null;
}

// Extract pincode from address string or JSON
function extractPincode(order: Order): string {
    // Try shippingAddress as JSON first
    const addrObj = parseAddress(order.shippingAddress);
    if (addrObj) {
        if (addrObj.zip) return String(addrObj.zip);
        if (addrObj.pincode) return String(addrObj.pincode);
    }

    // Try customer defaultAddress
    const customer = order.customer;
    if (customer?.defaultAddress) {
        const customerAddr = parseAddress(customer.defaultAddress);
        if (customerAddr?.zip) return String(customerAddr.zip);
        if (customerAddr?.pincode) return String(customerAddr.pincode);
    }

    // Try to extract from string address (6-digit Indian pincode)
    if (typeof order.shippingAddress === 'string') {
        const match = order.shippingAddress.match(/\b\d{6}\b/);
        if (match) return match[0];
    }

    return '';
}

// Format address for display
function formatAddress(order: Order): {
    name: string;
    line1: string;
    line2: string;
    cityState: string;
    pincode: string;
    phone: string;
} {
    const addrObj = parseAddress(order.shippingAddress);
    const customer = order.customer;

    // Get customer name - try order.customerName first, then customer firstName/lastName
    const customerName = customer
        ? [customer.firstName, customer.lastName].filter(Boolean).join(' ') || 'Customer'
        : 'Customer';
    const name = order.customerName || customerName;
    const phone = order.customerPhone || customer?.phone || '';

    let line1 = '';
    let line2 = '';
    let cityState = '';
    let pincode = '';

    if (addrObj) {
        line1 = String(addrObj.address1 || '');
        line2 = String(addrObj.address2 || '');
        const city = String(addrObj.city || '');
        const state = String(addrObj.province || addrObj.state || '');
        cityState = [city, state].filter(Boolean).join(', ');
        pincode = String(addrObj.zip || addrObj.pincode || '');
    } else if (typeof order.shippingAddress === 'string') {
        // Address is a plain string
        line1 = order.shippingAddress;
        pincode = extractPincode(order);
    }

    // Fallback to customer defaultAddress
    if (!line1 && customer?.defaultAddress) {
        const customerAddr = parseAddress(customer.defaultAddress);
        if (customerAddr) {
            line1 = String(customerAddr.address1 || '');
            line2 = String(customerAddr.address2 || '');
            const city = String(customerAddr.city || '');
            const state = String(customerAddr.province || customerAddr.state || '');
            cityState = [city, state].filter(Boolean).join(', ');
            pincode = String(customerAddr.zip || customerAddr.pincode || '');
        }
    }

    return { name, line1, line2, cityState, pincode, phone };
}

export function SchedulePickupDialog({
    isOpen,
    onClose,
    order,
    orderLine,
    onSchedule,
}: SchedulePickupDialogProps) {
    const [mode, setMode] = useState<PickupMode>('ithink');
    const [manualCourier, setManualCourier] = useState('Delhivery');
    const [manualAwb, setManualAwb] = useState('');
    const [isScheduling, setIsScheduling] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [serviceability, setServiceability] = useState<ServiceabilityStatus>({
        checking: false,
        serviceable: null,
    });

    const address = formatAddress(order);
    const pincode = extractPincode(order);

    // Check serviceability on mount
    useEffect(() => {
        if (isOpen && pincode) {
            checkServiceability(pincode);
        }
    }, [isOpen, pincode]);

    async function checkServiceability(pin: string) {
        setServiceability({ checking: true, serviceable: null });
        try {
            const baseUrl = import.meta.env.VITE_API_URL || 'http://localhost:3001';
            const response = await fetch(`${baseUrl}/api/returns/check-serviceability`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify({ pincode: pin }),
            });

            const result = await response.json() as {
                success: boolean;
                data?: { serviceable: boolean; message?: string };
                error?: string;
            };

            if (result.success && result.data) {
                setServiceability({
                    checking: false,
                    serviceable: result.data.serviceable,
                    message: result.data.message,
                });
            } else {
                setServiceability({
                    checking: false,
                    serviceable: false,
                    message: result.error || 'Failed to check serviceability',
                });
            }
        } catch {
            setServiceability({
                checking: false,
                serviceable: false,
                message: 'Failed to check serviceability',
            });
        }
    }

    async function handleSchedule() {
        setIsScheduling(true);
        setError(null);

        try {
            const result = await onSchedule({
                scheduleWithIthink: mode === 'ithink',
                courier: mode === 'manual' ? manualCourier : undefined,
                awbNumber: mode === 'manual' ? manualAwb : undefined,
            });

            if (result.success) {
                onClose();
            } else {
                setError(result.error || 'Failed to schedule pickup');
            }
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to schedule pickup');
        } finally {
            setIsScheduling(false);
        }
    }

    // Validation
    const canScheduleIthink = serviceability.serviceable === true;
    const canScheduleManual = manualAwb.trim().length > 0 && manualCourier.trim().length > 0;
    const canSchedule = mode === 'ithink' ? canScheduleIthink : canScheduleManual;

    if (!isOpen) return null;

    // Get product info from order line
    const sku = orderLine.sku;
    const productName = sku?.variation?.product?.name || 'Product';
    const skuCode = sku?.skuCode || orderLine.skuId;

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
            {/* Backdrop */}
            <div
                className="absolute inset-0 bg-black/50"
                onClick={onClose}
            />

            {/* Dialog */}
            <div className="relative bg-white rounded-xl shadow-2xl w-full max-w-md mx-4 overflow-hidden">
                {/* Header */}
                <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200 bg-gradient-to-r from-blue-50 to-white">
                    <div className="flex items-center gap-3">
                        <div className="p-2 bg-blue-100 rounded-lg">
                            <Truck size={20} className="text-blue-600" />
                        </div>
                        <div>
                            <h2 className="text-lg font-semibold text-slate-800">Schedule Return Pickup</h2>
                            <p className="text-xs text-slate-500">Order #{order.orderNumber}</p>
                        </div>
                    </div>
                    <button
                        onClick={onClose}
                        className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-lg transition-colors"
                    >
                        <X size={20} />
                    </button>
                </div>

                {/* Content */}
                <div className="p-5 space-y-5">
                    {/* Product Info */}
                    <div className="flex items-center gap-3 p-3 bg-slate-50 rounded-lg">
                        <Package size={18} className="text-slate-400" />
                        <div className="min-w-0 flex-1">
                            <p className="text-sm font-medium text-slate-700 truncate">{productName}</p>
                            <p className="text-xs text-slate-500">SKU: {skuCode} | Qty: {orderLine.returnQty || orderLine.qty}</p>
                        </div>
                    </div>

                    {/* Pickup Address */}
                    <div className="space-y-2">
                        <h3 className="text-sm font-medium text-slate-700 flex items-center gap-2">
                            <MapPin size={14} className="text-slate-400" />
                            Pickup Address
                        </h3>
                        <div className="p-3 bg-slate-50 rounded-lg text-sm">
                            <p className="font-medium text-slate-800">{address.name}</p>
                            {address.line1 && <p className="text-slate-600">{address.line1}</p>}
                            {address.line2 && <p className="text-slate-600">{address.line2}</p>}
                            <p className="text-slate-600">
                                {address.cityState}
                                {address.cityState && address.pincode && ' - '}
                                <span className="font-medium">{address.pincode}</span>
                            </p>
                            {address.phone && (
                                <p className="text-slate-500 flex items-center gap-1 mt-1">
                                    <Phone size={12} />
                                    {address.phone}
                                </p>
                            )}
                        </div>
                    </div>

                    {/* Serviceability Status */}
                    <div className="p-3 rounded-lg border border-slate-200">
                        {serviceability.checking ? (
                            <div className="flex items-center gap-2 text-slate-500">
                                <Loader2 size={16} className="animate-spin" />
                                <span className="text-sm">Checking pickup availability...</span>
                            </div>
                        ) : serviceability.serviceable === true ? (
                            <div className="flex items-center gap-2 text-green-600">
                                <CheckCircle2 size={16} />
                                <span className="text-sm font-medium">Pickup available via Delhivery</span>
                            </div>
                        ) : serviceability.serviceable === false ? (
                            <div className="flex items-center gap-2 text-amber-600">
                                <AlertCircle size={16} />
                                <span className="text-sm">{serviceability.message || 'iThink pickup not available'}</span>
                            </div>
                        ) : !pincode ? (
                            <div className="flex items-center gap-2 text-amber-600">
                                <AlertCircle size={16} />
                                <span className="text-sm">No pincode found in address</span>
                            </div>
                        ) : null}
                    </div>

                    {/* Pickup Mode Selection */}
                    <div className="space-y-3">
                        <h3 className="text-sm font-medium text-slate-700">Pickup Method</h3>

                        {/* iThink Option */}
                        <label
                            className={`flex items-start gap-3 p-3 rounded-lg border-2 cursor-pointer transition-all ${
                                mode === 'ithink'
                                    ? 'border-blue-500 bg-blue-50'
                                    : 'border-slate-200 hover:border-slate-300'
                            } ${!canScheduleIthink && mode !== 'ithink' ? 'opacity-50' : ''}`}
                        >
                            <input
                                type="radio"
                                name="pickupMode"
                                value="ithink"
                                checked={mode === 'ithink'}
                                onChange={() => setMode('ithink')}
                                disabled={!canScheduleIthink}
                                className="mt-1"
                            />
                            <div>
                                <p className="text-sm font-medium text-slate-700">
                                    Book iThink Pickup
                                    {canScheduleIthink && <span className="text-xs text-green-600 ml-2">(Recommended)</span>}
                                </p>
                                <p className="text-xs text-slate-500 mt-0.5">
                                    AWB will be auto-generated. Delhivery pickup.
                                </p>
                            </div>
                        </label>

                        {/* Manual Option */}
                        <label
                            className={`flex items-start gap-3 p-3 rounded-lg border-2 cursor-pointer transition-all ${
                                mode === 'manual'
                                    ? 'border-blue-500 bg-blue-50'
                                    : 'border-slate-200 hover:border-slate-300'
                            }`}
                        >
                            <input
                                type="radio"
                                name="pickupMode"
                                value="manual"
                                checked={mode === 'manual'}
                                onChange={() => setMode('manual')}
                                className="mt-1"
                            />
                            <div className="flex-1">
                                <p className="text-sm font-medium text-slate-700">Manual Entry</p>
                                <p className="text-xs text-slate-500 mt-0.5">
                                    Customer ships the return / Enter AWB manually
                                </p>

                                {mode === 'manual' && (
                                    <div className="mt-3 space-y-3">
                                        <div>
                                            <label className="block text-xs font-medium text-slate-600 mb-1">
                                                Courier
                                            </label>
                                            <select
                                                value={manualCourier}
                                                onChange={(e) => setManualCourier(e.target.value)}
                                                className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                                            >
                                                <option value="Delhivery">Delhivery</option>
                                                <option value="BlueDart">BlueDart</option>
                                                <option value="DTDC">DTDC</option>
                                                <option value="Xpressbees">Xpressbees</option>
                                                <option value="India Post">India Post</option>
                                                <option value="Other">Other</option>
                                            </select>
                                        </div>
                                        <div>
                                            <label className="block text-xs font-medium text-slate-600 mb-1">
                                                AWB Number <span className="text-red-500">*</span>
                                            </label>
                                            <input
                                                type="text"
                                                value={manualAwb}
                                                onChange={(e) => setManualAwb(e.target.value.toUpperCase())}
                                                placeholder="Enter AWB number"
                                                className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 font-mono"
                                            />
                                        </div>
                                    </div>
                                )}
                            </div>
                        </label>
                    </div>

                    {/* Error Display */}
                    {error && (
                        <div className="p-3 bg-red-50 text-red-700 text-sm rounded-lg flex items-center gap-2">
                            <AlertCircle size={16} />
                            {error}
                        </div>
                    )}
                </div>

                {/* Footer */}
                <div className="flex items-center justify-end gap-3 px-5 py-4 border-t border-slate-200 bg-slate-50">
                    <button
                        onClick={onClose}
                        disabled={isScheduling}
                        className="px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-200 rounded-lg transition-colors"
                    >
                        Cancel
                    </button>
                    <button
                        onClick={handleSchedule}
                        disabled={!canSchedule || isScheduling}
                        className={`px-4 py-2 text-sm font-medium rounded-lg transition-colors flex items-center gap-2 ${
                            canSchedule && !isScheduling
                                ? 'bg-blue-600 text-white hover:bg-blue-700'
                                : 'bg-slate-200 text-slate-500 cursor-not-allowed'
                        }`}
                    >
                        {isScheduling ? (
                            <>
                                <Loader2 size={16} className="animate-spin" />
                                Scheduling...
                            </>
                        ) : (
                            <>
                                <Truck size={16} />
                                Schedule Pickup
                            </>
                        )}
                    </button>
                </div>
            </div>
        </div>
    );
}
