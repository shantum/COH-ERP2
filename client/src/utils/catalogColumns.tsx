/**
 * Catalog AG-Grid Column Definitions
 *
 * Column definitions for the Catalog page grid, organized by category:
 * - Product columns (image, name, style, category, gender, type)
 * - Variation columns (fabric type, color, lining, fabric)
 * - SKU columns (code, size)
 * - Pricing columns (MRP)
 * - Costing columns (consumption, fabric, labor, trims, lining, packaging, total)
 * - GST & Pricing (ex-GST, GST amount, cost multiple)
 * - Inventory columns (balance, reserved, available, shopify, target, status)
 * - Actions column
 */

import type { ColDef, ICellRendererParams, ValueFormatterParams, CellClassParams } from 'ag-grid-community';
import type { PermissionColDef } from '../hooks/usePermissionColumns';
import { InventoryStatusBadge } from '../components/common/grid';
import type { ViewLevel } from '../components/catalog/FabricEditPopover';
import { FabricDisplayCell } from '../components/catalog/FabricEditPopover';
import { getOptimizedImageUrl } from './imageOptimization';

// All column IDs in display order
export const ALL_COLUMN_IDS = [
    'image', 'productName', 'styleCode', 'category', 'gender', 'productType', 'fabricTypeName',
    'colorName', 'hasLining', 'fabricName',
    'skuCode', 'size', 'mrp', 'fabricConsumption', 'fabricCost', 'laborMinutes', 'laborCost', 'trimsCost', 'liningCost', 'packagingCost', 'totalCost',
    'exGstPrice', 'gstAmount', 'costMultiple',
    'currentBalance', 'reservedBalance', 'availableBalance', 'shopifyQty', 'targetStockQty', 'shopifyStatus', 'status',
    'actions'
];

// Default headers
export const DEFAULT_HEADERS: Record<string, string> = {
    productName: 'Product',
    styleCode: 'Style',
    category: 'Category',
    gender: 'Gender',
    productType: 'Type',
    fabricTypeName: 'Fabric Type',
    colorName: 'Color',
    hasLining: 'Lining',
    fabricName: 'Fabric',
    image: 'Img',
    skuCode: 'SKU Code',
    size: 'Size',
    mrp: 'MRP',
    fabricConsumption: 'Fab (m)',
    fabricCost: 'Fab ₹',
    laborMinutes: 'Labor (min)',
    laborCost: 'Labor ₹',
    trimsCost: 'Trims ₹',
    liningCost: 'Lin ₹',
    packagingCost: 'Pkg ₹',
    totalCost: 'Cost ₹',
    exGstPrice: 'Ex-GST',
    gstAmount: 'GST',
    costMultiple: 'Multiple',
    currentBalance: 'Balance',
    reservedBalance: 'Reserved',
    availableBalance: 'Available',
    shopifyQty: 'Shopify',
    targetStockQty: 'Target',
    shopifyStatus: 'Shop Status',
    status: 'Status',
    actions: '',
};

// Columns to hide for each view level
export const HIDDEN_COLUMNS_BY_VIEW: Record<ViewLevel, string[]> = {
    sku: [],
    variation: [],
    product: [],
    consumption: [], // Uses completely different columns
};

export interface CreateColumnDefsParams {
    viewLevel: ViewLevel;
    filterOptions?: any;
    catalogData?: any;
    // Legacy - no longer used since fabric editing moved to BOM
    uniqueFabricTypes?: Array<{ id: string; name: string }>;
    handleUpdateFabricType?: (productId: string, fabricTypeId: string | null, affectedCount: number) => void;
    handleUpdateFabric?: (variationId: string, fabricId: string, affectedCount: number) => void;
    promptLiningChange: (row: any) => void;
    openEditModal: (row: any, level: 'sku' | 'variation' | 'product') => void;
    openBomEditor?: (row: any) => void;
    setFilter: React.Dispatch<React.SetStateAction<any>>;
    setViewLevel: (level: ViewLevel) => void;
    // Legacy - FabricEditPopover no longer used, fabric is read-only
    FabricEditPopover?: React.ComponentType<any>;
}

/**
 * Creates AG-Grid column definitions for the catalog grid.
 */
