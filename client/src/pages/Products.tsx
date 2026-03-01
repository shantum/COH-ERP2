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
import { AlertCircle, RefreshCcw } from 'lucide-react';

import { ProductsViewSwitcher } from '../components/products/ProductsViewSwitcher';
import type { ProductTreeNode } from '../components/products/types';
import { Route } from '../routes/_authenticated/products';
import { useAuth } from '../hooks/useAuth';
import { isAdminUser } from '../types';

export default function Products() {
    const loaderData = Route.useLoaderData();
    const navigate = useNavigate();
    const { user } = useAuth();
    const isAdmin = isAdminUser(user);

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

    // Show error state if loader failed and no data
    if (loaderData.error && !loaderData.productsTree) {
        return (
            <div className="p-4 sm:p-6">
                <h1 className="text-lg sm:text-xl md:text-2xl font-bold text-gray-900 mb-4">Products</h1>
                <div className="bg-red-50 border border-red-200 rounded-lg p-4 flex items-start gap-3">
                    <AlertCircle className="w-5 h-5 text-red-500 flex-shrink-0 mt-0.5" />
                    <div>
                        <h2 className="text-red-800 font-semibold">Failed to load products</h2>
                        <p className="text-red-600 text-sm mt-1">{loaderData.error}</p>
                        <button
                            onClick={() => window.location.reload()}
                            className="mt-3 inline-flex items-center gap-1.5 text-sm text-red-700 hover:text-red-800 font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500 rounded-md"
                        >
                            <RefreshCcw className="w-4 h-4" />
                            Refresh page
                        </button>
                    </div>
                </div>
            </div>
        );
    }

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
                        onAddProduct={isAdmin ? handleAddProduct : undefined}
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
