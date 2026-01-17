/**
 * ActionsMenu - Dropdown menu for row actions
 */

import { useState, useRef, useEffect } from 'react';
import { MoreHorizontal, Edit, Plus, Eye, Package } from 'lucide-react';
import type { ProductTreeNode } from '../types';

interface ActionsMenuProps {
    node: ProductTreeNode;
    onEdit?: (node: ProductTreeNode) => void;
    onAddChild?: (node: ProductTreeNode) => void;
    onViewDetails?: (node: ProductTreeNode) => void;
}

export function ActionsMenu({ node, onEdit, onAddChild, onViewDetails }: ActionsMenuProps) {
    const [isOpen, setIsOpen] = useState(false);
    const menuRef = useRef<HTMLDivElement>(null);

    // Close menu on outside click
    useEffect(() => {
        function handleClickOutside(event: MouseEvent) {
            if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
                setIsOpen(false);
            }
        }

        if (isOpen) {
            document.addEventListener('mousedown', handleClickOutside);
            return () => document.removeEventListener('mousedown', handleClickOutside);
        }
    }, [isOpen]);

    // Get actions based on node type
    const actions: { icon: typeof Edit; label: string; onClick: () => void }[] = [];

    if (onViewDetails) {
        actions.push({
            icon: Eye,
            label: 'View Details',
            onClick: () => {
                onViewDetails(node);
                setIsOpen(false);
            },
        });
    }

    if (onEdit) {
        actions.push({
            icon: Edit,
            label: 'Edit',
            onClick: () => {
                onEdit(node);
                setIsOpen(false);
            },
        });
    }

    if (onAddChild && node.type !== 'sku') {
        const childLabel = node.type === 'product' ? 'Add Variation' : 'Add SKU';
        actions.push({
            icon: Plus,
            label: childLabel,
            onClick: () => {
                onAddChild(node);
                setIsOpen(false);
            },
        });
    }

    if (node.type === 'sku') {
        actions.push({
            icon: Package,
            label: 'View Inventory',
            onClick: () => {
                onViewDetails?.(node);
                setIsOpen(false);
            },
        });
    }

    if (actions.length === 0) return null;

    return (
        <div className="relative" ref={menuRef}>
            <button
                type="button"
                onClick={(e) => {
                    e.stopPropagation();
                    setIsOpen(!isOpen);
                }}
                className="p-1 rounded hover:bg-gray-200 text-gray-400 hover:text-gray-600 transition-colors"
            >
                <MoreHorizontal size={16} />
            </button>

            {isOpen && (
                <div className="absolute right-0 top-full mt-1 z-20 bg-white rounded-lg shadow-lg border border-gray-200 py-1 min-w-[140px]">
                    {actions.map((action, idx) => (
                        <button
                            key={idx}
                            type="button"
                            onClick={(e) => {
                                e.stopPropagation();
                                action.onClick();
                            }}
                            className="w-full px-3 py-1.5 text-left text-sm text-gray-700 hover:bg-gray-50 flex items-center gap-2"
                        >
                            <action.icon size={14} className="text-gray-400" />
                            {action.label}
                        </button>
                    ))}
                </div>
            )}
        </div>
    );
}
