/**
 * Component Row
 *
 * Reusable component for displaying/editing a single BOM line.
 * Used in both Template and Variations tabs.
 *
 * Shows:
 * - Role name and type badge
 * - Component selector (typeahead)
 * - Quantity input with unit
 * - Cost calculation
 * - Inheritance indicator
 */

import { useState } from 'react';
import { Trash2, Plus, ArrowUp, ChevronDown, ChevronRight } from 'lucide-react';
import ComponentSelector from './ComponentSelector';

interface ComponentRole {
    id: string;
    code: string;
    name: string;
    typeCode: string;
    isRequired: boolean;
    allowMultiple: boolean;
    defaultQuantity?: number;
    defaultUnit?: string;
}

interface LineData {
    id?: string;
    roleId: string;
    trimItemId?: string;
    trimItemName?: string;
    serviceItemId?: string;
    serviceItemName?: string;
    defaultQuantity: number;
    quantityUnit: string;
    wastagePercent: number;
    notes?: string;
    resolvedCost?: number;
    isInherited?: boolean;
}

interface AvailableItem {
    id: string;
    code?: string;
    name: string;
    category?: string;
    costPerUnit?: number;
    costPerJob?: number;
    unit?: string;
}

interface ComponentRowProps {
    role: ComponentRole;
    line: LineData | null;
    availableItems: AvailableItem[];
    onUpdate: (updates: Partial<LineData>) => void;
    onAdd: () => void;
    onRemove: () => void;
}

