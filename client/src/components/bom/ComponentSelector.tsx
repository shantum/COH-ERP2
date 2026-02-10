/**
 * Component Selector
 *
 * Typeahead dropdown for selecting BOM components:
 * - Fabric colours (with color swatch)
 * - Trim items (with code and category)
 * - Service items (with code and category)
 *
 * Features:
 * - Fuzzy search by name/code
 * - Category grouping
 * - Cost display
 * - Keyboard navigation
 */

import { useState, useRef, useEffect } from 'react';
import { Search, X, ChevronDown, Check } from 'lucide-react';

interface FabricColourItem {
    id: string;
    colourName: string;
    colourHex?: string;
    code?: string | null;
    fabricName: string;
    costPerUnit?: number;
}

interface TrimItem {
    id: string;
    code?: string;
    name: string;
    category?: string;
    costPerUnit?: number;
    unit?: string;
}

interface ServiceItem {
    id: string;
    code?: string;
    name: string;
    category?: string;
    costPerJob?: number;
}

type ItemType = FabricColourItem | TrimItem | ServiceItem;

interface ComponentSelectorProps {
    type: 'fabric' | 'trim' | 'service';
    value: string | null;
    items: ItemType[];
    onChange: (id: string | null, item: ItemType | null) => void;
    placeholder?: string;
    filterByCategory?: string;
}

