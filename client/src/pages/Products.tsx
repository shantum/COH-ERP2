/**
 * Products Page - Unified catalog view
 *
 * Main tabs:
 * - Products: DataTable view for product catalog (view/check data)
 * - Style Codes: Quick view and edit style codes
 *
 * BOM, Consumption, FabricMapping moved to /fabrics?tab=bom.
 * Materials, Trims, Services moved to /fabrics page.
 */

import { useState, useCallback } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { Package, Hash } from 'lucide-react';

import { ProductsViewSwitcher } from '../components/products/ProductsViewSwitcher';
import { StyleCodesTable } from '../components/products/StyleCodesTable';
import type { ProductTreeNode, ProductsTabType } from '../components/products/types';
import type { ProductsSearchParams } from '@coh/shared';
import { Route } from '../routes/_authenticated/products';

export default function Products() {
    const loaderData = Route.useLoaderData();
    const search = Route.useSearch();
    const navigate = useNavigate();

    const activeTab = (search.tab || 'products') as ProductsTabType;
    const [searchQuery, setSearchQuery] = useState('');

    const setActiveTab = useCallback((tab: ProductsTabType) => {
        navigate({
            to: '/products',
            search: { ...search, tab, id: undefined, type: undefined } as ProductsSearchParams,
            replace: true,
        });
    }, [navigate, search]);

    // Navigate to /fabrics?tab=bom for BOM editing
    const handleEditBom = useCallback((product: ProductTreeNode) => {
        navigate({
            to: '/fabrics',
            search: { tab: 'bom', productId: product.id },
        });
    }, [navigate]);

    return (
        <div className="flex flex-col h-[calc(100vh-4rem)]">
            {/* Tab Navigation */}
            <div className="flex items-center gap-1 px-4 py-2 border-b bg-gray-50 flex-shrink-0">
                <TabButton
                    icon={Package}
                    label="Products"
                    isActive={activeTab === 'products'}
                    onClick={() => setActiveTab('products')}
                />
                <TabButton
                    icon={Hash}
                    label="Style Codes"
                    isActive={activeTab === 'styleCodes'}
                    onClick={() => setActiveTab('styleCodes')}
                />
            </div>

            {/* Main Content */}
            <div className="flex-1 flex overflow-hidden">
                {activeTab === 'products' && (
                    <div className="flex-1 p-4 overflow-hidden">
                        <ProductsViewSwitcher
                            searchQuery={searchQuery}
                            onSearchChange={setSearchQuery}
                            onViewProduct={handleEditBom}
                            onEditBom={handleEditBom}
                            initialData={loaderData?.productsTree}
                        />
                    </div>
                )}

                {activeTab === 'styleCodes' && (
                    <div className="flex-1 p-4 overflow-auto">
                        <StyleCodesTable />
                    </div>
                )}
            </div>

            {/* Footer Summary */}
            <div className="px-4 py-2 border-t bg-gray-50 text-xs text-gray-500 flex-shrink-0">
                {activeTab === 'products' && (
                    <span>Click a row to view details</span>
                )}
                {activeTab === 'styleCodes' && (
                    <span>Click any style code to edit inline</span>
                )}
            </div>
        </div>
    );
}

// Tab Button Component
interface TabButtonProps {
    icon: typeof Package;
    label: string;
    isActive: boolean;
    onClick: () => void;
}

function TabButton({ icon: Icon, label, isActive, onClick }: TabButtonProps) {
    return (
        <button
            onClick={onClick}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
                isActive
                    ? 'bg-white shadow text-gray-900'
                    : 'text-gray-600 hover:text-gray-900 hover:bg-gray-100'
            }`}
        >
            <Icon size={16} />
            {label}
        </button>
    );
}