export default function ComponentRow({
    role,
    line,
    availableItems,
    onUpdate,
    onAdd,
    onRemove,
}: ComponentRowProps) {
    const [isExpanded, setIsExpanded] = useState(!!line);

    const isTrim = role.typeCode === 'TRIM';
    const isService = role.typeCode === 'SERVICE';

    // Get the selected item
    const selectedItem = line
        ? availableItems.find(item =>
            (isTrim && item.id === line.trimItemId) ||
            (isService && item.id === line.serviceItemId)
        )
        : null;

    // Calculate line cost
    const lineCost = selectedItem
        ? ((isTrim ? selectedItem.costPerUnit : selectedItem.costPerJob) || 0) * (line?.defaultQuantity || 1)
        : 0;

    // If no line exists, show "Add" state
    if (!line) {
        return (
            <div className="flex items-center justify-between p-3 bg-gray-50 rounded-lg border-dashed border-2 border-gray-200">
                <div>
                    <p className="font-medium text-sm text-gray-500">{role.name}</p>
                    <p className="text-xs text-gray-400">
                        {role.isRequired ? 'Required' : 'Optional'} - not configured
                    </p>
                </div>
                <button
                    onClick={onAdd}
                    className="flex items-center gap-1 px-3 py-1.5 text-sm text-primary-600 hover:bg-primary-50 rounded-lg"
                >
                    <Plus size={14} />
                    Add
                </button>
            </div>
        );
    }

    return (
        <div className="bg-white border rounded-lg overflow-hidden">
            {/* Header */}
            <div
                className="flex items-center justify-between p-3 cursor-pointer hover:bg-gray-50"
                onClick={() => setIsExpanded(!isExpanded)}
            >
                <div className="flex items-center gap-3">
                    {isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                    <div>
                        <div className="flex items-center gap-2">
                            <span className="font-medium text-sm">{role.name}</span>
                            <span className={`text-xs px-1.5 py-0.5 rounded ${
                                isTrim ? 'bg-gray-100 text-gray-600' : 'bg-purple-100 text-purple-600'
                            }`}>
                                {role.typeCode.toLowerCase()}
                            </span>
                        </div>
                        <p className="text-xs text-gray-500">
                            {selectedItem?.name || 'No component selected'}
                            {selectedItem && ` × ${line.defaultQuantity}`}
                        </p>
                    </div>
                </div>

                <div className="flex items-center gap-3">
                    {lineCost > 0 && (
                        <span className="text-sm font-medium text-gray-700">
                            ₹{lineCost.toFixed(2)}
                        </span>
                    )}
                    <button
                        onClick={(e) => { e.stopPropagation(); onRemove(); }}
                        className="p-1 text-gray-400 hover:text-red-500 rounded"
                        title="Remove"
                    >
                        <Trash2 size={14} />
                    </button>
                </div>
            </div>

            {/* Expanded Content */}
            {isExpanded && (
                <div className="p-3 border-t bg-gray-50 space-y-3">
                    {/* Component Selector */}
                    <div>
                        <label className="text-xs text-gray-500 mb-1 block">Component</label>
                        <ComponentSelector
                            type={isTrim ? 'trim' : 'service'}
                            value={isTrim ? line.trimItemId || null : line.serviceItemId || null}
                            items={availableItems}
                            onChange={(id, item) => {
                                const namedItem = item as { name?: string } | null;
                                if (isTrim) {
                                    onUpdate({
                                        trimItemId: id || undefined,
                                        trimItemName: namedItem?.name,
                                    });
                                } else {
                                    onUpdate({
                                        serviceItemId: id || undefined,
                                        serviceItemName: namedItem?.name,
                                    });
                                }
                            }}
                            placeholder={`Select ${isTrim ? 'trim' : 'service'}...`}
                        />
                    </div>

                    {/* Quantity & Wastage */}
                    <div className="grid grid-cols-3 gap-3">
                        <div>
                            <label className="text-xs text-gray-500 mb-1 block">Quantity</label>
                            <input
                                type="number"
                                step="0.1"
                                min="0"
                                className="w-full text-sm border rounded px-2 py-1.5"
                                value={line.defaultQuantity}
                                onChange={(e) => onUpdate({
                                    defaultQuantity: parseFloat(e.target.value) || 0
                                })}
                            />
                        </div>
                        <div>
                            <label className="text-xs text-gray-500 mb-1 block">Unit</label>
                            <select
                                className="w-full text-sm border rounded px-2 py-1.5"
                                value={line.quantityUnit}
                                onChange={(e) => onUpdate({ quantityUnit: e.target.value })}
                            >
                                <option value="piece">Piece</option>
                                <option value="meter">Meter</option>
                                <option value="spool">Spool</option>
                                <option value="job">Job</option>
                                <option value="set">Set</option>
                            </select>
                        </div>
                        <div>
                            <label className="text-xs text-gray-500 mb-1 block">Wastage %</label>
                            <input
                                type="number"
                                step="0.5"
                                min="0"
                                max="100"
                                className="w-full text-sm border rounded px-2 py-1.5"
                                value={line.wastagePercent}
                                onChange={(e) => onUpdate({
                                    wastagePercent: parseFloat(e.target.value) || 0
                                })}
                            />
                        </div>
                    </div>

                    {/* Notes */}
                    <div>
                        <label className="text-xs text-gray-500 mb-1 block">Notes (optional)</label>
                        <input
                            type="text"
                            className="w-full text-sm border rounded px-2 py-1.5"
                            value={line.notes || ''}
                            onChange={(e) => onUpdate({ notes: e.target.value })}
                            placeholder="Any special instructions..."
                        />
                    </div>

                    {/* Cost Breakdown */}
                    {selectedItem && (
                        <div className="p-2 bg-white rounded border text-xs">
                            <div className="flex justify-between">
                                <span className="text-gray-500">Unit cost:</span>
                                <span>₹{(isTrim ? selectedItem.costPerUnit : selectedItem.costPerJob) || 0}</span>
                            </div>
                            <div className="flex justify-between">
                                <span className="text-gray-500">Quantity:</span>
                                <span>×{line.defaultQuantity}</span>
                            </div>
                            {line.wastagePercent > 0 && (
                                <div className="flex justify-between">
                                    <span className="text-gray-500">Wastage:</span>
                                    <span>+{line.wastagePercent}%</span>
                                </div>
                            )}
                            <div className="flex justify-between font-medium pt-1 border-t mt-1">
                                <span>Line total:</span>
                                <span>₹{(lineCost * (1 + (line.wastagePercent / 100))).toFixed(2)}</span>
                            </div>
                        </div>
                    )}

                    {/* Inheritance indicator */}
                    {line.isInherited && (
                        <div className="flex items-center gap-1 text-xs text-gray-400">
                            <ArrowUp size={10} />
                            Inherited from product template
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}
