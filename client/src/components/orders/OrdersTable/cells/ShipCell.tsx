/**
 * ShipCell - Fulfillment action cell for shipping items
 */

import { Check } from 'lucide-react';
import type { CellProps } from '../types';

export function ShipCell({ row, handlersRef }: CellProps) {
    if (!row || row.lineStatus === 'cancelled') return null;

    const { allocatingLines, onMarkShippedLine, onUnmarkShippedLine, isAdmin, onForceShipLine } = handlersRef.current;

    const isPacked = row.lineStatus === 'packed';
    const isShipped = row.lineStatus === 'shipped';
    const isToggling = allocatingLines.has(row.lineId || '');

    // Already shipped - show green filled checkbox (can unship)
    if (isShipped) {
        return (
            <button
                onClick={(e) => {
                    e.stopPropagation();
                    if (isToggling) return;
                    if (row.lineId) onUnmarkShippedLine(row.lineId);
                }}
                disabled={isToggling}
                className="w-5 h-5 rounded border-2 bg-green-500 border-green-500 text-white flex items-center justify-center mx-auto shadow-sm hover:bg-green-600 cursor-pointer disabled:opacity-50"
                title="Click to unship"
            >
                {isToggling ? <span className="animate-spin text-xs">·</span> : <Check size={12} strokeWidth={3} />}
            </button>
        );
    }

    // Packed - show empty checkbox (can ship)
    if (isPacked) {
        const existingAwb = row.lineAwbNumber || row.shopifyAwb;
        return (
            <button
                onClick={(e) => {
                    e.stopPropagation();
                    if (isToggling || !row.lineId) return;
                    if (existingAwb) {
                        // Has AWB - ship directly
                        onMarkShippedLine(row.lineId, {
                            awbNumber: existingAwb,
                            courier: row.lineCourier || row.shopifyCourier || 'Unknown',
                        });
                    } else {
                        // No AWB - prompt for it
                        const awb = prompt('AWB Number (required):');
                        if (!awb?.trim()) return;
                        const courier = prompt('Courier:') || 'Unknown';
                        onMarkShippedLine(row.lineId, { awbNumber: awb.trim(), courier });
                    }
                }}
                disabled={isToggling}
                className="w-5 h-5 rounded border-2 border-green-400 bg-white hover:bg-green-100 hover:border-green-500 flex items-center justify-center mx-auto cursor-pointer shadow-sm disabled:opacity-50"
                title={existingAwb ? `Ship with AWB: ${existingAwb}` : 'Click to ship (will prompt for AWB)'}
            >
                {isToggling ? <span className="animate-spin text-xs">·</span> : null}
            </button>
        );
    }

    // Admin can force ship any line
    if (isAdmin && onForceShipLine) {
        const existingAwb = row.lineAwbNumber || row.shopifyAwb || '';
        const existingCourier = row.lineCourier || row.shopifyCourier || '';
        return (
            <button
                onClick={(e) => {
                    e.stopPropagation();
                    if (!row.lineId) return;
                    // Use existing values or prompt (optional)
                    const awbNumber = existingAwb || (prompt('AWB Number (optional, leave empty for default):') ?? '').trim();
                    const courier = existingCourier || (prompt('Courier (optional, leave empty for default):') ?? '').trim();
                    const awbDisplay = awbNumber || 'ADMIN-MANUAL';
                    const courierDisplay = courier || 'Manual';
                    if (confirm(`Force ship this line?\n\nSKU: ${row.skuCode}\nQty: ${row.qty}\nAWB: ${awbDisplay}\nCourier: ${courierDisplay}`)) {
                        onForceShipLine(row.lineId, { awbNumber, courier });
                    }
                }}
                className="w-5 h-5 rounded border-2 border-amber-400 bg-amber-50 hover:bg-amber-100 hover:border-amber-500 flex items-center justify-center mx-auto cursor-pointer shadow-sm"
                title={existingAwb ? `Admin: Force ship with AWB: ${existingAwb}` : 'Admin: Force ship (AWB optional)'}
            />
        );
    }

    // Not packed yet - don't show anything
    return null;
}
