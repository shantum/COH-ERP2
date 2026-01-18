/**
 * ProductNameCell - Displays product thumbnail, name, SKU, color (with swatch), and size
 */

import type { FlattenedOrderRow } from '../../../../utils/orderHelpers';
import { Package } from 'lucide-react';

interface ProductNameCellProps {
    row: FlattenedOrderRow;
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
        'white': '#f8f8f8',
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
        'carbon black': '#2d2d2d',
        // Greens
        'green': '#22c55e',
        'pine green': '#1d4d4f',
        'olive': '#6b8e23',
        'sage': '#9caf88',
        'mint': '#98fb98',
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

export function ProductNameCell({ row }: ProductNameCellProps) {
    const productName = row.productName || '-';
    const skuCode = row.skuCode || '';
    const colorName = row.colorName || '';
    const size = row.size || '';
    const imageUrl = row.imageUrl;

    // Get color hex from data or derive from name
    const colorHex = row.colorHex || getColorFromName(colorName);

    const fullName = [productName, colorName, size, skuCode].filter(Boolean).join(' / ');

    return (
        <div className="flex items-center gap-2 py-0.5" title={fullName}>
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
                {/* Line 1: Product name + Size badge */}
                <div className="flex items-center gap-1.5">
                    <span className="font-medium text-gray-900 truncate">
                        {productName}
                    </span>
                    {size && size !== '-' && (
                        <span className="text-[10px] font-bold px-1.5 py-0 rounded bg-blue-600 text-white shrink-0">
                            {size}
                        </span>
                    )}
                </div>
                {/* Line 2: Color swatch + Color name + SKU */}
                <div className="flex items-center gap-1.5 mt-0.5 text-[10px]">
                    {colorName && colorName !== '-' && (
                        <>
                            {/* Color swatch */}
                            <span
                                className="w-2.5 h-2.5 rounded-full shrink-0 border border-gray-200"
                                style={{ backgroundColor: colorHex || '#ccc' }}
                            />
                            {/* Color name - bold and colored if we have hex */}
                            <span
                                className="font-semibold truncate"
                                style={{ color: colorHex || '#6b7280' }}
                            >
                                {colorName}
                            </span>
                        </>
                    )}
                    {colorName && colorName !== '-' && skuCode && (
                        <span className="text-gray-300">·</span>
                    )}
                    {skuCode && (
                        <span className="font-mono text-gray-400 truncate">
                            {skuCode}
                        </span>
                    )}
                </div>
            </div>
        </div>
    );
}
