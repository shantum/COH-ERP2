/**
 * ProductNameCell - Displays product thumbnail, name, SKU, color (with swatch), and size
 */

import { useState } from 'react';
import type { FlattenedOrderRow } from '../../../../utils/orderHelpers';
import { Package, Check } from 'lucide-react';
import { cn } from '../../../../lib/utils';

interface ProductNameCellProps {
    row: FlattenedOrderRow;
}

/**
 * Get size badge styles using slate scale for visual hierarchy
 * Larger sizes = darker colors
 */
function getSizeBadgeClasses(size: string): string {
    const s = size.toUpperCase().trim();

    // Map sizes to Tailwind slate classes
    const sizeStyles: Record<string, string> = {
        'XXS': 'bg-slate-50 text-slate-600 border border-slate-200',
        'XS': 'bg-slate-100 text-slate-700 border border-slate-200',
        'S': 'bg-slate-200 text-slate-700',
        'M': 'bg-slate-300 text-slate-800',
        'L': 'bg-slate-400 text-white',
        'XL': 'bg-slate-500 text-white',
        '2XL': 'bg-slate-600 text-white',
        '3XL': 'bg-slate-700 text-white',
        '4XL': 'bg-slate-800 text-white',
        '5XL': 'bg-slate-900 text-white',
    };

    return sizeStyles[s] || 'bg-slate-300 text-slate-800'; // Default to M-like
}

/**
 * Generate a color hex from a color name (simple hash-based approach)
 * Maps common color names to their hex values
 */
function getColorFromName(colorName: string): string | null {
    if (!colorName || colorName === '-') return null;

    const name = colorName.toLowerCase().trim();

    // Common color mappings
    const colorMap: Record<string, string> = {
        // Basics
        'black': '#1a1a1a',
        'white': '#ffffff',
        'grey': '#808080',
        'gray': '#808080',
        // Blues
        'navy': '#1e3a5f',
        'navy blue': '#1e3a5f',
        'deep sea blue': '#1a4d6e',
        'blue': '#3b82f6',
        'sky blue': '#7dd3fc',
        'light blue': '#93c5fd',
        'royal blue': '#1d4ed8',
        'indigo': '#4f46e5',
        'carbon black': '#2d2d2d',
        'midnight black': '#1a1a1a',
        // Greens
        'green': '#22c55e',
        'pine green': '#1d4d4f',
        'olive': '#6b8e23',
        'sage': '#9caf88',
        'mint': '#98fb98',
        'marine green': '#2e8b57',
        // Pinks/Reds
        'pink': '#ec4899',
        'berry pink': '#c41e7a',
        'vintage pink': '#d4a5a5',
        'red': '#ef4444',
        'indian red': '#cd5c5c',
        'rust': '#b7410e',
        'maroon': '#800000',
        // Browns/Earth
        'brown': '#8b4513',
        'tree trunk brown': '#5c4033',
        'ginger': '#b06500',
        'tan': '#d2b48c',
        'beige': '#f5f5dc',
        'camel': '#c19a6b',
        'stone': '#928e85',
        'stone grey': '#928e85',
        // Yellows/Orange
        'yellow': '#fbbf24',
        'mustard': '#ffdb58',
        'orange': '#f97316',
        'coral': '#ff7f50',
        'peach': '#ffdab9',
        // Purples
        'purple': '#a855f7',
        'lavender': '#e6e6fa',
        'plum': '#8e4585',
        'slate': '#708090',
        'slate grey': '#708090',
        // Neutrals
        'cream': '#fffdd0',
        'ivory': '#fffff0',
        'pearl': '#f0ead6',
        'pearl white': '#f0ead6',
        'cloud white': '#f5f5f5',
        'natural': '#f5f0e1',
        'charcoal': '#36454f',
        'silver': '#c0c0c0',
    };

    // Direct match
    if (colorMap[name]) return colorMap[name];

    // Partial match
    for (const [key, hex] of Object.entries(colorMap)) {
        if (name.includes(key) || key.includes(name)) {
            return hex;
        }
    }

    // Generate a hash-based color as fallback
    let hash = 0;
    for (let i = 0; i < colorName.length; i++) {
        hash = colorName.charCodeAt(i) + ((hash << 5) - hash);
    }
    const hue = Math.abs(hash % 360);
    return `hsl(${hue}, 45%, 55%)`;
}

