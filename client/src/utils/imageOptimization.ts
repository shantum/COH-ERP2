/**
 * Image Optimization Utilities
 *
 * Transforms Shopify CDN URLs to request appropriately sized images.
 * This reduces data transfer by 100x for thumbnails (1KB vs 100KB+).
 *
 * Shopify CDN supports size suffixes:
 * - product.jpg -> product_100x100.jpg (resized)
 * - product.jpg?width=100 (query param alternative)
 */

/**
 * Standard thumbnail sizes used in the app
 */
export const THUMBNAIL_SIZES = {
    /** 28x28 - OrdersTable product cells */
    xs: 56,   // 2x for retina
    /** 40x40 - Inventory list items */
    sm: 80,   // 2x for retina
    /** 64x64 - Modal product images */
    md: 128,  // 2x for retina
    /** 128x128 - Large previews */
    lg: 256,  // 2x for retina
} as const;

export type ThumbnailSize = keyof typeof THUMBNAIL_SIZES;

/**
 * Transform a Shopify CDN URL to request a smaller image
 *
 * @param url - Original Shopify image URL
 * @param size - Target size (uses 2x for retina displays)
 * @returns Optimized URL or original if not a Shopify URL
 *
 * @example
 * getOptimizedImageUrl('https://cdn.shopify.com/.../product.jpg', 'xs')
 * // Returns: 'https://cdn.shopify.com/.../product_56x56.jpg'
 */
export function getOptimizedImageUrl(
    url: string | null | undefined,
    size: ThumbnailSize = 'xs'
): string | null {
    if (!url) return null;

    // Only transform Shopify CDN URLs
    if (!url.includes('cdn.shopify.com')) {
        return url;
    }

    const targetSize = THUMBNAIL_SIZES[size];

    // Shopify URL patterns:
    // 1. https://cdn.shopify.com/s/files/1/0123/4567/8901/products/image.jpg
    // 2. https://cdn.shopify.com/s/files/1/0123/4567/8901/files/image.jpg

    // Check if URL already has size suffix (e.g., _100x100)
    const sizePattern = /_\d+x\d+\.(jpg|jpeg|png|gif|webp)(\?.*)?$/i;
    if (sizePattern.test(url)) {
        // Replace existing size with our target size
        return url.replace(sizePattern, `_${targetSize}x${targetSize}.$1$2`);
    }

    // Add size suffix before file extension
    const extensionPattern = /\.(jpg|jpeg|png|gif|webp)(\?.*)?$/i;
    const match = url.match(extensionPattern);

    if (match) {
        const extension = match[1];
        const queryString = match[2] || '';
        return url.replace(extensionPattern, `_${targetSize}x${targetSize}.${extension}${queryString}`);
    }

    // Fallback: use query parameter approach
    const separator = url.includes('?') ? '&' : '?';
    return `${url}${separator}width=${targetSize}&height=${targetSize}`;
}

/**
 * Preload an image to warm the browser cache
 * Useful for images that will be visible soon (e.g., next page)
 */
export function preloadImage(url: string | null | undefined): void {
    if (!url) return;
    const link = document.createElement('link');
    link.rel = 'preload';
    link.as = 'image';
    link.href = url;
    document.head.appendChild(link);
}

/**
 * Generate srcset for responsive images
 * Returns a srcset string for 1x and 2x pixel densities
 */
export function getImageSrcSet(
    url: string | null | undefined,
    size: ThumbnailSize = 'xs'
): string | undefined {
    if (!url || !url.includes('cdn.shopify.com')) {
        return undefined;
    }

    const baseSize = THUMBNAIL_SIZES[size];
    const halfSize = Math.round(baseSize / 2);

    const url1x = getOptimizedImageUrl(url, size)?.replace(
        `_${baseSize}x${baseSize}`,
        `_${halfSize}x${halfSize}`
    );
    const url2x = getOptimizedImageUrl(url, size);

    if (url1x && url2x) {
        return `${url1x} 1x, ${url2x} 2x`;
    }

    return undefined;
}
