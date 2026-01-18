/**
 * ShipCell - Fulfillment action cell for shipping items
 */

import { Check } from 'lucide-react';
import type { CellProps } from '../types';
import { cn } from '../../../../lib/utils';
import { CheckboxSpinner } from './CheckboxSpinner';

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
                className={cn(
                    'w-5 h-5 rounded border-2 flex items-center justify-center mx-auto shadow-sm cursor-pointer transition-all',
                    isToggling
                        ? 'bg-green-100 border-green-300'
                        : 'bg-green-500 border-green-500 text-white hover:bg-green-600'
                )}
                title={isToggling ? 'Updating...' : 'Click to unship'}
            >
                {isToggling ? <CheckboxSpinner color="green" /> : <Check size={12} strokeWidth={3} />}
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
                className={cn(
                    'w-5 h-5 rounded border-2 flex items-center justify-center mx-auto cursor-pointer shadow-sm transition-all',
                    isToggling
                        ? 'bg-green-100 border-green-300'
                        : 'border-green-400 bg-white hover:bg-green-100 hover:border-green-500'
                )}
                title={isToggling ? 'Shipping...' : existingAwb ? `Ship with AWB: ${existingAwb}` : 'Click to ship (will prompt for AWB)'}
            >
                {isToggling ? <CheckboxSpinner color="green" /> : null}
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