export default function ComponentSelector({
    type,
    value,
    items,
    onChange,
    placeholder = 'Select component...',
    filterByCategory,
}: ComponentSelectorProps) {
    const [isOpen, setIsOpen] = useState(false);
    const [searchTerm, setSearchTerm] = useState('');
    const [highlightedIndex, setHighlightedIndex] = useState(0);
    const containerRef = useRef<HTMLDivElement>(null);
    const inputRef = useRef<HTMLInputElement>(null);

    // Filter items
    const filteredItems = items.filter(item => {
        // Category filter
        if (filterByCategory && 'category' in item && item.category !== filterByCategory) {
            return false;
        }

        // Search filter
        if (searchTerm) {
            const term = searchTerm.toLowerCase();
            const name = 'name' in item ? item.name : ('colourName' in item ? item.colourName : '');
            const code = 'code' in item ? (item.code ?? undefined) : undefined;
            const fabricName = 'fabricName' in item ? item.fabricName : undefined;

            return (
                name.toLowerCase().includes(term) ||
                (code && code.toLowerCase().includes(term)) ||
                (fabricName && fabricName.toLowerCase().includes(term))
            );
        }

        return true;
    });

    // Get selected item
    const selectedItem = value ? items.find(item => item.id === value) : null;

    // Close on outside click
    useEffect(() => {
        const handleClickOutside = (e: MouseEvent) => {
            if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
                setIsOpen(false);
            }
        };

        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, []);

    // Keyboard navigation
    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (!isOpen) {
            if (e.key === 'ArrowDown' || e.key === 'Enter') {
                setIsOpen(true);
            }
            return;
        }

        switch (e.key) {
            case 'ArrowDown':
                e.preventDefault();
                setHighlightedIndex(prev =>
                    prev < filteredItems.length - 1 ? prev + 1 : 0
                );
                break;
            case 'ArrowUp':
                e.preventDefault();
                setHighlightedIndex(prev =>
                    prev > 0 ? prev - 1 : filteredItems.length - 1
                );
                break;
            case 'Enter':
                e.preventDefault();
                if (filteredItems[highlightedIndex]) {
                    handleSelect(filteredItems[highlightedIndex]);
                }
                break;
            case 'Escape':
                setIsOpen(false);
                setSearchTerm('');
                break;
        }
    };

    // Handle selection
    const handleSelect = (item: ItemType) => {
        onChange(item.id, item);
        setIsOpen(false);
        setSearchTerm('');
    };

    // Clear selection
    const handleClear = () => {
        onChange(null, null);
    };

    // Render item based on type
    const renderItem = (item: ItemType, isHighlighted: boolean, isSelected: boolean) => {
        const baseClasses = `w-full flex items-center gap-2 px-3 py-2 text-left transition-colors ${
            isHighlighted ? 'bg-primary-50' : ''
        } ${isSelected ? 'bg-primary-100' : ''}`;

        if (type === 'fabric') {
            const fabItem = item as FabricColourItem;
            return (
                <button
                    className={baseClasses}
                    onClick={() => handleSelect(item)}
                    onMouseEnter={() => setHighlightedIndex(filteredItems.indexOf(item))}
                >
                    <div
                        className="w-5 h-5 rounded-full border flex-shrink-0"
                        style={{ backgroundColor: fabItem.colourHex || '#ccc' }}
                    />
                    <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1">
                            <p className="text-sm font-medium truncate">{fabItem.colourName}</p>
                            {fabItem.code && (
                                <span className="px-1 py-0.5 text-[10px] font-mono bg-gray-100 text-gray-500 rounded flex-shrink-0">
                                    {fabItem.code}
                                </span>
                            )}
                        </div>
                        <p className="text-xs text-gray-500 truncate">{fabItem.fabricName}</p>
                    </div>
                    {fabItem.costPerUnit != null && (
                        <span className="text-xs text-gray-500">₹{fabItem.costPerUnit}/m</span>
                    )}
                    {isSelected && <Check size={14} className="text-primary-600" />}
                </button>
            );
        }

        if (type === 'trim') {
            const trimItem = item as TrimItem;
            return (
                <button
                    className={baseClasses}
                    onClick={() => handleSelect(item)}
                    onMouseEnter={() => setHighlightedIndex(filteredItems.indexOf(item))}
                >
                    <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                            {trimItem.code && (
                                <span className="text-xs font-mono text-gray-400">{trimItem.code}</span>
                            )}
                            <span className="text-sm font-medium truncate">{trimItem.name}</span>
                        </div>
                        {trimItem.category && (
                            <span className="text-xs text-gray-500 capitalize">{trimItem.category}</span>
                        )}
                    </div>
                    {trimItem.costPerUnit != null && (
                        <span className="text-xs text-gray-500">₹{trimItem.costPerUnit}/{trimItem.unit || 'pc'}</span>
                    )}
                    {isSelected && <Check size={14} className="text-primary-600" />}
                </button>
            );
        }

        // Service
        const serviceItem = item as ServiceItem;
        return (
            <button
                className={baseClasses}
                onClick={() => handleSelect(item)}
                onMouseEnter={() => setHighlightedIndex(filteredItems.indexOf(item))}
            >
                <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                        {serviceItem.code && (
                            <span className="text-xs font-mono text-gray-400">{serviceItem.code}</span>
                        )}
                        <span className="text-sm font-medium truncate">{serviceItem.name}</span>
                    </div>
                    {serviceItem.category && (
                        <span className="text-xs text-gray-500 capitalize">{serviceItem.category}</span>
                    )}
                </div>
                {serviceItem.costPerJob != null && (
                    <span className="text-xs text-gray-500">₹{serviceItem.costPerJob}/job</span>
                )}
                {isSelected && <Check size={14} className="text-primary-600" />}
            </button>
        );
    };

    // Render selected value
    const renderSelectedValue = () => {
        if (!selectedItem) return null;

        if (type === 'fabric') {
            const fabItem = selectedItem as FabricColourItem;
            return (
                <div className="flex items-center gap-2 flex-1 min-w-0">
                    <div
                        className="w-4 h-4 rounded-full border flex-shrink-0"
                        style={{ backgroundColor: fabItem.colourHex || '#ccc' }}
                    />
                    <span className="text-sm truncate">{fabItem.colourName}</span>
                    {fabItem.code && (
                        <span className="px-1 py-0.5 text-[10px] font-mono bg-gray-100 text-gray-500 rounded flex-shrink-0">
                            {fabItem.code}
                        </span>
                    )}
                    <span className="text-xs text-gray-400 truncate">({fabItem.fabricName})</span>
                </div>
            );
        }

        if (type === 'trim') {
            const trimItem = selectedItem as TrimItem;
            return (
                <div className="flex items-center gap-2 flex-1 min-w-0">
                    {trimItem.code && (
                        <span className="text-xs font-mono text-gray-400">{trimItem.code}</span>
                    )}
                    <span className="text-sm truncate">{trimItem.name}</span>
                </div>
            );
        }

        const serviceItem = selectedItem as ServiceItem;
        return (
            <div className="flex items-center gap-2 flex-1 min-w-0">
                {serviceItem.code && (
                    <span className="text-xs font-mono text-gray-400">{serviceItem.code}</span>
                )}
                <span className="text-sm truncate">{serviceItem.name}</span>
            </div>
        );
    };

    return (
        <div ref={containerRef} className="relative">
            {/* Trigger Button */}
            <div
                className={`flex items-center w-full border rounded-lg cursor-pointer ${
                    isOpen ? 'border-primary-300 ring-2 ring-primary-100' : 'border-gray-200 hover:border-gray-300'
                }`}
                onClick={() => {
                    setIsOpen(true);
                    setTimeout(() => inputRef.current?.focus(), 0);
                }}
                onKeyDown={handleKeyDown}
                tabIndex={0}
            >
                {selectedItem ? (
                    <>
                        <div className="flex-1 px-3 py-2">
                            {renderSelectedValue()}
                        </div>
                        <button
                            onClick={(e) => { e.stopPropagation(); handleClear(); }}
                            className="p-2 text-gray-400 hover:text-gray-600"
                        >
                            <X size={14} />
                        </button>
                    </>
                ) : (
                    <>
                        <span className="flex-1 px-3 py-2 text-sm text-gray-400">
                            {placeholder}
                        </span>
                        <div className="p-2 text-gray-400">
                            <ChevronDown size={14} />
                        </div>
                    </>
                )}
            </div>

            {/* Dropdown */}
            {isOpen && (
                <div className="absolute z-50 w-full mt-1 bg-white border rounded-lg shadow-lg max-h-64 overflow-hidden">
                    {/* Search Input */}
                    <div className="p-2 border-b">
                        <div className="relative">
                            <Search size={14} className="absolute left-2 top-1/2 -translate-y-1/2 text-gray-400" />
                            <input
                                ref={inputRef}
                                type="text"
                                className="w-full pl-7 pr-3 py-1.5 text-sm border rounded focus:outline-none focus:ring-2 focus:ring-primary-100"
                                placeholder="Search..."
                                value={searchTerm}
                                onChange={(e) => {
                                    setSearchTerm(e.target.value);
                                    setHighlightedIndex(0);
                                }}
                                onKeyDown={handleKeyDown}
                            />
                        </div>
                    </div>

                    {/* Items List */}
                    <div className="overflow-y-auto max-h-48">
                        {filteredItems.length > 0 ? (
                            filteredItems.map((item, index) =>
                                renderItem(item, index === highlightedIndex, item.id === value)
                            )
                        ) : (
                            <div className="p-3 text-center text-sm text-gray-500">
                                No items found
                            </div>
                        )}
                    </div>
                </div>
            )}
        </div>
    );
}
