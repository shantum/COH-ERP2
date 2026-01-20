/**
 * CostCell, LeadTimeCell, MinOrderCell - Editable material property cells
 *
 * Features:
 * - Inline editing with click-to-edit pattern
 * - Shows inheritance indicator (↑) for values inherited from parent fabric
 * - Zod validation before save (same schemas used consistently across app)
 *
 * IMPORTANT: Uses same Zod schema pattern as Orders cells for consistent validation.
 * Backend remains agnostic to save method (inline edit vs form).
 */

import { useState, useRef, useEffect } from 'react';
import { AlertCircle } from 'lucide-react';
import type { MaterialNode } from '../types';
import {
    UpdateMaterialCostSchema,
    UpdateMaterialLeadTimeSchema,
    UpdateMaterialMinOrderSchema,
} from '@coh/shared';

// ============================================
// COST CELL
// ============================================

interface CostCellProps {
    node: MaterialNode;
    onSave: (value: number | null) => void;
    disabled?: boolean;
}

export function CostCell({ node, onSave, disabled }: CostCellProps) {
    const [isEditing, setIsEditing] = useState(false);
    const [editValue, setEditValue] = useState('');
    const [validationError, setValidationError] = useState<string | null>(null);
    const inputRef = useRef<HTMLInputElement>(null);

    const effectiveCost = node.effectiveCostPerUnit ?? node.costPerUnit ?? node.inheritedCostPerUnit;
    const isInherited = node.costInherited;

    useEffect(() => {
        if (isEditing && inputRef.current) {
            inputRef.current.focus();
            inputRef.current.select();
        }
    }, [isEditing]);

    const handleStartEdit = () => {
        if (disabled) return;
        setEditValue(effectiveCost?.toString() || '');
        setValidationError(null);
        setIsEditing(true);
    };

    const handleSave = () => {
        const trimmed = editValue.trim();

        // No change - just close
        if (trimmed === '' || trimmed === (effectiveCost?.toString() || '')) {
            setIsEditing(false);
            setValidationError(null);
            return;
        }

        const numValue = parseFloat(trimmed);
        if (isNaN(numValue)) {
            setValidationError('Please enter a valid number');
            return;
        }

        // Validate using Zod schema - ensures consistency with backend expectations
        // Materials can be fabric or colour - use discriminated union
        const nodeType = node.type as 'fabric' | 'colour';
        if (nodeType !== 'fabric' && nodeType !== 'colour') {
            setValidationError('Cannot edit cost for this item type');
            return;
        }

        const payload = {
            nodeType,
            id: node.id,
            costPerUnit: numValue,
        };

        const validation = UpdateMaterialCostSchema.safeParse(payload);
        if (!validation.success) {
            setValidationError(validation.error.issues[0]?.message || 'Validation failed');
            return;
        }

        // Validation passed - save and close
        setValidationError(null);
        setIsEditing(false);
        onSave(numValue);
    };

    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === 'Enter') {
            handleSave();
        } else if (e.key === 'Escape') {
            setIsEditing(false);
            setEditValue('');
            setValidationError(null);
        }
    };

    if (isEditing) {
        return (
            <div className="relative">
                <input
                    ref={inputRef}
                    type="number"
                    min="0"
                    step="0.01"
                    className={`w-full px-1 py-0.5 text-sm border rounded bg-white text-right focus:outline-none focus:ring-1 ${
                        validationError
                            ? 'border-red-300 focus:ring-red-400'
                            : 'border-blue-300 focus:ring-blue-500'
                    }`}
                    value={editValue}
                    onChange={(e) => {
                        setEditValue(e.target.value);
                        setValidationError(null);
                    }}
                    onBlur={handleSave}
                    onKeyDown={handleKeyDown}
                />
                {validationError && (
                    <div className="absolute top-full left-0 mt-0.5 flex items-center gap-1 text-[10px] text-red-500 bg-white px-1 rounded shadow-sm border border-red-100 z-10 whitespace-nowrap">
                        <AlertCircle size={10} />
                        <span>{validationError}</span>
                    </div>
                )}
            </div>
        );
    }

    if (effectiveCost == null) {
        return <span className="text-xs text-gray-400">-</span>;
    }

    return (
        <div
            className={`flex items-center justify-end gap-1 ${
                disabled ? '' : 'cursor-pointer hover:bg-blue-50 px-1 -mx-1 rounded'
            }`}
            onClick={handleStartEdit}
            title={disabled ? undefined : 'Click to edit'}
        >
            <span className="text-right">₹{effectiveCost}</span>
            {isInherited && (
                <span
                    className="text-gray-400 text-[10px]"
                    title="Inherited from fabric"
                >
                    ↑
                </span>
            )}
        </div>
    );
}

