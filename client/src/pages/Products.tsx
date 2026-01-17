/**
 * Products Page - Unified catalog view
 *
 * Main tabs:
 * - Products: DataTable view for product catalog (view/check data)
 * - Materials: Material → Fabric → Colour hierarchy
 * - Trims: Trim items catalog
 * - Services: Service items catalog
 * - BOM: Two-panel master-detail layout for BOM setup
 */

import { useState, useCallback, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Package, Layers, Scissors, Wrench, Plus, Search, GitBranch } from 'lucide-react';

import { ProductsViewSwitcher } from '../components/products/ProductsViewSwitcher';
import { ProductsTree } from '../components/products/ProductsTree';
import { DetailPanel } from '../components/products/DetailPanel';
import { MaterialsTreeView } from '../components/materials/MaterialsTreeView';
import { TrimsTable } from '../components/materials/TrimsTable';
import { ServicesTable } from '../components/materials/ServicesTable';
import { useProductsTree } from '../components/products/hooks/useProductsTree';
import type { ProductTreeNode, ProductNodeType, ProductsTabType } from '../components/products/types';

export default function Products() {
    const [searchParams, setSearchParams] = useSearchParams();

    // Active main tab from URL
    const activeTab = (searchParams.get('tab') as ProductsTabType) || 'products';

    // Selected node ID and type from URL (for BOM tab)
    const selectedId = searchParams.get('id');
    const selectedType = searchParams.get('type') as ProductNodeType | null;

    // Selected node for detail panel (resolved from URL or user interaction)
    const [selectedNode, setSelectedNode] = useState<ProductTreeNode | null>(null);

    // Search query
    const [searchQuery, setSearchQuery] = useState('');

    // Material view states (reused from Materials.tsx for now)
    const [showMaterialDetail, setShowMaterialDetail] = useState<any>(null);
    const [showMaterialInward, setShowMaterialInward] = useState<any>(null);

    // Fetch products tree for URL resolution (only for BOM tab)
    const { data: productsData } = useProductsTree({ enabled: activeTab === 'bom' });

    // Resolve selected node from URL params when data loads (BOM tab)
    useEffect(() => {
        if (!selectedId || !selectedType || activeTab !== 'bom') {
            return;
        }

        // Find the node in the tree
        const findNode = (nodes: ProductTreeNode[]): ProductTreeNode | null => {
            for (const node of nodes) {
                if (node.id === selectedId && node.type === selectedType) {
                    return node;
                }
                if (node.children) {
                    const found = findNode(node.children);
                    if (found) return found;
                }
            }
            return null;
        };

        const node = findNode(productsData);
        if (node && (!selectedNode || selectedNode.id !== node.id)) {
            setSelectedNode(node);
        }
    }, [selectedId, selectedType, productsData, activeTab, selectedNode]);

    // Handle tab change
    const setActiveTab = useCallback((tab: ProductsTabType) => {
        if (tab === 'products') {
            setSearchParams({}, { replace: true });
        } else {
            setSearchParams({ tab }, { replace: true });
        }
        // Clear selection when switching tabs
        setSelectedNode(null);
        setShowMaterialDetail(null);
    }, [setSearchParams]);

    // Handle node selection in BOM tab - sync to URL
    const handleBomSelect = useCallback((node: ProductTreeNode | null) => {
        setSelectedNode(node);
        if (node) {
            const newParams = new URLSearchParams(searchParams);
            newParams.set('tab', 'bom');
            newParams.set('id', node.id);
            newParams.set('type', node.type);
            setSearchParams(newParams, { replace: true });
        } else {
            const newParams = new URLSearchParams(searchParams);
            newParams.delete('id');
            newParams.delete('type');
            setSearchParams(newParams, { replace: true });
        }
    }, [searchParams, setSearchParams]);

    // Handle close detail panel in BOM tab
    const handleCloseDetail = useCallback(() => {
        setSelectedNode(null);
        const newParams = new URLSearchParams(searchParams);
        newParams.delete('id');
        newParams.delete('type');
        setSearchParams(newParams, { replace: true });
    }, [searchParams, setSearchParams]);

    // Handle view product from DataTable - switch to BOM tab and select
    const handleViewProduct = useCallback((product: ProductTreeNode) => {
        setSelectedNode(product);
        setSearchParams({ tab: 'bom', id: product.id, type: product.type }, { replace: true });
    }, [setSearchParams]);

    // Handle edit BOM from DataTable
    const handleEditBom = useCallback((product: ProductTreeNode) => {
        setSelectedNode(product);
        setSearchParams({ tab: 'bom', id: product.id, type: product.type }, { replace: true });
    }, [setSearchParams]);

    return (
        <div className="flex flex-col h-[calc(100vh-4rem)]">
            {/* Page Header */}
            <div className="flex items-center justify-between px-4 py-3 border-b bg-white flex-shrink-0">
                <div>
                    <h1 className="text-lg font-semibold text-gray-900">Products</h1>
                    <p className="text-xs text-gray-500">
                        Manage products, materials, trims, and services
                    </p>
                </div>

                <div className="flex items-center gap-3">
                    {/* Search */}
                    <div className="relative">
                        <Search size={16} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
                        <input
                            type="text"
                            placeholder="Search..."
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            className="pl-8 pr-3 py-1.5 text-sm border border-gray-300 rounded-lg w-48 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
                        />
                    </div>

                    {/* Add button */}
                    <button
                        className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-white bg-primary-600 rounded-lg hover:bg-primary-700 transition-colors"
                    >
                        <Plus size={16} />
                        Add
                    </button>
                </div>
            </div>

            {/* Tab Navigation */}
            <div className="flex items-center gap-1 px-4 py-2 border-b bg-gray-50 flex-shrink-0">
                <TabButton
                    icon={Package}
                    label="Products"
                    isActive={activeTab === 'products'}
                    onClick={() => setActiveTab('products')}
                />
                <TabButton
                    icon={Layers}
                    label="Materials"
                    isActive={activeTab === 'materials'}
                    onClick={() => setActiveTab('materials')}
                />
                <TabButton
                    icon={Scissors}
                    label="Trims"
                    isActive={activeTab === 'trims'}
                    onClick={() => setActiveTab('trims')}
                />
                <TabButton
                    icon={Wrench}
                    label="Services"
                    isActive={activeTab === 'services'}
                    onClick={() => setActiveTab('services')}
                />
                <div className="w-px h-6 bg-gray-300 mx-2" />
                <TabButton
                    icon={GitBranch}
                    label="BOM Editor"
                    isActive={activeTab === 'bom'}
                    onClick={() => setActiveTab('bom')}
                />
            </div>

            {/* Main Content */}
            <div className="flex-1 flex overflow-hidden">
                {/* Products Tab - Dual Hierarchy View */}
                {activeTab === 'products' && (
                    <div className="flex-1 p-4 overflow-hidden">
                        <ProductsViewSwitcher
                            searchQuery={searchQuery}
                            onViewProduct={handleViewProduct}
                            onEditBom={handleEditBom}
                        />
                    </div>
                )}

                {/* Materials Tab */}
                {activeTab === 'materials' && (
                    <div className="flex-1 overflow-hidden">
                        <MaterialsTreeView
                            onViewDetails={setShowMaterialDetail}
                            onAddInward={setShowMaterialInward}
                            onAddSupplier={() => {}}
                        />
                    </div>
                )}

                {/* Trims Tab */}
                {activeTab === 'trims' && (
                    <div className="flex-1 p-4 overflow-auto">
                        <TrimsTable
                            onEdit={() => {}}
                            onViewDetails={() => {}}
                            onAdd={() => {}}
                        />
                    </div>
                )}

                {/* Services Tab */}
                {activeTab === 'services' && (
                    <div className="flex-1 p-4 overflow-auto">
                        <ServicesTable
                            onEdit={() => {}}
                            onViewDetails={() => {}}
                            onAdd={() => {}}
                        />
                    </div>
                )}

                {/* BOM Tab - Two Panel Layout */}
                {activeTab === 'bom' && (
                    <>
                        {/* Left Panel - Tree */}
                        <div className="w-[400px] border-r bg-white flex-shrink-0 overflow-hidden flex flex-col">
                            <ProductsTree
                                onSelect={handleBomSelect}
                                selectedId={selectedNode?.id}
                                searchQuery={searchQuery}
                            />
                        </div>

                        {/* Right Panel - Detail */}
                        <div className="flex-1 overflow-hidden">
                            <DetailPanel
                                node={selectedNode}
                                onClose={handleCloseDetail}
                            />
                        </div>
                    </>
                )}
            </div>

            {/* Footer Summary */}
            <div className="px-4 py-2 border-t bg-gray-50 text-xs text-gray-500 flex-shrink-0">
                {activeTab === 'products' && (
                    <span>Click a row to view details • Use actions menu to edit BOM</span>
                )}
                {activeTab === 'materials' && (
                    <span>Materials hierarchy • Click to expand • Use actions menu for operations</span>
                )}
                {activeTab === 'trims' && (
                    <span>Trim items catalog • Click Add to create new trim</span>
                )}
                {activeTab === 'services' && (
                    <span>Service items catalog • Click Add to create new service</span>
                )}
                {activeTab === 'bom' && (
                    <span>Select a product or variation to edit its Bill of Materials</span>
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
