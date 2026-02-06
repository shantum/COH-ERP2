/**
 * LinkedProductsCell - Shows linked product thumbnails
 *
 * Displays optimized product thumbnails in a horizontal stack.
 * Shows up to 4 thumbnails, with a +N indicator for additional products.
 */

import { memo } from 'react';
import type { LinkedProduct } from '../../../server/functions/materials';

interface LinkedProductsCellProps {
    products: LinkedProduct[];
}

const MAX_THUMBNAILS = 4;
const THUMBNAIL_SIZE = 28;

/**
 * Optimized thumbnail component with loading="lazy" and srcset
 */
function ProductThumbnail({ product, index }: { product: LinkedProduct; index: number }) {
    if (!product.imageUrl) {
        // Placeholder for products without images
        return (
            <div
                className="flex-shrink-0 rounded bg-gray-100 border border-gray-200 flex items-center justify-center text-[10px] text-gray-400 font-medium"
                style={{
                    width: THUMBNAIL_SIZE,
                    height: THUMBNAIL_SIZE,
                    marginLeft: index > 0 ? -8 : 0,
                    zIndex: MAX_THUMBNAILS - index,
                }}
                title={product.styleCode ? `${product.name} (${product.styleCode})` : product.name}
            >
                {product.name.charAt(0).toUpperCase()}
            </div>
        );
    }

    // Generate optimized URL with Shopify CDN transforms if applicable
    const optimizedUrl = product.imageUrl.includes('cdn.shopify.com')
        ? product.imageUrl.replace(/\.([^.]+)$/, `_${THUMBNAIL_SIZE * 2}x$&`)
        : product.imageUrl;

    return (
        <img
            src={optimizedUrl}
            alt={product.name}
            title={product.styleCode ? `${product.name} (${product.styleCode})` : product.name}
            loading="lazy"
            decoding="async"
            className="flex-shrink-0 rounded border border-gray-200 object-cover bg-gray-50"
            style={{
                width: THUMBNAIL_SIZE,
                height: THUMBNAIL_SIZE,
                marginLeft: index > 0 ? -8 : 0,
                zIndex: MAX_THUMBNAILS - index,
            }}
            onError={(e) => {
                // Hide broken images
                (e.target as HTMLImageElement).style.display = 'none';
            }}
        />
    );
}

export const LinkedProductsCell = memo(function LinkedProductsCell({ products }: LinkedProductsCellProps) {
    if (products.length === 0) {
        return <span className="text-gray-400 text-xs">-</span>;
    }

    const visibleProducts = products.slice(0, MAX_THUMBNAILS);
    const remainingCount = products.length - MAX_THUMBNAILS;

    // Build tooltip with all product names
    const tooltipText = products
        .map(p => p.styleCode ? `${p.name} (${p.styleCode})` : p.name)
        .join('\n');

    return (
        <div
            className="flex items-center"
            title={tooltipText}
        >
            {visibleProducts.map((product, index) => (
                <ProductThumbnail
                    key={product.id}
                    product={product}
                    index={index}
                />
            ))}
            {remainingCount > 0 && (
                <div
                    className="flex-shrink-0 rounded bg-gray-200 border border-gray-300 flex items-center justify-center text-[10px] text-gray-600 font-medium"
                    style={{
                        width: THUMBNAIL_SIZE,
                        height: THUMBNAIL_SIZE,
                        marginLeft: -8,
                        zIndex: 0,
                    }}
                >
                    +{remainingCount}
                </div>
            )}
        </div>
    );
});