// ============================================
// LEAD TIME CELL
// ============================================

interface LeadTimeCellProps {
    node: MaterialNode;
    onSave: (value: number | null) => void;
    disabled?: boolean;
}

export function LeadTimeCell({ node, onSave, disabled }: LeadTimeCellProps) {
    const [isEditing, setIsEditing] = useState(false);
    const [editValue, setEditValue] = useState('');
    const [validationError, setValidationError] = useState<string | null>(null);
    const inputRef = useRef<HTMLInputElement>(null);

    const effectiveValue = node.effectiveLeadTimeDays ?? node.leadTimeDays ?? node.inheritedLeadTimeDays;
    const isInherited = node.leadTimeInherited;

    useEffect(() => {
        if (isEditing && inputRef.current) {
            inputRef.current.focus();
            inputRef.current.select();
        }
    }, [isEditing]);

    const handleStartEdit = () => {
        if (disabled) return;
        setEditValue(effectiveValue?.toString() || '');
        setValidationError(null);
        setIsEditing(true);
    };

    const handleSave = () => {
        const trimmed = editValue.trim();

        // No change - just close
        if (trimmed === '' || trimmed === (effectiveValue?.toString() || '')) {
            setIsEditing(false);
            setValidationError(null);
            return;
        }

        const numValue = parseInt(trimmed);
        if (isNaN(numValue)) {
            setValidationError('Please enter a valid number');
            return;
        }

        // Validate using Zod schema
        const nodeType = node.type as 'fabric' | 'colour';
        if (nodeType !== 'fabric' && nodeType !== 'colour') {
            setValidationError('Cannot edit lead time for this item type');
            return;
        }

        const payload = {
            nodeType,
            id: node.id,
            leadTimeDays: numValue,
        };

        const validation = UpdateMaterialLeadTimeSchema.safeParse(payload);
        if (!validation.success) {
            setValidationError(validation.error.issues[0]?.message || 'Validation failed');
            return;
        }

        // Validation passed - save and close
        setValidationError(null);
        setIsEditing(false);
        onSave(numValue);
    };

    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === 'Enter') {
            handleSave();
        } else if (e.key === 'Escape') {
            setIsEditing(false);
            setEditValue('');
            setValidationError(null);
        }
    };

    if (isEditing) {
        return (
            <div className="relative">
                <input
                    ref={inputRef}
                    type="number"
                    min="0"
                    step="1"
                    className={`w-full px-1 py-0.5 text-sm border rounded bg-white text-right focus:outline-none focus:ring-1 ${
                        validationError
                            ? 'border-red-300 focus:ring-red-400'
                            : 'border-blue-300 focus:ring-blue-500'
                    }`}
                    value={editValue}
                    onChange={(e) => {
                        setEditValue(e.target.value);
                        setValidationError(null);
                    }}
                    onBlur={handleSave}
                    onKeyDown={handleKeyDown}
                />
                {validationError && (
                    <div className="absolute top-full left-0 mt-0.5 flex items-center gap-1 text-[10px] text-red-500 bg-white px-1 rounded shadow-sm border border-red-100 z-10 whitespace-nowrap">
                        <AlertCircle size={10} />
                        <span>{validationError}</span>
                    </div>
                )}
            </div>
        );
    }

    if (effectiveValue == null) {
        return <span className="text-xs text-gray-400">-</span>;
    }

    return (
        <div
            className={`flex items-center justify-end gap-1 text-xs ${
                disabled ? '' : 'cursor-pointer hover:bg-blue-50 px-1 -mx-1 rounded'
            }`}
            onClick={handleStartEdit}
            title={disabled ? undefined : 'Click to edit'}
        >
            <span>{effectiveValue}d</span>
            {isInherited && (
                <span className="text-gray-400 text-[10px]" title="Inherited from fabric">↑</span>
            )}
        </div>
    );
}

