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
import { useNavigate, ClientOnly } from '@tanstack/react-router';
import { Package, Layers, Scissors, Wrench, GitBranch, Grid3X3, FileUp, Link2, Hash, Loader2 } from 'lucide-react';

import { ProductsViewSwitcher } from '../components/products/ProductsViewSwitcher';
import { DetailPanel } from '../components/products/DetailPanel';
import { MaterialsTreeView } from '../components/materials/MaterialsTreeView';
import { TrimsTable } from '../components/materials/TrimsTable';
import { ServicesTable } from '../components/materials/ServicesTable';
import { useProductsTree } from '../components/products/hooks/useProductsTree';
import { BomProductList, ConsumptionGridView, ConsumptionImportView } from '../components/products/bom';
import { FabricMappingView } from '../components/products/fabric-mapping';
import { StyleCodesTable } from '../components/products/StyleCodesTable';
import type { ProductTreeNode, ProductNodeType, ProductsTabType } from '../components/products/types';
import { Route } from '../routes/_authenticated/products';

export default function Products() {
    // Get loader data from route (SSR pre-fetched data)
    const loaderData = Route.useLoaderData();
    const search = Route.useSearch();
    const navigate = useNavigate();

    // Active main tab from URL
    const activeTab = (search.tab || 'products') as ProductsTabType;

    // Selected node ID and type from URL (for BOM tab)
    const selectedId = search.id ?? null;
    const selectedType = (search.type ?? null) as ProductNodeType | null;

    // Selected node for detail panel (resolved from URL or user interaction)
    const [selectedNode, setSelectedNode] = useState<ProductTreeNode | null>(null);

    // Search query
    const [searchQuery, setSearchQuery] = useState('');

    // Check if we have valid loader data (Server Function succeeded)
    const hasLoaderData = !!loaderData?.productsTree;

    // Fetch products tree for URL resolution (only for BOM tab)
    // Pass initialData from route loader for instant hydration
    const { data: productsData } = useProductsTree({
        enabled: activeTab === 'bom',
        initialData: hasLoaderData ? loaderData.productsTree : null,
    });

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
        navigate({
            to: '/products',
            search: { ...search, tab, id: undefined, type: undefined } as any,
            replace: true,
        });
        // Clear selection when switching tabs
        setSelectedNode(null);
    }, [navigate, search]);

    // Handle node selection in BOM tab - sync to URL
    const handleBomSelect = useCallback((node: ProductTreeNode | null) => {
        setSelectedNode(node);
        if (node) {
            navigate({
                to: '/products',
                search: {
                    ...search,
                    tab: 'bom' as const,
                    id: node.id,
                    type: node.type,
                } as any,
                replace: true,
            });
        } else {
            navigate({
                to: '/products',
                search: {
                    ...search,
                    id: undefined,
                    type: undefined,
                } as any,
                replace: true,
            });
        }
    }, [navigate, search]);

    // Handle close detail panel in BOM tab
    const handleCloseDetail = useCallback(() => {
        setSelectedNode(null);
        navigate({
            to: '/products',
            search: {
                ...search,
                id: undefined,
                type: undefined,
            } as any,
            replace: true,
        });
    }, [navigate, search]);

    // Handle view product from DataTable - switch to BOM tab and select
    const handleViewProduct = useCallback((product: ProductTreeNode) => {
        setSelectedNode(product);
        navigate({
            to: '/products',
            search: { ...search, tab: 'bom' as const, id: product.id, type: product.type } as any,
            replace: true,
        });
    }, [navigate, search]);

    // Handle edit BOM from DataTable
    const handleEditBom = useCallback((product: ProductTreeNode) => {
        setSelectedNode(product);
        navigate({
            to: '/products',
            search: { ...search, tab: 'bom' as const, id: product.id, type: product.type } as any,
            replace: true,
        });
    }, [navigate, search]);

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
                <TabButton
                    icon={Grid3X3}
                    label="Consumption"
                    isActive={activeTab === 'consumption'}
                    onClick={() => setActiveTab('consumption')}
                />
                <TabButton
                    icon={FileUp}
                    label="Import"
                    isActive={activeTab === 'import'}
                    onClick={() => setActiveTab('import')}
                />
                <TabButton
                    icon={Link2}
                    label="Fabric Mapping"
                    isActive={activeTab === 'fabricMapping'}
                    onClick={() => setActiveTab('fabricMapping')}
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
                {/* Products Tab - Dual Hierarchy View */}
                {activeTab === 'products' && (
                    <div className="flex-1 p-4 overflow-hidden">
                        <ProductsViewSwitcher
                            searchQuery={searchQuery}
                            onSearchChange={setSearchQuery}
                            onViewProduct={handleViewProduct}
                            onEditBom={handleEditBom}
                            initialData={loaderData?.productsTree}
                        />
                    </div>
                )}

                {/* Materials Tab - wrapped in ClientOnly to prevent hydration mismatch */}
                {activeTab === 'materials' && (
                    <div className="flex-1 overflow-hidden">
                        <ClientOnly fallback={
                            <div className="flex items-center justify-center h-full">
                                <Loader2 className="h-8 w-8 animate-spin text-gray-400" />
                            </div>
                        }>
                            <MaterialsTreeView
                                onViewDetails={() => {}}
                                onAddInward={() => {}}
                                onAddSupplier={() => {}}
                            />
                        </ClientOnly>
                    </div>
                )}

                {/* Trims Tab */}
                {activeTab === 'trims' && (
                    <div className="flex-1 p-4 overflow-auto">
                        <ClientOnly fallback={<div className="flex items-center justify-center h-32"><Loader2 className="h-6 w-6 animate-spin text-gray-400" /></div>}>
                            <TrimsTable
                                onEdit={() => {}}
                                onViewDetails={() => {}}
                                onAdd={() => {}}
                            />
                        </ClientOnly>
                    </div>
                )}

                {/* Services Tab */}
                {activeTab === 'services' && (
                    <div className="flex-1 p-4 overflow-auto">
                        <ClientOnly fallback={<div className="flex items-center justify-center h-32"><Loader2 className="h-6 w-6 animate-spin text-gray-400" /></div>}>
                            <ServicesTable
                                onEdit={() => {}}
                                onViewDetails={() => {}}
                                onAdd={() => {}}
                            />
                        </ClientOnly>
                    </div>
                )}

                {/* BOM Tab - 50/50 Split Layout */}
                {activeTab === 'bom' && (
                    <>
                        {/* Left Panel - Product List */}
                        <div className="w-1/2 border-r bg-white flex-shrink-0 overflow-hidden flex flex-col">
                            <BomProductList
                                onSelect={handleBomSelect}
                                selectedId={selectedNode?.id}
                                initialData={loaderData?.productsTree}
                            />
                        </div>

                        {/* Right Panel - Detail */}
                        <div className="w-1/2 overflow-hidden">
                            <DetailPanel
                                node={selectedNode}
                                onClose={handleCloseDetail}
                            />
                        </div>
                    </>
                )}

                {/* Consumption Tab - Spreadsheet Grid View */}
                {activeTab === 'consumption' && (
                    <div className="flex-1 overflow-hidden">
                        <ConsumptionGridView />
                    </div>
                )}

                {/* Import Tab - CSV Import with Mapping */}
                {activeTab === 'import' && (
                    <div className="flex-1 overflow-hidden">
                        <ConsumptionImportView />
                    </div>
                )}

                {/* Fabric Mapping Tab - Assign fabrics to variations */}
                {activeTab === 'fabricMapping' && (
                    <div className="flex-1 overflow-hidden">
                        <FabricMappingView />
                    </div>
                )}

                {/* Style Codes Tab - Quick view and edit style codes */}
                {activeTab === 'styleCodes' && (
                    <div className="flex-1 p-4 overflow-auto">
                        <StyleCodesTable />
                    </div>
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
                {activeTab === 'consumption' && (
                    <span>Click any cell to edit • Tab/Enter to navigate • Save to apply changes</span>
                )}
                {activeTab === 'import' && (
                    <span>Upload CSV • Map external names to internal products • Import consumption data</span>
                )}
                {activeTab === 'fabricMapping' && (
                    <span>Set Material/Fabric at product level • Select Colour per variation • Save to apply</span>
                )}
                {activeTab === 'styleCodes' && (
                    <span>Click any style code to edit inline • Press Enter to save, Escape to cancel</span>
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
