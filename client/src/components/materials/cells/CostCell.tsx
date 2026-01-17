/**
 * CostCell - Editable cost field with inheritance indicator
 *
 * Shows effective cost (own or inherited from fabric).
 * Click to edit. Shows ↑ indicator for inherited values.
 */

import { useState, useRef, useEffect } from 'react';
import type { MaterialNode } from '../types';

interface CostCellProps {
    node: MaterialNode;
    onSave: (value: number | null) => void;
    disabled?: boolean;
}

export function CostCell({ node, onSave, disabled }: CostCellProps) {
    const [isEditing, setIsEditing] = useState(false);
    const [editValue, setEditValue] = useState('');
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
        setIsEditing(true);
    };

    const handleSave = () => {
        setIsEditing(false);
        const trimmed = editValue.trim();
        if (trimmed === '' || trimmed === (effectiveCost?.toString() || '')) {
            return; // No change
        }
        const numValue = parseFloat(trimmed);
        if (!isNaN(numValue) && numValue >= 0) {
            onSave(numValue);
        }
    };

    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === 'Enter') {
            handleSave();
        } else if (e.key === 'Escape') {
            setIsEditing(false);
            setEditValue('');
        }
    };

    if (isEditing) {
        return (
            <input
                ref={inputRef}
                type="number"
                min="0"
                step="0.01"
                className="w-full px-1 py-0.5 text-sm border rounded bg-white text-right focus:outline-none focus:ring-1 focus:ring-blue-500"
                value={editValue}
                onChange={(e) => setEditValue(e.target.value)}
                onBlur={handleSave}
                onKeyDown={handleKeyDown}
            />
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

/**
 * LeadTimeCell - Similar to CostCell but for lead time
 */
interface LeadTimeCellProps {
    node: MaterialNode;
    onSave: (value: number | null) => void;
    disabled?: boolean;
}

export function LeadTimeCell({ node, onSave, disabled }: LeadTimeCellProps) {
    const [isEditing, setIsEditing] = useState(false);
    const [editValue, setEditValue] = useState('');
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
        setIsEditing(true);
    };

    const handleSave = () => {
        setIsEditing(false);
        const trimmed = editValue.trim();
        if (trimmed === '' || trimmed === (effectiveValue?.toString() || '')) {
            return;
        }
        const numValue = parseInt(trimmed);
        if (!isNaN(numValue) && numValue >= 0) {
            onSave(numValue);
        }
    };

    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === 'Enter') {
            handleSave();
        } else if (e.key === 'Escape') {
            setIsEditing(false);
            setEditValue('');
        }
    };

    if (isEditing) {
        return (
            <input
                ref={inputRef}
                type="number"
                min="0"
                step="1"
                className="w-full px-1 py-0.5 text-sm border rounded bg-white text-right focus:outline-none focus:ring-1 focus:ring-blue-500"
                value={editValue}
                onChange={(e) => setEditValue(e.target.value)}
                onBlur={handleSave}
                onKeyDown={handleKeyDown}
            />
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

/**
 * MinOrderCell - Similar to CostCell but for minimum order quantity
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
        setIsEditing(true);
    };

    const handleSave = () => {
        setIsEditing(false);
        const trimmed = editValue.trim();
        if (trimmed === '' || trimmed === (effectiveValue?.toString() || '')) {
            return;
        }
        const numValue = parseFloat(trimmed);
        if (!isNaN(numValue) && numValue >= 0) {
            onSave(numValue);
        }
    };

    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === 'Enter') {
            handleSave();
        } else if (e.key === 'Escape') {
            setIsEditing(false);
            setEditValue('');
        }
    };

    if (isEditing) {
        return (
            <input
                ref={inputRef}
                type="number"
                min="0"
                step="0.1"
                className="w-full px-1 py-0.5 text-sm border rounded bg-white text-right focus:outline-none focus:ring-1 focus:ring-blue-500"
                value={editValue}
                onChange={(e) => setEditValue(e.target.value)}
                onBlur={handleSave}
                onKeyDown={handleKeyDown}
            />
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
