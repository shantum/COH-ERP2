/**
 * ProductNameCell - Displays product thumbnail, name, SKU, color (with swatch), and size
 */

import { useState, memo } from 'react';
import type { FlattenedOrderRow } from '../../../../utils/orderHelpers';
import { Package, Check } from 'lucide-react';
import { cn } from '../../../../lib/utils';

interface ProductNameCellProps {
    row: FlattenedOrderRow;
}

export const ProductNameCell = memo(function ProductNameCell({ row }: ProductNameCellProps) {
    const productName = row.productName || '-';
    const skuCode = row.skuCode || '';
    const colorName = row.colorName || '';
    const size = row.size || '';
    const imageUrl = row.imageUrl;

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
                {/* Line 1: Product name | Size | OOS indicator */}
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
                    {/* Fabric status indicator: null=no fabric, false=in stock, true=OOS */}
                    {row.isFabricOutOfStock === true && (
                        <span
                            className="shrink-0 px-1 py-0.5 text-[9px] font-semibold bg-red-100 text-red-700 rounded"
                            title="Fabric is marked as out of stock"
                        >
                            OOS
                        </span>
                    )}
                    {row.isFabricOutOfStock === false && (
                        <span title="Fabric linked and in stock">
                            <Check size={10} strokeWidth={2} className="shrink-0 text-emerald-300" />
                        </span>
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
});
