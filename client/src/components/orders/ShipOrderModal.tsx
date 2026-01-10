/**
 * ShipOrderModal component
 * Modal for verifying AWB and marking order lines as shipped
 * Supports partial shipments - can ship selected lines with different AWBs
 */

import { useState, useEffect, useRef, useMemo } from 'react';
import { X, CheckCircle, AlertCircle, Truck, ScanBarcode, Package } from 'lucide-react';

interface ShipOrderModalProps {
    order: any;
    shipForm: { awbNumber: string; courier: string };
    onShipFormChange: (form: { awbNumber: string; courier: string }) => void;
    onShip: () => void;
    onShipLines?: (lineIds: string[]) => void;
    onClose: () => void;
    isShipping: boolean;
}

// Common courier options
const COURIER_OPTIONS = [
    'Delhivery',
    'BlueDart',
    'DTDC',
    'Ekart',
    'Xpressbees',
    'Shadowfax',
    'Ecom Express',
    'Other',
];

export function ShipOrderModal({
    order,
    shipForm,
    onShipFormChange,
    onShip,
    onShipLines,
    onClose,
    isShipping,
}: ShipOrderModalProps) {
    const scanInputRef = useRef<HTMLInputElement>(null);
    const [bypassVerification, setBypassVerification] = useState(false);
    const [selectedLineIds, setSelectedLineIds] = useState<Set<string>>(new Set());

    // Get expected AWB from Shopify or order
    const expectedAwb = order.shopifyCache?.trackingNumber || order.awbNumber || '';
    const expectedCourier = order.shopifyCache?.trackingCompany || order.courier || '';

    // Categorize lines by status
    const lines = order.orderLines || [];
    const { shippedLines, packedLines, otherLines } = useMemo(() => {
        const shipped: any[] = [];
        const packed: any[] = [];
        const other: any[] = [];

        for (const line of lines) {
            if (line.lineStatus === 'cancelled') continue;
            if (line.lineStatus === 'shipped') {
                shipped.push(line);
            } else if (line.lineStatus === 'packed') {
                packed.push(line);
            } else {
                other.push(line);
            }
        }

        return { shippedLines: shipped, packedLines: packed, otherLines: other };
    }, [lines]);

    // Group shipped lines by AWB for display
    const shippedByAwb = useMemo(() => {
        const groups: Record<string, any[]> = {};
        for (const line of shippedLines) {
            const awb = line.awbNumber || 'No AWB';
            if (!groups[awb]) groups[awb] = [];
            groups[awb].push(line);
        }
        return groups;
    }, [shippedLines]);

    // Determine mode: partial ship (has both shipped and packed) or full ship
    const isPartialMode = shippedLines.length > 0 || (onShipLines && packedLines.length > 0);

    // Initialize selected lines to all packed lines
    useEffect(() => {
        if (packedLines.length > 0) {
            setSelectedLineIds(new Set(packedLines.map((l: any) => l.id)));
        }
    }, [packedLines.length]);

    // Check if scanned AWB matches expected
    const scannedAwb = shipForm.awbNumber.trim();
    const awbMatches = scannedAwb !== '' &&
                       expectedAwb.trim() !== '' &&
                       scannedAwb.toLowerCase() === expectedAwb.trim().toLowerCase();

    // Check if we have all required info
    const hasAwb = scannedAwb !== '';
    const hasCourier = shipForm.courier.trim() !== '';
    const hasSelectedLines = selectedLineIds.size > 0;
    const isVerified = (awbMatches || bypassVerification) && hasAwb && hasCourier;

    // Can ship if we have AWB, courier, and either all packed (legacy) or selected lines (partial)
    const canShip = hasAwb && hasCourier && (isPartialMode ? hasSelectedLines : packedLines.length > 0);

    // Focus scan input on mount
    useEffect(() => {
        if (scanInputRef.current) {
            scanInputRef.current.focus();
        }
    }, []);

    // Pre-fill courier with expected value
    useEffect(() => {
        if (expectedCourier && !shipForm.courier) {
            const match = COURIER_OPTIONS.find(c =>
                c.toLowerCase() === expectedCourier.toLowerCase()
            );
            if (match) {
                onShipFormChange({ ...shipForm, courier: match });
            }
        }
    }, [expectedCourier]);

    const handleToggleLine = (lineId: string) => {
        setSelectedLineIds(prev => {
            const next = new Set(prev);
            if (next.has(lineId)) {
                next.delete(lineId);
            } else {
                next.add(lineId);
            }
            return next;
        });
    };

    const handleSelectAll = () => {
        setSelectedLineIds(new Set(packedLines.map((l: any) => l.id)));
    };

    const handleSelectNone = () => {
        setSelectedLineIds(new Set());
    };

    const handleShip = () => {
        if (isPartialMode && onShipLines && hasSelectedLines) {
            onShipLines(Array.from(selectedLineIds));
        } else {
            onShip();
        }
    };

    return (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
            <div className="bg-white rounded-xl w-full max-w-xl shadow-2xl overflow-hidden max-h-[90vh] flex flex-col">
                {/* Header */}
                <div className="px-6 py-4 bg-gradient-to-r from-emerald-600 to-emerald-700 text-white flex-shrink-0">
                    <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                            <div className="p-2 bg-white/20 rounded-lg">
                                <Truck size={24} />
                            </div>
                            <div>
                                <h2 className="text-lg font-semibold">Ship Order</h2>
                                <p className="text-emerald-100 text-sm">
                                    #{order.orderNumber} • {order.customerName}
                                </p>
                            </div>
                        </div>
                        <button
                            onClick={onClose}
                            className="p-2 hover:bg-white/20 rounded-lg transition-colors"
                        >
                            <X size={20} />
                        </button>
                    </div>
                </div>

                <div className="p-6 space-y-5 overflow-y-auto flex-1">
                    {/* Already Shipped Lines */}
                    {shippedLines.length > 0 && (
                        <div className="space-y-2">
                            <div className="text-sm font-medium text-gray-500">Already Shipped</div>
                            {Object.entries(shippedByAwb).map(([awb, groupLines]) => (
                                <div key={awb} className="p-3 bg-gray-50 border border-gray-200 rounded-lg">
                                    <div className="flex items-center gap-2 text-xs text-gray-500 mb-2">
                                        <Package size={12} />
                                        <span className="font-mono">{awb}</span>
                                        {groupLines[0]?.courier && (
                                            <span className="text-gray-400">• {groupLines[0].courier}</span>
                                        )}
                                    </div>
                                    <div className="space-y-1">
                                        {groupLines.map((line: any) => (
                                            <div key={line.id} className="flex items-center gap-2 text-sm text-gray-600">
                                                <CheckCircle size={14} className="text-emerald-500" />
                                                <span>{line.sku?.skuCode || line.skuId}</span>
                                                <span className="text-gray-400">×{line.qty}</span>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}

                    {/* Packed Lines - Ready to Ship */}
                    {packedLines.length > 0 && (
                        <div className="space-y-2">
                            <div className="flex items-center justify-between">
                                <div className="text-sm font-medium text-gray-700">
                                    Ready to Ship ({selectedLineIds.size}/{packedLines.length} selected)
                                </div>
                                {packedLines.length > 1 && (
                                    <div className="flex gap-2 text-xs">
                                        <button
                                            onClick={handleSelectAll}
                                            className="text-blue-600 hover:text-blue-700"
                                        >
                                            Select All
                                        </button>
                                        <span className="text-gray-300">|</span>
                                        <button
                                            onClick={handleSelectNone}
                                            className="text-gray-500 hover:text-gray-700"
                                        >
                                            None
                                        </button>
                                    </div>
                                )}
                            </div>
                            <div className="space-y-1">
                                {packedLines.map((line: any) => (
                                    <label
                                        key={line.id}
                                        className={`flex items-center gap-3 p-3 rounded-lg cursor-pointer transition-colors ${
                                            selectedLineIds.has(line.id)
                                                ? 'bg-emerald-50 border border-emerald-200'
                                                : 'bg-gray-50 border border-gray-200 hover:bg-gray-100'
                                        }`}
                                    >
                                        <input
                                            type="checkbox"
                                            checked={selectedLineIds.has(line.id)}
                                            onChange={() => handleToggleLine(line.id)}
                                            className="w-4 h-4 text-emerald-600 rounded border-gray-300 focus:ring-emerald-500"
                                        />
                                        <div className="flex-1">
                                            <div className="text-sm font-medium text-gray-900">
                                                {line.sku?.skuCode || line.skuId}
                                            </div>
                                            <div className="text-xs text-gray-500">
                                                {line.sku?.product?.name} • {line.sku?.color?.name} • {line.sku?.size?.name}
                                            </div>
                                        </div>
                                        <div className="text-sm font-medium text-gray-600">
                                            ×{line.qty}
                                        </div>
                                    </label>
                                ))}
                            </div>
                        </div>
                    )}

                    {/* Other Lines (not packed yet) */}
                    {otherLines.length > 0 && (
                        <div className="flex items-start gap-3 p-4 bg-amber-50 border border-amber-200 rounded-lg">
                            <AlertCircle className="text-amber-500 flex-shrink-0 mt-0.5" size={20} />
                            <div>
                                <div className="font-medium text-amber-800">Items not ready to ship</div>
                                <div className="text-sm text-amber-600 mt-1">
                                    {otherLines.length} item(s) still need to be packed before shipping.
                                </div>
                            </div>
                        </div>
                    )}

                    {/* Expected AWB from Shopify */}
                    {expectedAwb && !shippedLines.some((l: any) => l.awbNumber === expectedAwb) && (
                        <div className="p-4 bg-gray-50 border border-gray-200 rounded-lg">
                            <div className="text-xs text-gray-500 uppercase tracking-wide mb-1">
                                Expected AWB (from Shopify)
                            </div>
                            <div className="font-mono text-lg font-semibold text-gray-900">
                                {expectedAwb}
                            </div>
                            {expectedCourier && (
                                <div className="text-sm text-gray-500 mt-1">
                                    Courier: {expectedCourier}
                                </div>
                            )}
                        </div>
                    )}

                    {/* AWB Scan/Entry */}
                    {packedLines.length > 0 && (
                        <>
                            <div className="space-y-2">
                                <label className="flex items-center gap-2 text-sm font-medium text-gray-700">
                                    <ScanBarcode size={16} />
                                    Scan Package AWB
                                </label>
                                <div className="relative">
                                    <input
                                        ref={scanInputRef}
                                        type="text"
                                        className={`input text-lg font-mono w-full pr-12 ${
                                            scannedAwb && !bypassVerification && (awbMatches
                                                ? 'border-emerald-500 bg-emerald-50 focus:ring-emerald-500'
                                                : 'border-red-500 bg-red-50 focus:ring-red-500')
                                        }`}
                                        placeholder="Scan barcode or enter AWB..."
                                        value={shipForm.awbNumber}
                                        onChange={(e) => onShipFormChange({ ...shipForm, awbNumber: e.target.value })}
                                        autoComplete="off"
                                    />
                                    {scannedAwb && !bypassVerification && expectedAwb && (
                                        <div className="absolute right-3 top-1/2 -translate-y-1/2">
                                            {awbMatches ? (
                                                <CheckCircle className="text-emerald-500" size={24} />
                                            ) : (
                                                <AlertCircle className="text-red-500" size={24} />
                                            )}
                                        </div>
                                    )}
                                </div>
                                {scannedAwb && !bypassVerification && !awbMatches && expectedAwb && (
                                    <p className="text-sm text-red-600 flex items-center gap-1">
                                        <AlertCircle size={14} />
                                        AWB does not match Shopify ({expectedAwb})
                                    </p>
                                )}
                                {scannedAwb && !bypassVerification && awbMatches && (
                                    <p className="text-sm text-emerald-600 flex items-center gap-1">
                                        <CheckCircle size={14} />
                                        AWB verified - matches Shopify
                                    </p>
                                )}
                            </div>

                            {/* Bypass verification checkbox */}
                            {expectedAwb && (
                                <label className="flex items-center gap-3 p-3 bg-gray-50 rounded-lg cursor-pointer hover:bg-gray-100 transition-colors">
                                    <input
                                        type="checkbox"
                                        checked={bypassVerification}
                                        onChange={(e) => setBypassVerification(e.target.checked)}
                                        className="w-4 h-4 text-amber-600 rounded border-gray-300 focus:ring-amber-500"
                                    />
                                    <div>
                                        <span className="text-sm font-medium text-gray-700">Bypass AWB verification</span>
                                        <p className="text-xs text-gray-500">Skip matching against Shopify AWB</p>
                                    </div>
                                </label>
                            )}

                            {/* Courier Selection */}
                            <div className="space-y-2">
                                <label className="text-sm font-medium text-gray-700">Courier</label>
                                <select
                                    className="input w-full"
                                    value={shipForm.courier}
                                    onChange={(e) => onShipFormChange({ ...shipForm, courier: e.target.value })}
                                >
                                    <option value="">Select courier...</option>
                                    {COURIER_OPTIONS.map((c) => (
                                        <option key={c} value={c}>{c}</option>
                                    ))}
                                </select>
                            </div>
                        </>
                    )}
                </div>

                {/* Actions */}
                {packedLines.length > 0 && (
                    <div className="px-6 py-4 bg-gray-50 border-t border-gray-200 flex gap-3 flex-shrink-0">
                        <button
                            type="button"
                            onClick={onClose}
                            className="btn-secondary flex-1"
                        >
                            Cancel
                        </button>
                        <button
                            onClick={handleShip}
                            disabled={isShipping || !canShip}
                            className={`flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg font-medium transition-all ${
                                isVerified && canShip
                                    ? 'bg-emerald-600 hover:bg-emerald-700 text-white shadow-lg shadow-emerald-200'
                                    : !canShip
                                        ? 'bg-gray-300 text-gray-500 cursor-not-allowed'
                                        : 'bg-amber-500 hover:bg-amber-600 text-white'
                            } disabled:opacity-50`}
                        >
                            <Truck size={18} />
                            {isShipping
                                ? 'Shipping...'
                                : isPartialMode
                                    ? `Ship ${selectedLineIds.size} Item${selectedLineIds.size !== 1 ? 's' : ''}`
                                    : 'Mark as Shipped'
                            }
                        </button>
                    </div>
                )}

                {/* No packed lines - show message */}
                {packedLines.length === 0 && shippedLines.length > 0 && (
                    <div className="px-6 py-4 bg-gray-50 border-t border-gray-200">
                        <div className="text-center text-gray-600">
                            All items have been shipped.
                        </div>
                        <button
                            onClick={onClose}
                            className="btn-secondary w-full mt-3"
                        >
                            Close
                        </button>
                    </div>
                )}
            </div>
        </div>
    );
}

export default ShipOrderModal;