export function createColumnDefs({
    viewLevel,
    promptLiningChange,
    openEditModal,
    openBomEditor,
    setFilter,
    setViewLevel,
}: CreateColumnDefsParams): PermissionColDef[] {
    return [
        // Image column - first for visual identification
        {
            colId: 'image',
            headerName: DEFAULT_HEADERS.image,
            field: 'imageUrl',
            width: 50,
            pinned: 'left' as const,
            cellRenderer: (params: ICellRendererParams) => {
                if (!params.value) return <div className="w-8 h-8 bg-gray-100 rounded flex items-center justify-center text-gray-300 text-xs">-</div>;
                return (
                    <img
                        src={getOptimizedImageUrl(params.value, 'xs') || params.value}
                        alt=""
                        className="w-8 h-8 object-cover rounded"
                        loading="lazy"
                    />
                );
            },
        },
        // Product columns
        {
            colId: 'productName',
            headerName: DEFAULT_HEADERS.productName,
            field: 'productName',
            width: 180,
            pinned: 'left' as const,
            cellRenderer: (params: ICellRendererParams) => {
                const row = params.data;
                if (!row) return null;
                // Clickable in product view to drill down to colors
                if (viewLevel === 'product') {
                    return (
                        <button
                            onClick={() => {
                                setFilter((f: any) => ({ ...f, productId: row.productId, variationId: '', colorName: '' }));
                                setViewLevel('variation');
                            }}
                            className="font-medium text-left text-blue-600 hover:text-blue-800 hover:underline truncate w-full"
                            title={`View colors for ${row.productName}`}
                        >
                            {row.productName}
                        </button>
                    );
                }
                // In variation view, clicking product name drills to that color's SKUs
                if (viewLevel === 'variation') {
                    return (
                        <button
                            onClick={() => {
                                setFilter((f: any) => ({
                                    ...f,
                                    productId: row.productId,
                                    variationId: row.variationId,
                                    colorName: row.colorName,
                                }));
                                setViewLevel('sku');
                            }}
                            className="font-medium text-left text-blue-600 hover:text-blue-800 hover:underline truncate w-full"
                            title={`View SKUs for ${row.productName} - ${row.colorName}`}
                        >
                            {row.productName}
                        </button>
                    );
                }
                return <span className="font-medium truncate">{row.productName}</span>;
            },
        },
        {
            colId: 'styleCode',
            headerName: DEFAULT_HEADERS.styleCode,
            field: 'styleCode',
            width: 70,
            cellClass: 'text-xs text-gray-500 font-mono',
        },
        {
            colId: 'category',
            headerName: DEFAULT_HEADERS.category,
            field: 'category',
            width: 90,
            cellClass: 'capitalize',
        },
        {
            colId: 'gender',
            headerName: DEFAULT_HEADERS.gender,
            field: 'gender',
            width: 70,
            cellClass: 'capitalize',
        },
        {
            colId: 'productType',
            headerName: DEFAULT_HEADERS.productType,
            field: 'productType',
            width: 80,
            cellClass: 'capitalize text-xs',
        },
        {
            colId: 'fabricTypeName',
            headerName: DEFAULT_HEADERS.fabricTypeName,
            width: 120,
            // Material name derived from BOM fabric colour
            valueGetter: (params: any) => {
                const row = params.data;
                if (!row) return '';
                return row.fabricTypeName || row.materialName || '';
            },
            filter: 'agTextColumnFilter',
            floatingFilter: true,
            cellRenderer: (params: ICellRendererParams) => {
                const row = params.data;
                if (!row) return null;
                return (
                    <FabricDisplayCell
                        row={row}
                        viewLevel={viewLevel}
                        columnType="fabricType"
                    />
                );
            },
        },
        // Variation columns
        {
            colId: 'colorName',
            headerName: DEFAULT_HEADERS.colorName,
            field: 'colorName',
            width: 110,
        },
        {
            colId: 'hasLining',
            headerName: DEFAULT_HEADERS.hasLining,
            field: 'hasLining',
            width: 65,
            cellRenderer: (params: ICellRendererParams) => {
                const row = params.data;
                if (!row || viewLevel === 'product') return null;
                return (
                    <button
                        onClick={() => promptLiningChange(row)}
                        className={`text-xs px-1.5 py-0.5 rounded transition-colors ${
                            row.hasLining
                                ? 'bg-green-100 text-green-700 hover:bg-green-200'
                                : 'bg-gray-100 text-gray-500 hover:bg-gray-200'
                        }`}
                        title={row.hasLining ? 'Has lining - click to remove' : 'No lining - click to add'}
                    >
                        {row.hasLining ? 'Yes' : 'No'}
                    </button>
                );
            },
        },
        {
            colId: 'fabricName',
            headerName: DEFAULT_HEADERS.fabricName,
            width: 140,
            // Fabric colour name derived from BOM
            valueGetter: (params: any) => {
                const row = params.data;
                if (!row) return '';
                return row.fabricName || row.fabricColourName || '';
            },
            filter: 'agTextColumnFilter',
            floatingFilter: true,
            cellRenderer: (params: ICellRendererParams) => {
                const row = params.data;
                if (!row) return null;
                // Read-only display - fabric is now set via BOM Editor
                return (
                    <FabricDisplayCell
                        row={row}
                        viewLevel={viewLevel}
                        columnType="fabric"
                    />
                );
            },
        },
        // SKU columns
        {
            colId: 'skuCode',
            headerName: DEFAULT_HEADERS.skuCode,
            field: 'skuCode',
            width: 130,
            cellClass: 'text-xs font-mono',
        },
        {
            colId: 'size',
            headerName: DEFAULT_HEADERS.size,
            field: 'size',
            width: 55,
            cellClass: 'text-center font-medium',
        },
        {
            colId: 'mrp',
            headerName: DEFAULT_HEADERS.mrp,
            field: 'mrp',
            width: 70,
            valueFormatter: (params: ValueFormatterParams) =>
                params.value != null ? `₹${params.value.toLocaleString()}` : '-',
            cellClass: 'text-right',
        },
        {
            colId: 'fabricConsumption',
            headerName: DEFAULT_HEADERS.fabricConsumption,
            field: 'fabricConsumption',
            width: 65,
            viewPermission: 'products:view:consumption',
            editPermission: 'products:edit:consumption',
            editable: () => viewLevel !== 'consumption', // Editable in all views except consumption matrix
            valueFormatter: (params: ValueFormatterParams) =>
                params.value != null ? params.value.toFixed(2) : '-',
            cellClass: 'text-right text-xs cursor-pointer hover:bg-blue-50',
            cellStyle: { backgroundColor: '#f0f9ff' }, // Light blue for editable
        },
        {
            colId: 'fabricCost',
            headerName: DEFAULT_HEADERS.fabricCost,
            field: 'fabricCost',
            width: 70,
            viewPermission: 'products:view:cost',
            valueFormatter: (params: ValueFormatterParams) =>
                params.value != null ? `₹${Number(params.value).toFixed(0)}` : '-',
            cellClass: 'text-right text-xs text-blue-600',
        },
        {
            colId: 'laborMinutes',
            headerName: DEFAULT_HEADERS.laborMinutes,
            field: 'laborMinutes',
            width: 75,
            viewPermission: 'products:view:cost',
            editPermission: 'products:edit:cost',
            editable: true,
            valueFormatter: (params: ValueFormatterParams) =>
                params.value != null ? params.value.toFixed(0) : '-',
            cellClass: 'text-right text-xs cursor-pointer hover:bg-blue-50',
            cellStyle: { backgroundColor: '#f0f9ff' }, // Light blue for editable
        },
        {
            colId: 'laborCost',
            headerName: DEFAULT_HEADERS.laborCost,
            field: 'laborCost',
            width: 70,
            viewPermission: 'products:view:cost',
            valueFormatter: (params: ValueFormatterParams) =>
                params.value != null ? `₹${Number(params.value).toFixed(0)}` : '-',
            cellClass: 'text-right text-xs text-purple-600',
        },
        {
            colId: 'trimsCost',
            headerName: DEFAULT_HEADERS.trimsCost,
            field: 'trimsCost',
            width: 70,
            viewPermission: 'products:view:cost',
            editPermission: 'products:edit:cost',
            editable: true,
            valueFormatter: (params: ValueFormatterParams) =>
                params.value != null ? `₹${Number(params.value).toFixed(0)}` : '-',
            cellClass: 'text-right text-xs cursor-pointer hover:bg-blue-50',
            cellStyle: { backgroundColor: '#f0f9ff' }, // Light blue for editable
        },
        {
            colId: 'liningCost',
            headerName: DEFAULT_HEADERS.liningCost,
            field: 'liningCost',
            width: 65,
            viewPermission: 'products:view:cost',
            editPermission: 'products:edit:cost',
            editable: (params: any) => params.data?.hasLining === true, // Only editable if hasLining
            valueFormatter: (params: ValueFormatterParams) => {
                // Show "-" if no lining
                if (!params.data?.hasLining) return '-';
                return params.value != null ? `₹${Number(params.value).toFixed(0)}` : '-';
            },
            cellClass: (params: CellClassParams) => {
                if (!params.data?.hasLining) return 'text-right text-xs text-gray-300';
                return 'text-right text-xs cursor-pointer hover:bg-blue-50';
            },
            cellStyle: (params: any) => params.data?.hasLining ? { backgroundColor: '#f0f9ff' } : undefined,
        },
        {
            colId: 'packagingCost',
            headerName: DEFAULT_HEADERS.packagingCost,
            field: 'packagingCost',
            width: 65,
            viewPermission: 'products:view:cost',
            editPermission: 'products:edit:cost',
            editable: true,
            valueFormatter: (params: ValueFormatterParams) =>
                params.value != null ? `₹${Number(params.value).toFixed(0)}` : '-',
            cellClass: 'text-right text-xs cursor-pointer hover:bg-blue-50',
            cellStyle: { backgroundColor: '#f0f9ff' }, // Light blue for editable
        },
        {
            colId: 'totalCost',
            headerName: DEFAULT_HEADERS.totalCost,
            field: 'totalCost',
            width: 70,
            viewPermission: 'products:view:cost',
            valueFormatter: (params: ValueFormatterParams) =>
                params.value != null ? `₹${Number(params.value).toFixed(0)}` : '-',
            cellClass: 'text-right text-xs font-medium text-emerald-700',
        },
        // GST & Pricing columns
        {
            colId: 'exGstPrice',
            headerName: DEFAULT_HEADERS.exGstPrice,
            field: 'exGstPrice',
            width: 75,
            viewPermission: 'products:view:cost',
            valueFormatter: (params: ValueFormatterParams) =>
                params.value != null ? `₹${Number(params.value).toFixed(0)}` : '-',
            cellClass: 'text-right text-xs',
        },
        {
            colId: 'gstAmount',
            headerName: DEFAULT_HEADERS.gstAmount,
            field: 'gstAmount',
            width: 65,
            viewPermission: 'products:view:cost',
            valueFormatter: (params: ValueFormatterParams) => {
                if (params.value == null) return '-';
                const rate = params.data?.gstRate || 0;
                return `₹${Number(params.value).toFixed(0)} (${rate}%)`;
            },
            cellClass: 'text-right text-xs text-gray-600',
        },
        {
            colId: 'costMultiple',
            headerName: DEFAULT_HEADERS.costMultiple,
            field: 'costMultiple',
            width: 70,
            viewPermission: 'products:view:cost',
            valueFormatter: (params: ValueFormatterParams) =>
                params.value != null ? `${Number(params.value).toFixed(1)}x` : '-',
            cellClass: (params: CellClassParams) => {
                const val = params.value || 0;
                if (val >= 3) return 'text-right text-xs font-medium text-green-600';
                if (val >= 2) return 'text-right text-xs font-medium text-amber-600';
                return 'text-right text-xs font-medium text-red-600';
            },
        },
        // Inventory columns
        {
            colId: 'currentBalance',
            headerName: DEFAULT_HEADERS.currentBalance,
            field: 'currentBalance',
            width: 70,
            cellClass: (params: CellClassParams) => {
                const val = params.value || 0;
                if (val === 0) return 'text-right text-gray-400';
                return 'text-right font-medium';
            },
        },
        {
            colId: 'reservedBalance',
            headerName: DEFAULT_HEADERS.reservedBalance,
            field: 'reservedBalance',
            width: 70,
            cellClass: (params: CellClassParams) => {
                const val = params.value || 0;
                if (val === 0) return 'text-right text-gray-300';
                return 'text-right text-amber-600';
            },
        },
        {
            colId: 'availableBalance',
            headerName: DEFAULT_HEADERS.availableBalance,
            field: 'availableBalance',
            width: 75,
            cellClass: (params: CellClassParams) => {
                const val = params.value || 0;
                if (val === 0) return 'text-right text-red-400 font-medium';
                if (val < (params.data?.targetStockQty || 0)) return 'text-right text-amber-600 font-medium';
                return 'text-right text-green-600 font-medium';
            },
        },
        {
            colId: 'shopifyQty',
            headerName: DEFAULT_HEADERS.shopifyQty,
            field: 'shopifyQty',
            width: 70,
            valueFormatter: (params: ValueFormatterParams) =>
                params.value != null ? params.value : '-',
            cellClass: 'text-right text-xs text-blue-600',
        },
        {
            colId: 'targetStockQty',
            headerName: DEFAULT_HEADERS.targetStockQty,
            field: 'targetStockQty',
            width: 60,
            cellClass: 'text-right text-xs text-gray-500',
        },
        {
            colId: 'shopifyStatus',
            headerName: DEFAULT_HEADERS.shopifyStatus,
            field: 'shopifyStatus',
            width: 100,
            filter: 'agTextColumnFilter',
            floatingFilter: true,
            cellRenderer: (params: ICellRendererParams) => {
                const status = params.value;
                if (!status || status === 'not_linked') return <span className="text-xs text-gray-300">-</span>;
                const statusStyles: Record<string, string> = {
                    active: 'bg-green-100 text-green-700',
                    draft: 'bg-yellow-100 text-yellow-700',
                    archived: 'bg-gray-200 text-gray-600',
                    not_cached: 'bg-gray-100 text-gray-400',
                    unknown: 'bg-gray-100 text-gray-400',
                };
                return (
                    <span className={`text-xs px-1.5 py-0.5 rounded capitalize ${statusStyles[status] || statusStyles.unknown}`}>
                        {status.replace('_', ' ')}
                    </span>
                );
            },
        },
        {
            colId: 'status',
            headerName: DEFAULT_HEADERS.status,
            field: 'status',
            width: 70,
            cellRenderer: (params: ICellRendererParams) => (
                <InventoryStatusBadge status={params.value} />
            ),
        },
        // Actions
        {
            colId: 'actions',
            headerName: '',
            width: 110,
            pinned: 'right' as const,
            sortable: false,
            cellRenderer: (params: ICellRendererParams) => {
                const row = params.data;
                if (!row) return null;
                // Determine edit level based on current view
                const editLevel = viewLevel === 'product' ? 'product' : viewLevel === 'variation' ? 'variation' : 'sku';
                return (
                    <div className="flex items-center gap-1">
                        <button
                            onClick={() => openEditModal(row, editLevel)}
                            className="p-1 rounded hover:bg-blue-100 text-blue-500 hover:text-blue-700"
                            title={`Edit ${editLevel}`}
                        >
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                                <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
                            </svg>
                        </button>
                        {openBomEditor && (viewLevel === 'product' || viewLevel === 'variation') && (
                            <button
                                onClick={() => openBomEditor(row)}
                                className="p-1 rounded hover:bg-purple-100 text-purple-500 hover:text-purple-700"
                                title="Edit BOM"
                            >
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                    <rect x="3" y="3" width="7" height="7" rx="1" />
                                    <rect x="14" y="3" width="7" height="7" rx="1" />
                                    <rect x="14" y="14" width="7" height="7" rx="1" />
                                    <rect x="3" y="14" width="7" height="7" rx="1" />
                                </svg>
                            </button>
                        )}
                        <button
                            onClick={() => {
                                // TODO: Open quick inward modal
                                console.log('Add inward:', row.skuCode);
                            }}
                            className="p-1 rounded hover:bg-green-100 text-green-500 hover:text-green-700"
                            title="Add inward"
                        >
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                <line x1="12" y1="5" x2="12" y2="19" />
                                <line x1="5" y1="12" x2="19" y2="12" />
                            </svg>
                        </button>
                    </div>
                );
            },
        },
    ];
}

