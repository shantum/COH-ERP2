/**
 * ActionsMenu - Dropdown menu for row actions
 *
 * Replaces inline action buttons with a clean dropdown menu.
 * Actions vary by node type:
 * - Material: Edit, Add Fabric, Deactivate
 * - Fabric: Edit, Add Colour, Deactivate
 * - Colour: Edit, Add Inward, View History, Deactivate
 */

import { useState, useRef, useEffect } from 'react';
import {
    MoreHorizontal,
    Pencil,
    Plus,
    Package,
    Eye,
    Archive,
    Layers,
    Palette,
} from 'lucide-react';
import type { MaterialNode } from '../types';

interface ActionsMenuProps {
    node: MaterialNode;
    onEdit: (node: MaterialNode) => void;
    onAddChild?: (node: MaterialNode) => void;
    onViewDetails?: (node: MaterialNode) => void;
    onAddInward?: (node: MaterialNode) => void;
    onDeactivate?: (node: MaterialNode) => void;
}

interface MenuItem {
    id: string;
    label: string;
    icon: React.ReactNode;
    onClick: () => void;
    variant?: 'default' | 'danger';
    show: boolean;
}

export function ActionsMenu({
    node,
    onEdit,
    onAddChild,
    onViewDetails,
    onAddInward,
    onDeactivate,
}: ActionsMenuProps) {
    const [isOpen, setIsOpen] = useState(false);
    const menuRef = useRef<HTMLDivElement>(null);
    const buttonRef = useRef<HTMLButtonElement>(null);

    // Close menu when clicking outside
    useEffect(() => {
        function handleClickOutside(event: MouseEvent) {
            if (
                menuRef.current &&
                !menuRef.current.contains(event.target as Node) &&
                buttonRef.current &&
                !buttonRef.current.contains(event.target as Node)
            ) {
                setIsOpen(false);
            }
        }

        if (isOpen) {
            document.addEventListener('mousedown', handleClickOutside);
            return () => document.removeEventListener('mousedown', handleClickOutside);
        }
    }, [isOpen]);

    // Close menu on escape key
    useEffect(() => {
        function handleEscape(event: KeyboardEvent) {
            if (event.key === 'Escape') {
                setIsOpen(false);
            }
        }

        if (isOpen) {
            document.addEventListener('keydown', handleEscape);
            return () => document.removeEventListener('keydown', handleEscape);
        }
    }, [isOpen]);

    // Build menu items based on node type
    const menuItems: MenuItem[] = [
        {
            id: 'edit',
            label: `Edit ${node.type}`,
            icon: <Pencil size={14} />,
            onClick: () => {
                onEdit(node);
                setIsOpen(false);
            },
            show: true,
        },
        {
            id: 'add-fabric',
            label: 'Add Fabric',
            icon: <Layers size={14} />,
            onClick: () => {
                onAddChild?.(node);
                setIsOpen(false);
            },
            show: node.type === 'material' && !!onAddChild,
        },
        {
            id: 'add-colour',
            label: 'Add Colour',
            icon: <Palette size={14} />,
            onClick: () => {
                onAddChild?.(node);
                setIsOpen(false);
            },
            show: node.type === 'fabric' && !!onAddChild,
        },
        {
            id: 'add-inward',
            label: 'Add Inward',
            icon: <Package size={14} />,
            onClick: () => {
                onAddInward?.(node);
                setIsOpen(false);
            },
            show: node.type === 'colour' && !!onAddInward,
        },
        {
            id: 'view-details',
            label: 'View Details',
            icon: <Eye size={14} />,
            onClick: () => {
                onViewDetails?.(node);
                setIsOpen(false);
            },
            show: !!onViewDetails,
        },
        {
            id: 'deactivate',
            label: node.isActive === false ? 'Activate' : 'Deactivate',
            icon: <Archive size={14} />,
            onClick: () => {
                onDeactivate?.(node);
                setIsOpen(false);
            },
            variant: 'danger',
            show: !!onDeactivate,
        },
    ];

    const visibleItems = menuItems.filter(item => item.show);

    return (
        <div className="relative inline-block text-left">
            <button
                ref={buttonRef}
                type="button"
                onClick={(e) => {
                    e.stopPropagation();
                    setIsOpen(!isOpen);
                }}
                className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-500 hover:text-gray-700 transition-colors"
                title="Actions"
            >
                <MoreHorizontal size={16} />
            </button>

            {/* Dropdown Menu */}
            {isOpen && (
                <div
                    ref={menuRef}
                    className="absolute right-0 z-50 mt-1 w-44 origin-top-right bg-white rounded-lg shadow-lg ring-1 ring-black ring-opacity-5 focus:outline-none py-1"
                    role="menu"
                    aria-orientation="vertical"
                >
                    {visibleItems.map((item, index) => (
                        <div key={item.id}>
                            {/* Add separator before danger items */}
                            {item.variant === 'danger' && index > 0 && (
                                <div className="border-t border-gray-100 my-1" />
                            )}
                            <button
                                type="button"
                                onClick={item.onClick}
                                className={`w-full flex items-center gap-2 px-3 py-2 text-sm transition-colors ${
                                    item.variant === 'danger'
                                        ? 'text-red-600 hover:bg-red-50'
                                        : 'text-gray-700 hover:bg-gray-100'
                                }`}
                                role="menuitem"
                            >
                                <span className={item.variant === 'danger' ? 'text-red-500' : 'text-gray-400'}>
                                    {item.icon}
                                </span>
                                {item.label}
                            </button>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}
