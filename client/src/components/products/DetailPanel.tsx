/**
 * DetailPanel - Right panel showing details of selected item
 *
 * Renders the appropriate detail component based on node type:
 * - Product: ProductDetail with tabs for Info, BOM, Costs, SKUs
 * - Variation: VariationDetail with tabs for Info, BOM, SKUs
 * - SKU: SkuDetail with tabs for Info, Inventory
 */

import { Package } from 'lucide-react';
import type { ProductTreeNode } from './types';
import { ProductDetail } from './detail/ProductDetail';
import { VariationDetail } from './detail/VariationDetail';
import { SkuDetail } from './detail/SkuDetail';

interface DetailPanelProps {
    node: ProductTreeNode | null;
    onClose: () => void;
    onEdit?: (node: ProductTreeNode) => void;
}

export function DetailPanel({ node, onClose, onEdit }: DetailPanelProps) {
    if (!node) {
        return (
            <div className="h-full flex items-center justify-center text-gray-400 bg-white">
                <div className="text-center">
                    <Package size={48} className="mx-auto mb-3 opacity-50" />
                    <p className="text-sm">Select an item to view details</p>
                    <p className="text-xs text-gray-400 mt-1">
                        Click on a product, variation, or SKU in the tree
                    </p>
                </div>
            </div>
        );
    }

    switch (node.type) {
        case 'product':
            return (
                <ProductDetail
                    product={node}
                    onClose={onClose}
                />
            );
        case 'variation':
            return (
                <VariationDetail
                    variation={node}
                    onEdit={onEdit}
                    onClose={onClose}
                />
            );
        case 'sku':
            return (
                <SkuDetail
                    sku={node}
                    onEdit={onEdit}
                    onClose={onClose}
                />
            );
        default:
            return (
                <div className="h-full flex items-center justify-center text-gray-400 bg-white">
                    <p className="text-sm">Unknown item type</p>
                </div>
            );
    }
}