/**
 * Creates consumption matrix column definitions.
 */
export function createConsumptionColumnDefs(CONSUMPTION_SIZES: string[]): ColDef[] {
    return [
        {
            colId: 'productName',
            headerName: 'Product',
            field: 'productName',
            width: 200,
            pinned: 'left' as const,
            cellClass: 'font-medium',
        },
        {
            colId: 'styleCode',
            headerName: 'Style',
            field: 'styleCode',
            width: 80,
            cellClass: 'text-xs text-gray-500 font-mono',
        },
        {
            colId: 'category',
            headerName: 'Category',
            field: 'category',
            width: 90,
            cellClass: 'capitalize',
        },
        // Size columns with editable consumption values
        ...CONSUMPTION_SIZES.map(size => ({
            colId: `consumption_${size}`,
            headerName: size,
            field: `consumption_${size}`,
            width: 65,
            editable: (params: any) => {
                // Only editable if there are SKUs for this size
                const skuIds = params.data?.[`skuIds_${size}`] || [];
                return skuIds.length > 0;
            },
            cellClass: (params: any) => {
                const skuIds = params.data?.[`skuIds_${size}`] || [];
                if (skuIds.length === 0) return 'text-center text-gray-300';
                return 'text-right text-xs cursor-pointer hover:bg-blue-50';
            },
            valueFormatter: (params: ValueFormatterParams) => {
                const skuIds = params.data?.[`skuIds_${params.colDef.field?.replace('consumption_', '')}`] || [];
                if (skuIds.length === 0) return '-';
                return params.value != null ? Number(params.value).toFixed(2) : '1.50';
            },
            valueParser: (params: any) => {
                const val = parseFloat(params.newValue);
                return isNaN(val) ? params.oldValue : val;
            },
            cellStyle: (params: any) => {
                const skuIds = params.data?.[`skuIds_${size}`] || [];
                if (skuIds.length === 0) return { backgroundColor: '#f9fafb' };
                return { backgroundColor: '#f0f9ff' }; // Light blue for editable
            },
        })),
    ];
}
