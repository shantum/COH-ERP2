/**
 * BOM Tab
 *
 * Master-detail layout for the BOM tab on /fabrics page.
 * Left panel: product list with search
 * Right panel: BOM editor for the selected product
 */

import { useCallback } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { Route } from '../../routes/_authenticated/fabrics';
import { Package } from 'lucide-react';
import BomProductList from './BomProductList';
import BomEditorInline from './BomEditorInline';

export default function BomTab() {
    const search = Route.useSearch();
    const navigate = useNavigate();

    const selectedProductId = search.productId;

    const handleSelectProduct = useCallback((productId: string, _productName: string) => {
        navigate({
            to: '/fabrics',
            search: { tab: 'bom', productId },
            replace: true,
        });
    }, [navigate]);

    return (
        <div className="flex h-full">
            {/* Left: Product list */}
            <div className="w-80 shrink-0">
                <BomProductList
                    selectedProductId={selectedProductId}
                    onSelectProduct={handleSelectProduct}
                />
            </div>

            {/* Right: Editor or empty state */}
            <div className="flex-1 overflow-hidden">
                {selectedProductId ? (
                    <BomEditorInline productId={selectedProductId} />
                ) : (
                    <div className="flex h-full flex-col items-center justify-center text-slate-400">
                        <Package className="mb-3 h-12 w-12 text-slate-300" />
                        <p className="text-sm font-medium">Select a product</p>
                        <p className="mt-1 text-xs">Choose from the list to view and edit its BOM</p>
                    </div>
                )}
            </div>
        </div>
    );
}
