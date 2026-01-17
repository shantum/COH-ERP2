/**
 * SizeConsumptionModal - Edit consumption by size
 *
 * Shows a simple table of Size | Consumption for a specific BOM role.
 * Updates apply to ALL SKUs of that size across ALL colors.
 */

import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Loader2, Save } from 'lucide-react';
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogFooter,
    DialogDescription,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { bomApi } from '@/services/api';
import { TypeBadge } from './cells';
import type { BomComponentType } from './types';

interface SizeConsumptionModalProps {
    isOpen: boolean;
    onClose: () => void;
    productId: string;
    productName: string;
    roleId: string;
    roleName: string;
    roleType: BomComponentType;
}

interface SizeData {
    size: string;
    quantity: number | null;
    skuCount: number;
}

export function SizeConsumptionModal({
    isOpen,
    onClose,
    productId,
    productName,
    roleId,
    roleName,
    roleType,
}: SizeConsumptionModalProps) {
    const queryClient = useQueryClient();
    const [localValues, setLocalValues] = useState<Record<string, string>>({});
    const [hasChanges, setHasChanges] = useState(false);

    // Fetch size consumptions
    const { data, isLoading, error } = useQuery({
        queryKey: ['sizeConsumptions', productId, roleId],
        queryFn: () => bomApi.getSizeConsumptions(productId, roleId).then((r) => r.data),
        enabled: isOpen && !!productId && !!roleId,
    });

    // Initialize local values when data loads
    useEffect(() => {
        if (data?.sizes) {
            const initial: Record<string, string> = {};
            for (const s of data.sizes as SizeData[]) {
                initial[s.size] = s.quantity !== null ? String(s.quantity) : '';
            }
            setLocalValues(initial);
            setHasChanges(false);
        }
    }, [data]);

    // Update mutation
    const updateMutation = useMutation({
        mutationFn: async () => {
            const consumptions = Object.entries(localValues)
                .filter(([_, value]) => value !== '')
                .map(([size, value]) => ({
                    size,
                    quantity: parseFloat(value),
                }));
            return bomApi.updateSizeConsumptions(productId, roleId, consumptions);
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['sizeConsumptions', productId, roleId] });
            queryClient.invalidateQueries({ queryKey: ['productBom', productId] });
            onClose();
        },
    });

    // Handle input change
    const handleChange = (size: string, value: string) => {
        // Allow empty, numbers, and decimals
        if (value === '' || /^\d*\.?\d*$/.test(value)) {
            setLocalValues((prev) => ({ ...prev, [size]: value }));
            setHasChanges(true);
        }
    };

    // Handle save
    const handleSave = () => {
        updateMutation.mutate();
    };

    const sizes = (data?.sizes || []) as SizeData[];
    const unit = data?.unit || 'meter';

    return (
        <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
            <DialogContent className="sm:max-w-md">
                <DialogHeader>
                    <div className="flex items-center gap-2">
                        <TypeBadge type={roleType} size="md" />
                        <DialogTitle>{roleName} Consumption</DialogTitle>
                    </div>
                    <DialogDescription>
                        {productName} · Updates apply to all colors
                    </DialogDescription>
                </DialogHeader>

                {isLoading ? (
                    <div className="flex items-center justify-center py-8">
                        <Loader2 size={24} className="animate-spin text-gray-400" />
                        <span className="ml-2 text-gray-500">Loading sizes...</span>
                    </div>
                ) : error ? (
                    <div className="py-4 text-center text-red-600">
                        Failed to load consumption data
                    </div>
                ) : sizes.length === 0 ? (
                    <div className="py-8 text-center text-gray-500">
                        No SKUs found for this product
                    </div>
                ) : (
                    <div className="py-2">
                        {/* Header */}
                        <div className="grid grid-cols-3 gap-2 px-2 py-1 text-xs font-medium text-gray-500 uppercase border-b">
                            <div>Size</div>
                            <div>Consumption ({unit})</div>
                            <div className="text-right">SKUs</div>
                        </div>

                        {/* Rows */}
                        <div className="divide-y max-h-64 overflow-auto">
                            {sizes.map((s) => (
                                <div
                                    key={s.size}
                                    className="grid grid-cols-3 gap-2 items-center px-2 py-1.5"
                                >
                                    <div className="font-medium text-gray-900">{s.size}</div>
                                    <div>
                                        <Input
                                            type="text"
                                            inputMode="decimal"
                                            value={localValues[s.size] ?? ''}
                                            onChange={(e) => handleChange(s.size, e.target.value)}
                                            placeholder={String(data?.defaultQuantity ?? '1.5')}
                                            className="h-8 text-sm tabular-nums"
                                        />
                                    </div>
                                    <div className="text-right text-xs text-gray-500">
                                        {s.skuCount}
                                    </div>
                                </div>
                            ))}
                        </div>

                        {/* Summary */}
                        <div className="mt-3 px-2 py-2 bg-blue-50 rounded-md text-xs text-blue-700">
                            Saving will update <strong>{data?.totalSkus}</strong> SKUs across{' '}
                            <strong>{data?.totalVariations}</strong> colors
                        </div>
                    </div>
                )}

                <DialogFooter>
                    <Button variant="outline" onClick={onClose} disabled={updateMutation.isPending}>
                        Cancel
                    </Button>
                    <Button
                        onClick={handleSave}
                        disabled={!hasChanges || updateMutation.isPending || isLoading}
                    >
                        {updateMutation.isPending ? (
                            <Loader2 size={14} className="animate-spin mr-1" />
                        ) : (
                            <Save size={14} className="mr-1" />
                        )}
                        Save to All
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
