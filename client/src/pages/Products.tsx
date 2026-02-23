/**
 * Products Page - Unified catalog view
 *
 * Single view showing product catalog with SKU-wise table.
 * Style codes editable via SKU edit modal.
 *
 * BOM, Consumption, FabricMapping moved to /fabrics?tab=bom.
 * Materials, Trims, Services moved to /fabrics page.
 */

import { useState, useCallback } from 'react';
import { useNavigate } from '@tanstack/react-router';

import { ProductsViewSwitcher } from '../components/products/ProductsViewSwitcher';
import type { ProductTreeNode } from '../components/products/types';
import { Route } from '../routes/_authenticated/products';

export default function Products() {
    const loaderData = Route.useLoaderData();
    const navigate = useNavigate();

    const [searchQuery, setSearchQuery] = useState('');

    // Navigate to /fabrics?tab=bom for BOM editing
    const handleEditBom = useCallback((product: ProductTreeNode) => {
        navigate({
            to: '/fabrics',
            search: { tab: 'bom', productId: product.id },
        });
    }, [navigate]);

    const handleAddProduct = useCallback(() => {
        navigate({ to: '/products/new' });
    }, [navigate]);

    return (
        <div className="flex flex-col h-[calc(100vh-4rem)]">
            {/* Main Content */}
            <div className="flex-1 flex overflow-hidden">
                <div className="flex-1 p-4 overflow-hidden">
                    <ProductsViewSwitcher
                        searchQuery={searchQuery}
                        onSearchChange={setSearchQuery}
                        onViewProduct={handleEditBom}
                        onEditBom={handleEditBom}
                        onAddProduct={handleAddProduct}
                        initialData={loaderData?.productsTree}
                    />
                </div>
            </div>

            {/* Footer Summary */}
            <div className="px-4 py-2 border-t bg-gray-50 text-xs text-gray-500 flex-shrink-0">
                <span>Click a row to view details</span>
            </div>
        </div>
    );
}