// ============================================
// MIN ORDER CELL
// ============================================

/**
 * MinOrderCell - Editable minimum order quantity cell
 *
 * Shows correct unit based on construction type:
 * - Knit fabrics: kg
 * - Woven fabrics: m
 */
interface MinOrderCellProps {
    node: MaterialNode;
    onSave: (value: number | null) => void;
    disabled?: boolean;
}

export function MinOrderCell({ node, onSave, disabled }: MinOrderCellProps) {
    const [isEditing, setIsEditing] = useState(false);
    const [editValue, setEditValue] = useState('');
    const [validationError, setValidationError] = useState<string | null>(null);
    const inputRef = useRef<HTMLInputElement>(null);

    const effectiveValue = node.effectiveMinOrderQty ?? node.minOrderQty ?? node.inheritedMinOrderQty;
    const isInherited = node.minOrderInherited;

    // Get unit from node, or derive from construction type (knit=kg, woven=m)
    const unit = node.unit || (node.constructionType === 'knit' ? 'kg' : 'm');

    useEffect(() => {
        if (isEditing && inputRef.current) {
            inputRef.current.focus();
            inputRef.current.select();
        }
    }, [isEditing]);

    const handleStartEdit = () => {
        if (disabled) return;
        setEditValue(effectiveValue?.toString() || '');
        setValidationError(null);
        setIsEditing(true);
    };

    const handleSave = () => {
        const trimmed = editValue.trim();

        // No change - just close
        if (trimmed === '' || trimmed === (effectiveValue?.toString() || '')) {
            setIsEditing(false);
            setValidationError(null);
            return;
        }

        const numValue = parseFloat(trimmed);
        if (isNaN(numValue)) {
            setValidationError('Please enter a valid number');
            return;
        }

        // Validate using Zod schema
        const nodeType = node.type as 'fabric' | 'colour';
        if (nodeType !== 'fabric' && nodeType !== 'colour') {
            setValidationError('Cannot edit min order for this item type');
            return;
        }

        const payload = {
            nodeType,
            id: node.id,
            minOrderQty: numValue,
        };

        const validation = UpdateMaterialMinOrderSchema.safeParse(payload);
        if (!validation.success) {
            setValidationError(validation.error.issues[0]?.message || 'Validation failed');
            return;
        }

        // Validation passed - save and close
        setValidationError(null);
        setIsEditing(false);
        onSave(numValue);
    };

    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === 'Enter') {
            handleSave();
        } else if (e.key === 'Escape') {
            setIsEditing(false);
            setEditValue('');
            setValidationError(null);
        }
    };

    if (isEditing) {
        return (
            <div className="relative">
                <input
                    ref={inputRef}
                    type="number"
                    min="0"
                    step="0.1"
                    className={`w-full px-1 py-0.5 text-sm border rounded bg-white text-right focus:outline-none focus:ring-1 ${
                        validationError
                            ? 'border-red-300 focus:ring-red-400'
                            : 'border-blue-300 focus:ring-blue-500'
                    }`}
                    value={editValue}
                    onChange={(e) => {
                        setEditValue(e.target.value);
                        setValidationError(null);
                    }}
                    onBlur={handleSave}
                    onKeyDown={handleKeyDown}
                />
                {validationError && (
                    <div className="absolute top-full left-0 mt-0.5 flex items-center gap-1 text-[10px] text-red-500 bg-white px-1 rounded shadow-sm border border-red-100 z-10 whitespace-nowrap">
                        <AlertCircle size={10} />
                        <span>{validationError}</span>
                    </div>
                )}
            </div>
        );
    }

    if (effectiveValue == null) {
        return <span className="text-xs text-gray-400">-</span>;
    }

    return (
        <div
            className={`flex items-center justify-end gap-1 text-xs ${
                disabled ? '' : 'cursor-pointer hover:bg-blue-50 px-1 -mx-1 rounded'
            }`}
            onClick={handleStartEdit}
            title={disabled ? undefined : 'Click to edit'}
        >
            <span>{effectiveValue} {unit}</span>
            {isInherited && (
                <span className="text-gray-400 text-[10px]" title="Inherited from fabric">↑</span>
            )}
        </div>
    );
}