/**
 * Check if a color is light (for contrast calculation)
 */
function isLightColor(hex: string): boolean {
    // Remove # if present
    const color = hex.replace('#', '');

    // Handle HSL colors
    if (hex.startsWith('hsl')) {
        const match = hex.match(/hsl\((\d+),\s*(\d+)%,\s*(\d+)%\)/);
        if (match) {
            const lightness = parseInt(match[3], 10);
            return lightness > 60;
        }
        return false;
    }

    // Parse hex
    const r = parseInt(color.slice(0, 2), 16);
    const g = parseInt(color.slice(2, 4), 16);
    const b = parseInt(color.slice(4, 6), 16);

    // Calculate luminance (perceived brightness)
    const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
    return luminance > 0.7;
}

export function ProductNameCell({ row }: ProductNameCellProps) {
    const productName = row.productName || '-';
    const skuCode = row.skuCode || '';
    const colorName = row.colorName || '';
    const size = row.size || '';
    const imageUrl = row.imageUrl;

    // Get color hex from data or derive from name
    const colorHex = row.colorHex || getColorFromName(colorName);
    const isLight = colorHex ? isLightColor(colorHex) : false;

    const fullName = [productName, colorName, size, skuCode].filter(Boolean).join(' / ');
    const [copied, setCopied] = useState(false);

    const handleCopySku = (e: React.MouseEvent) => {
        e.stopPropagation();
        if (skuCode) {
            navigator.clipboard.writeText(skuCode);
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
        }
    };

    return (
        <div
            className={cn(
                'flex items-center gap-2 py-0.5 cursor-pointer -mx-1 px-1 rounded transition-colors',
                copied ? 'bg-emerald-50' : 'hover:bg-gray-50'
            )}
            title={skuCode ? `Click to copy: ${skuCode}` : fullName}
            onClick={handleCopySku}
        >
            {/* Thumbnail */}
            <div className="w-7 h-7 rounded bg-gray-100 flex-shrink-0 overflow-hidden">
                {imageUrl ? (
                    <img
                        src={imageUrl}
                        alt={productName}
                        className="w-full h-full object-cover"
                        loading="lazy"
                    />
                ) : (
                    <div className="w-full h-full flex items-center justify-center text-gray-300">
                        <Package size={14} />
                    </div>
                )}
            </div>

            {/* Product info */}
            <div className="flex flex-col justify-center leading-tight min-w-0">
                {/* Line 1: Product name | Size */}
                <div className="flex items-center gap-1">
                    <span className="font-medium text-gray-900 truncate">
                        {productName}
                    </span>
                    {size && size !== '-' && (
                        <>
                            <span className="text-gray-300">|</span>
                            <span className="text-gray-600 shrink-0">{size}</span>
                        </>
                    )}
                </div>
                {/* Line 2: Color name + SKU */}
                <div className="flex items-center gap-1 mt-0.5 text-[11px]">
                    {colorName && colorName !== '-' && (
                        <span className="font-medium truncate px-1.5 py-0.5 rounded text-[10px] bg-gray-100 text-gray-600">
                            {colorName}
                        </span>
                    )}
                    {colorName && colorName !== '-' && skuCode && (
                        <span className="text-gray-300">·</span>
                    )}
                    {skuCode && (
                        <span className={cn(
                            'font-mono truncate transition-colors',
                            copied ? 'text-emerald-600' : 'text-gray-400'
                        )}>
                            {copied ? (
                                <span className="flex items-center gap-0.5">
                                    <Check size={10} />
                                    Copied
                                </span>
                            ) : skuCode}
                        </span>
                    )}
                </div>
            </div>
        </div>
    );
}
