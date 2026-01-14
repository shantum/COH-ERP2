/**
 * Fabrics page - Flat AG-Grid table with all fabric data
 * One row per fabric color showing type, supplier, stock, and analysis
 */

import { useState, useMemo, useRef, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { AgGridReact } from 'ag-grid-react';
import type { ColDef, ICellRendererParams, ValueFormatterParams, CellClassParams } from 'ag-grid-community';
import { AllCommunityModule, ModuleRegistry } from 'ag-grid-community';
import { Search, Eye, Package, Plus, Users, AlertTriangle, X, Trash2, Pencil, ArrowDownCircle, ArrowUpCircle, Save } from 'lucide-react';
import { fabricsApi } from '../services/api';
import { useAuth } from '../hooks/useAuth';
import { compactThemeSmall } from '../utils/agGridHelpers';
import { ColumnVisibilityDropdown, FabricStatusBadge } from '../components/common/grid';
import { useGridState, getColumnOrderFromApi, applyColumnVisibility, applyColumnWidths, orderColumns } from '../hooks/useGridState';

// Page size options
const PAGE_SIZE_OPTIONS = [100, 500, 1000, 0] as const;

// Register AG Grid modules
ModuleRegistry.registerModules([AllCommunityModule]);

// Color view column IDs in display order
const COLOR_COLUMN_IDS = [
    'fabricTypeName', 'composition', 'colorName', 'standardColor',
    'supplierName', 'costPerUnit', 'leadTimeDays', 'minOrderQty',
    'currentBalance', 'totalInward', 'totalOutward', 'sales7d', 'sales30d',
    'avgDailyConsumption', 'daysOfStock', 'reorderPoint', 'stockStatus',
    'suggestedOrderQty', 'actions'
];

// Type view column IDs in display order
const TYPE_COLUMN_IDS = [
    'fabricTypeName', 'composition', 'colorCount', 'productCount',
    'totalStock', 'sales7d', 'sales30d', 'consumption7d', 'consumption30d',
    'defaultCostPerUnit', 'unit', 'avgShrinkagePct', 'defaultLeadTimeDays',
    'defaultMinOrderQty', 'actions'
];

// Default headers for color view
const COLOR_HEADERS: Record<string, string> = {
    fabricTypeName: 'Fabric Type',
    composition: 'Composition',
    colorName: 'Color',
    standardColor: 'Std Color',
    supplierName: 'Supplier',
    costPerUnit: 'Cost/Unit',
    leadTimeDays: 'Lead (days)',
    minOrderQty: 'Min Order',
    currentBalance: 'Balance',
    totalInward: 'Total In',
    totalOutward: 'Total Out',
    sales7d: 'Sales (7d)',
    sales30d: 'Sales (30d)',
    avgDailyConsumption: 'Avg/Day',
    daysOfStock: 'Days Stock',
    reorderPoint: 'Reorder At',
    stockStatus: 'Status',
    suggestedOrderQty: 'Suggested Qty',
    actions: '',
};

// Default headers for type view
const TYPE_HEADERS: Record<string, string> = {
    fabricTypeName: 'Fabric Type',
    composition: 'Composition',
    colorCount: 'Colors',
    productCount: 'Products',
    totalStock: 'Stock',
    sales7d: 'Sales (7d)',
    sales30d: 'Sales (30d)',
    consumption7d: 'Use (7d)',
    consumption30d: 'Use (30d)',
    defaultCostPerUnit: 'Cost/Unit',
    unit: 'Unit',
    avgShrinkagePct: 'Shrink %',
    defaultLeadTimeDays: 'Lead (d)',
    defaultMinOrderQty: 'Min Qty',
    actions: '',
};

// Standard colors with predefined hex shades
const STANDARD_COLOR_HEX: Record<string, string> = {
    Red: '#DC2626',
    Orange: '#EA580C',
    Yellow: '#CA8A04',
    Green: '#16A34A',
    Blue: '#2563EB',
    Purple: '#9333EA',
    Pink: '#DB2777',
    Brown: '#92400E',
    Black: '#171717',
    White: '#FAFAFA',
    Grey: '#6B7280',
    Beige: '#D4B896',
    Navy: '#1E3A5F',
    Teal: '#0D9488',
};
const STANDARD_COLORS = Object.keys(STANDARD_COLOR_HEX);

export default function Fabrics() {
    const queryClient = useQueryClient();
    const { user } = useAuth();
    const isAdmin = user?.role === 'admin';
    const gridRef = useRef<AgGridReact>(null);

    // View level state (color = individual fabric colors, type = fabric types aggregated)
    // Must be declared before useGridState hooks since we use it to select the active state
    type ViewLevel = 'color' | 'type';
    const [viewLevel, setViewLevel] = useState<ViewLevel>('color');

    // Use separate grid state hooks for color and type views
    const colorGridState = useGridState({
        gridId: 'fabricsColorGrid',
        allColumnIds: COLOR_COLUMN_IDS,
        defaultPageSize: 100,
    });

    const typeGridState = useGridState({
        gridId: 'fabricsTypeGrid',
        allColumnIds: TYPE_COLUMN_IDS,
        defaultPageSize: 100,
    });

    // Select active grid state based on view level
    const {
        visibleColumns,
        columnOrder,
        columnWidths,
        pageSize,
        handleToggleColumn,
        handleResetAll,
        handleColumnMoved,
        handleColumnResized,
        handlePageSizeChange,
        isManager,
        hasUnsavedChanges,
        isSavingPrefs,
        savePreferencesToServer,
    } = viewLevel === 'type' ? typeGridState : colorGridState;

    // Filter state
    const [filter, setFilter] = useState({ fabricTypeId: '', status: '' });
    const [searchInput, setSearchInput] = useState('');

    // Modal states
    const [showAddType, setShowAddType] = useState(false);
    const [showAddColor, setShowAddColor] = useState<string | null>(null);
    const [showInward, setShowInward] = useState<any>(null);
    const [showAddSupplier, setShowAddSupplier] = useState(false);
    const [showDetail, setShowDetail] = useState<any>(null);
    const [showEditFabric, setShowEditFabric] = useState<any>(null);
    const [showEditType, setShowEditType] = useState<any>(null);

    // Form states
    const [typeForm, setTypeForm] = useState({ name: '', composition: '', unit: 'meter', avgShrinkagePct: 0, defaultCostPerUnit: '' as string | number, defaultLeadTimeDays: '' as string | number, defaultMinOrderQty: '' as string | number });
    const [colorForm, setColorForm] = useState({ colorName: '', standardColor: '', colorHex: '#6B8E9F', costPerUnit: '' as string | number, supplierId: '', leadTimeDays: '' as string | number, minOrderQty: '' as string | number });
    const [inwardForm, setInwardForm] = useState({ qty: 0, notes: '', costPerUnit: 0, supplierId: '' });
    const [supplierForm, setSupplierForm] = useState({ name: '', contactName: '', email: '', phone: '', address: '' });
    const [editForm, setEditForm] = useState({ colorName: '', standardColor: '', colorHex: '#6B8E9F', costPerUnit: '' as string | number, supplierId: '', leadTimeDays: '' as string | number, minOrderQty: '' as string | number });
    const [editTypeForm, setEditTypeForm] = useState({ name: '', composition: '', unit: 'meter', avgShrinkagePct: 0, defaultCostPerUnit: '' as string | number, defaultLeadTimeDays: '' as string | number, defaultMinOrderQty: '' as string | number });

    // Apply quick filter when search input changes
    useEffect(() => {
        const timer = setTimeout(() => {
            gridRef.current?.api?.setGridOption('quickFilterText', searchInput);
        }, 150);
        return () => clearTimeout(timer);
    }, [searchInput]);

    // Fetch flat fabric data (switches between color and type views)
    const { data: fabricData, isLoading } = useQuery({
        queryKey: ['fabricsFlat', filter.fabricTypeId, filter.status, viewLevel],
        queryFn: () => fabricsApi.getFlat({
            fabricTypeId: filter.fabricTypeId || undefined,
            status: filter.status || undefined,
            view: viewLevel,
        }).then(r => r.data),
    });

    // Fetch filter options
    const { data: filterOptions } = useQuery({
        queryKey: ['fabricFilters'],
        queryFn: () => fabricsApi.getFilters().then(r => r.data),
        staleTime: 5 * 60 * 1000,
    });

    // Fetch suppliers for forms
    const { data: suppliers } = useQuery({
        queryKey: ['suppliers'],
        queryFn: () => fabricsApi.getSuppliers().then(r => r.data),
    });

    // Fetch transactions when detail view is open
    const { data: transactions, isLoading: txnLoading } = useQuery({
        queryKey: ['fabricTransactions', showDetail?.fabricId],
        queryFn: () => fabricsApi.getTransactions(showDetail.fabricId).then(r => r.data),
        enabled: !!showDetail?.fabricId,
    });

    // Mutations
    const createType = useMutation({
        mutationFn: (data: any) => fabricsApi.createType(data),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['fabricTypes'] });
            queryClient.invalidateQueries({ queryKey: ['fabricsFlat'] });
            queryClient.invalidateQueries({ queryKey: ['fabricFilters'] });
            setShowAddType(false);
            setTypeForm({ name: '', composition: '', unit: 'meter', avgShrinkagePct: 0, defaultCostPerUnit: '', defaultLeadTimeDays: '', defaultMinOrderQty: '' });
        },
        onError: (err: any) => alert(err.response?.data?.error || 'Failed to create fabric type'),
    });

    const updateType = useMutation({
        mutationFn: ({ id, data }: { id: string; data: any }) => fabricsApi.updateType(id, data),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['fabricTypes'] });
            queryClient.invalidateQueries({ queryKey: ['fabricsFlat'] });
            setShowEditType(null);
        },
        onError: (err: any) => alert(err.response?.data?.error || 'Failed to update fabric type'),
    });

    const createFabric = useMutation({
        mutationFn: (data: any) => fabricsApi.create(data),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['fabricsFlat'] });
            queryClient.invalidateQueries({ queryKey: ['fabricFilters'] });
            setShowAddColor(null);
            setColorForm({ colorName: '', standardColor: '', colorHex: '#6B8E9F', costPerUnit: '', supplierId: '', leadTimeDays: '', minOrderQty: '' });
        },
        onError: (err: any) => alert(err.response?.data?.error || 'Failed to create fabric'),
    });

    const createInward = useMutation({
        mutationFn: ({ fabricId, data }: { fabricId: string; data: any }) => fabricsApi.createTransaction(fabricId, data),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['fabricsFlat'] });
            setShowInward(null);
            setInwardForm({ qty: 0, notes: '', costPerUnit: 0, supplierId: '' });
        },
        onError: (err: any) => alert(err.response?.data?.error || 'Failed to record inward'),
    });

    const createSupplier = useMutation({
        mutationFn: (data: any) => fabricsApi.createSupplier(data),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['suppliers'] });
            queryClient.invalidateQueries({ queryKey: ['fabricFilters'] });
            setShowAddSupplier(false);
            setSupplierForm({ name: '', contactName: '', email: '', phone: '', address: '' });
        },
        onError: (err: any) => alert(err.response?.data?.error || 'Failed to create supplier'),
    });

    const deleteTransaction = useMutation({
        mutationFn: (txnId: string) => fabricsApi.deleteTransaction(txnId),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['fabricTransactions', showDetail?.fabricId] });
            queryClient.invalidateQueries({ queryKey: ['fabricsFlat'] });
        },
        onError: (err: any) => alert(err.response?.data?.error || 'Failed to delete transaction'),
    });

    const deleteFabric = useMutation({
        mutationFn: (fabricId: string) => fabricsApi.delete(fabricId),
        onSuccess: (response: any) => {
            queryClient.invalidateQueries({ queryKey: ['fabricsFlat'] });
            queryClient.invalidateQueries({ queryKey: ['fabricFilters'] });
            queryClient.invalidateQueries({ queryKey: ['fabricTypes'] });
            const messages: string[] = [];
            if (response.data.variationsReassigned > 0) {
                messages.push(`${response.data.variationsReassigned} product variation(s) reassigned to default fabric`);
            }
            if (response.data.fabricTypeDeleted) {
                messages.push('Fabric type also deleted (no remaining colors)');
            }
            if (messages.length > 0) {
                alert(`Fabric deleted.\n\n${messages.join('\n')}`);
            }
        },
        onError: (err: any) => alert(err.response?.data?.error || 'Failed to delete fabric'),
    });

    const updateFabric = useMutation({
        mutationFn: ({ fabricId, data }: { fabricId: string; data: any }) => fabricsApi.update(fabricId, data),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['fabricsFlat'] });
            setShowEditFabric(null);
        },
        onError: (err: any) => alert(err.response?.data?.error || 'Failed to update fabric'),
    });

    // Grid column moved handler
    const onColumnMoved = () => {
        const api = gridRef.current?.api;
        if (api) {
            handleColumnMoved(getColumnOrderFromApi(api));
        }
    };

    // Handle column resize - save width when user finishes resizing
    const onColumnResized = (event: any) => {
        if (event.finished && event.columns?.length) {
            event.columns.forEach((col: any) => {
                const colId = col.getColId();
                const width = col.getActualWidth();
                if (colId && width) {
                    handleColumnResized(colId, width);
                }
            });
        }
    };

    const handleSubmitType = (e: React.FormEvent) => {
        e.preventDefault();
        createType.mutate({
            name: typeForm.name,
            composition: typeForm.composition,
            unit: typeForm.unit,
            avgShrinkagePct: typeForm.avgShrinkagePct,
            defaultCostPerUnit: typeForm.defaultCostPerUnit !== '' ? Number(typeForm.defaultCostPerUnit) : null,
            defaultLeadTimeDays: typeForm.defaultLeadTimeDays !== '' ? Number(typeForm.defaultLeadTimeDays) : null,
            defaultMinOrderQty: typeForm.defaultMinOrderQty !== '' ? Number(typeForm.defaultMinOrderQty) : null,
        });
    };

    const handleOpenEditType = (row: any) => {
        setEditTypeForm({
            name: row.fabricTypeName || '',
            composition: row.composition || '',
            unit: row.unit || 'meter',
            avgShrinkagePct: row.avgShrinkagePct || 0,
            defaultCostPerUnit: row.defaultCostPerUnit ?? '',
            defaultLeadTimeDays: row.defaultLeadTimeDays ?? '',
            defaultMinOrderQty: row.defaultMinOrderQty ?? '',
        });
        setShowEditType(row);
    };

    const handleSubmitEditType = (e: React.FormEvent) => {
        e.preventDefault();
        if (!showEditType) return;
        updateType.mutate({
            id: showEditType.fabricTypeId,
            data: {
                name: editTypeForm.name,
                composition: editTypeForm.composition,
                unit: editTypeForm.unit,
                avgShrinkagePct: editTypeForm.avgShrinkagePct,
                defaultCostPerUnit: editTypeForm.defaultCostPerUnit !== '' ? Number(editTypeForm.defaultCostPerUnit) : null,
                defaultLeadTimeDays: editTypeForm.defaultLeadTimeDays !== '' ? Number(editTypeForm.defaultLeadTimeDays) : null,
                defaultMinOrderQty: editTypeForm.defaultMinOrderQty !== '' ? Number(editTypeForm.defaultMinOrderQty) : null,
            },
        });
    };

    const handleSubmitColor = (e: React.FormEvent) => {
        e.preventDefault();
        if (!showAddColor) return;
        const fabricType = filterOptions?.fabricTypes?.find((t: any) => t.id === showAddColor);
        createFabric.mutate({
            fabricTypeId: showAddColor,
            name: `${fabricType?.name || 'Fabric'} - ${colorForm.colorName}`,
            colorName: colorForm.colorName,
            standardColor: colorForm.standardColor || null,
            colorHex: colorForm.colorHex,
            costPerUnit: colorForm.costPerUnit,
            supplierId: colorForm.supplierId || null,
            leadTimeDays: colorForm.leadTimeDays,
            minOrderQty: colorForm.minOrderQty,
        });
    };

    const handleSubmitInward = (e: React.FormEvent) => {
        e.preventDefault();
        if (!showInward) return;
        createInward.mutate({
            fabricId: showInward.fabricId,
            data: {
                txnType: 'inward',
                qty: inwardForm.qty,
                unit: showInward.unit || 'meter',
                reason: 'supplier_receipt',
                notes: inwardForm.notes,
                costPerUnit: inwardForm.costPerUnit || null,
                supplierId: inwardForm.supplierId || null,
            },
        });
    };

    const handleSubmitSupplier = (e: React.FormEvent) => {
        e.preventDefault();
        createSupplier.mutate(supplierForm);
    };

    const handleOpenEdit = (row: any) => {
        // Use raw values from row - null/undefined means inherit from type
        setEditForm({
            colorName: row.colorName || '',
            standardColor: row.standardColor || '',
            colorHex: row.colorHex || '#6B8E9F',
            costPerUnit: row.costPerUnit ?? '',  // Empty string = inherit
            supplierId: row.supplierId || '',
            leadTimeDays: row.leadTimeDays ?? '',  // Empty string = inherit
            minOrderQty: row.minOrderQty ?? '',  // Empty string = inherit
        });
        setShowEditFabric(row);
    };

    const handleSubmitEdit = (e: React.FormEvent) => {
        e.preventDefault();
        if (!showEditFabric) return;
        updateFabric.mutate({
            fabricId: showEditFabric.fabricId,
            data: {
                colorName: editForm.colorName,
                standardColor: editForm.standardColor || null,
                colorHex: editForm.colorHex,
                // Empty string = inherit from type (sends null to backend)
                costPerUnit: editForm.costPerUnit === '' ? null : editForm.costPerUnit,
                supplierId: editForm.supplierId || null,
                leadTimeDays: editForm.leadTimeDays === '' ? null : editForm.leadTimeDays,
                minOrderQty: editForm.minOrderQty === '' ? null : editForm.minOrderQty,
            },
        });
    };

    // Column definitions
    const columnDefs: ColDef[] = useMemo(() => [
        {
            colId: 'fabricTypeName',
            headerName: COLOR_HEADERS.fabricTypeName,
            field: 'fabricTypeName',
            width: 130,
            pinned: 'left' as const,
            cellClass: 'font-medium',
        },
        {
            colId: 'composition',
            headerName: COLOR_HEADERS.composition,
            field: 'composition',
            width: 100,
            cellClass: 'text-xs text-gray-600',
        },
        {
            colId: 'colorName',
            headerName: COLOR_HEADERS.colorName,
            field: 'colorName',
            width: 140,
            cellRenderer: (params: ICellRendererParams) => {
                const { colorHex, colorName } = params.data || {};
                return (
                    <div className="flex items-center gap-2">
                        <div
                            className="w-4 h-4 rounded-full border border-gray-300 flex-shrink-0"
                            style={{ backgroundColor: colorHex || '#ccc' }}
                        />
                        <span className="truncate">{colorName}</span>
                    </div>
                );
            },
        },
        {
            colId: 'standardColor',
            headerName: COLOR_HEADERS.standardColor,
            field: 'standardColor',
            width: 80,
            cellClass: 'text-xs text-gray-500',
        },
        {
            colId: 'supplierName',
            headerName: COLOR_HEADERS.supplierName,
            field: 'supplierName',
            width: 110,
            cellClass: 'text-xs',
            valueFormatter: (params: ValueFormatterParams) => params.value || '-',
        },
        {
            colId: 'costPerUnit',
            headerName: COLOR_HEADERS.costPerUnit,
            field: 'effectiveCostPerUnit',
            width: 95,
            cellRenderer: (params: ICellRendererParams) => {
                const { effectiveCostPerUnit, costInherited } = params.data || {};
                if (effectiveCostPerUnit == null) return '-';
                return (
                    <div className="flex items-center justify-end gap-1">
                        <span>₹{effectiveCostPerUnit}</span>
                        {costInherited && <span className="text-gray-400 text-[10px]" title="Inherited from type">↑</span>}
                    </div>
                );
            },
        },
        {
            colId: 'leadTimeDays',
            headerName: COLOR_HEADERS.leadTimeDays,
            field: 'effectiveLeadTimeDays',
            width: 95,
            cellRenderer: (params: ICellRendererParams) => {
                const { effectiveLeadTimeDays, leadTimeInherited } = params.data || {};
                if (effectiveLeadTimeDays == null) return '-';
                return (
                    <div className="flex items-center justify-end gap-1 text-xs">
                        <span>{effectiveLeadTimeDays}</span>
                        {leadTimeInherited && <span className="text-gray-400 text-[10px]" title="Inherited from type">↑</span>}
                    </div>
                );
            },
        },
        {
            colId: 'minOrderQty',
            headerName: COLOR_HEADERS.minOrderQty,
            field: 'effectiveMinOrderQty',
            width: 95,
            cellRenderer: (params: ICellRendererParams) => {
                const { effectiveMinOrderQty, minOrderInherited } = params.data || {};
                if (effectiveMinOrderQty == null) return '-';
                return (
                    <div className="flex items-center justify-end gap-1 text-xs">
                        <span>{effectiveMinOrderQty}</span>
                        {minOrderInherited && <span className="text-gray-400 text-[10px]" title="Inherited from type">↑</span>}
                    </div>
                );
            },
        },
        {
            colId: 'currentBalance',
            headerName: COLOR_HEADERS.currentBalance,
            field: 'currentBalance',
            width: 80,
            valueFormatter: (params: ValueFormatterParams) => {
                const val = params.value || 0;
                const unit = params.data?.unit === 'kg' ? 'kg' : 'm';
                return `${val.toFixed(1)} ${unit}`;
            },
            cellClass: (params: CellClassParams) => {
                const val = params.value || 0;
                if (val === 0) return 'text-right text-gray-400';
                return 'text-right font-medium';
            },
        },
        {
            colId: 'totalInward',
            headerName: COLOR_HEADERS.totalInward,
            field: 'totalInward',
            width: 75,
            valueFormatter: (params: ValueFormatterParams) =>
                params.value != null ? params.value.toFixed(1) : '0',
            cellClass: 'text-right text-green-600 text-xs',
        },
        {
            colId: 'totalOutward',
            headerName: COLOR_HEADERS.totalOutward,
            field: 'totalOutward',
            width: 75,
            valueFormatter: (params: ValueFormatterParams) =>
                params.value != null ? params.value.toFixed(1) : '0',
            cellClass: 'text-right text-red-600 text-xs',
        },
        {
            colId: 'sales7d',
            headerName: COLOR_HEADERS.sales7d,
            field: 'sales7d',
            width: 95,
            cellClass: 'text-right text-xs font-medium text-green-600',
            valueFormatter: (params: ValueFormatterParams) => {
                if (params.value == null || params.value === 0) return '-';
                return `₹${params.value.toLocaleString()}`;
            },
        },
        {
            colId: 'sales30d',
            headerName: COLOR_HEADERS.sales30d,
            field: 'sales30d',
            width: 100,
            cellClass: 'text-right text-xs font-medium text-green-600',
            valueFormatter: (params: ValueFormatterParams) => {
                if (params.value == null || params.value === 0) return '-';
                return `₹${params.value.toLocaleString()}`;
            },
        },
        {
            colId: 'avgDailyConsumption',
            headerName: COLOR_HEADERS.avgDailyConsumption,
            field: 'avgDailyConsumption',
            width: 70,
            valueFormatter: (params: ValueFormatterParams) =>
                params.value != null ? params.value.toFixed(2) : '-',
            cellClass: 'text-right text-xs text-gray-500',
        },
        {
            colId: 'daysOfStock',
            headerName: COLOR_HEADERS.daysOfStock,
            field: 'daysOfStock',
            width: 80,
            valueFormatter: (params: ValueFormatterParams) =>
                params.value != null ? `${params.value}d` : '-',
            cellClass: (params: CellClassParams) => {
                const days = params.value;
                if (days == null) return 'text-right text-xs';
                if (days <= 7) return 'text-right text-xs text-red-600 font-medium';
                if (days <= 14) return 'text-right text-xs text-yellow-600';
                return 'text-right text-xs text-green-600';
            },
        },
        {
            colId: 'reorderPoint',
            headerName: COLOR_HEADERS.reorderPoint,
            field: 'reorderPoint',
            width: 80,
            valueFormatter: (params: ValueFormatterParams) =>
                params.value != null ? params.value.toFixed(1) : '-',
            cellClass: 'text-right text-xs text-gray-500',
        },
        {
            colId: 'stockStatus',
            headerName: COLOR_HEADERS.stockStatus,
            field: 'stockStatus',
            width: 80,
            cellRenderer: (params: ICellRendererParams) => (
                <FabricStatusBadge status={params.value || 'OK'} />
            ),
        },
        {
            colId: 'suggestedOrderQty',
            headerName: COLOR_HEADERS.suggestedOrderQty,
            field: 'suggestedOrderQty',
            width: 100,
            valueFormatter: (params: ValueFormatterParams) =>
                params.value != null && params.value > 0 ? params.value.toFixed(1) : '-',
            cellClass: (params: CellClassParams) => {
                const val = params.value;
                if (val && val > 0) return 'text-right font-medium text-blue-600';
                return 'text-right text-gray-400';
            },
        },
        {
            colId: 'actions',
            headerName: '',
            width: 140,
            pinned: 'right' as const,
            sortable: false,
            cellRenderer: (params: ICellRendererParams) => {
                const row = params.data;
                if (!row) return null;
                const isDefaultFabric = row.fabricTypeName === 'Default';
                return (
                    <div className="flex items-center gap-1">
                        <button
                            onClick={() => setShowDetail(row)}
                            className="p-1 rounded hover:bg-gray-100 text-gray-500 hover:text-gray-700"
                            title="View details"
                        >
                            <Eye size={14} />
                        </button>
                        <button
                            onClick={() => handleOpenEdit(row)}
                            className="p-1 rounded hover:bg-blue-100 text-gray-500 hover:text-blue-600"
                            title="Edit fabric"
                        >
                            <Pencil size={14} />
                        </button>
                        <button
                            onClick={() => setShowInward(row)}
                            className="p-1 rounded hover:bg-green-100 text-green-500 hover:text-green-700"
                            title="Add inward"
                        >
                            <Package size={14} />
                        </button>
                        {isAdmin && !isDefaultFabric && (
                            <button
                                onClick={() => {
                                    if (confirm(`Delete "${row.colorName}" (${row.fabricTypeName})?\n\nAny products using this fabric will be reassigned to the default fabric.`)) {
                                        deleteFabric.mutate(row.fabricId);
                                    }
                                }}
                                className="p-1 rounded hover:bg-red-100 text-gray-400 hover:text-red-600"
                                title="Delete fabric"
                            >
                                <Trash2 size={14} />
                            </button>
                        )}
                    </div>
                );
            },
        },
    ], [isAdmin, deleteFabric, handleOpenEdit]);

    // Type view columns (for viewing/editing fabric types)
    const typeColumnDefs: ColDef[] = useMemo(() => [
        {
            colId: 'fabricTypeName',
            headerName: 'Fabric Type',
            field: 'fabricTypeName',
            width: 150,
            pinned: 'left' as const,
            cellClass: 'font-medium',
        },
        {
            colId: 'composition',
            headerName: 'Composition',
            field: 'composition',
            width: 150,
            cellClass: 'text-xs text-gray-600',
        },
        {
            colId: 'colorCount',
            headerName: 'Colors',
            field: 'colorCount',
            width: 70,
            cellClass: 'text-right text-xs font-medium',
        },
        {
            colId: 'productCount',
            headerName: 'Products',
            field: 'productCount',
            width: 80,
            cellClass: 'text-right text-xs font-medium',
        },
        {
            colId: 'totalStock',
            headerName: 'Stock',
            field: 'totalStock',
            width: 90,
            cellClass: 'text-right font-medium',
            valueFormatter: (params: ValueFormatterParams) => {
                if (params.value == null) return '-';
                const unit = params.data?.unit === 'kg' ? 'kg' : 'm';
                return `${params.value.toLocaleString()} ${unit}`;
            },
        },
        {
            colId: 'sales7d',
            headerName: 'Sales (7d)',
            field: 'sales7d',
            width: 95,
            cellClass: 'text-right text-xs font-medium text-green-600',
            valueFormatter: (params: ValueFormatterParams) => {
                if (params.value == null || params.value === 0) return '-';
                return `₹${params.value.toLocaleString()}`;
            },
        },
        {
            colId: 'sales30d',
            headerName: 'Sales (30d)',
            field: 'sales30d',
            width: 100,
            cellClass: 'text-right text-xs font-medium text-green-600',
            valueFormatter: (params: ValueFormatterParams) => {
                if (params.value == null || params.value === 0) return '-';
                return `₹${params.value.toLocaleString()}`;
            },
        },
        {
            colId: 'consumption7d',
            headerName: 'Use (7d)',
            field: 'consumption7d',
            width: 90,
            cellClass: 'text-right text-xs',
            valueFormatter: (params: ValueFormatterParams) => {
                if (params.value == null || params.value === 0) return '-';
                const unit = params.data?.unit === 'kg' ? 'kg' : 'm';
                return `${params.value.toLocaleString()} ${unit}`;
            },
        },
        {
            colId: 'consumption30d',
            headerName: 'Use (30d)',
            field: 'consumption30d',
            width: 90,
            cellClass: 'text-right text-xs',
            valueFormatter: (params: ValueFormatterParams) => {
                if (params.value == null || params.value === 0) return '-';
                const unit = params.data?.unit === 'kg' ? 'kg' : 'm';
                return `${params.value.toLocaleString()} ${unit}`;
            },
        },
        {
            colId: 'defaultCostPerUnit',
            headerName: 'Cost/Unit',
            field: 'defaultCostPerUnit',
            width: 90,
            cellClass: 'text-right',
            valueFormatter: (params: ValueFormatterParams) => params.value != null ? `₹${params.value}` : '-',
        },
        {
            colId: 'unit',
            headerName: 'Unit',
            field: 'unit',
            width: 70,
            cellClass: 'text-xs',
            valueFormatter: (params: ValueFormatterParams) => params.value === 'kg' ? 'kg' : 'm',
        },
        {
            colId: 'avgShrinkagePct',
            headerName: 'Shrink %',
            field: 'avgShrinkagePct',
            width: 80,
            cellClass: 'text-right text-xs',
            valueFormatter: (params: ValueFormatterParams) => params.value != null ? `${params.value}%` : '-',
        },
        {
            colId: 'defaultLeadTimeDays',
            headerName: 'Lead (d)',
            field: 'defaultLeadTimeDays',
            width: 80,
            cellClass: 'text-right text-xs',
            valueFormatter: (params: ValueFormatterParams) => params.value != null ? `${params.value}` : '-',
        },
        {
            colId: 'defaultMinOrderQty',
            headerName: 'Min Qty',
            field: 'defaultMinOrderQty',
            width: 80,
            cellClass: 'text-right text-xs',
            valueFormatter: (params: ValueFormatterParams) => params.value != null ? params.value.toString() : '-',
        },
        {
            colId: 'actions',
            headerName: '',
            width: 60,
            pinned: 'right' as const,
            sortable: false,
            cellRenderer: (params: ICellRendererParams) => {
                const row = params.data;
                if (!row) return null;
                const isDefault = row.fabricTypeName === 'Default';
                return (
                    <div className="flex items-center gap-1">
                        <button
                            onClick={() => handleOpenEditType(row)}
                            className={`p-1 rounded hover:bg-blue-100 text-gray-500 hover:text-blue-600 ${isDefault ? 'opacity-30 cursor-not-allowed' : ''}`}
                            title="Edit type defaults"
                            disabled={isDefault}
                        >
                            <Pencil size={14} />
                        </button>
                    </div>
                );
            },
        },
    ], [handleOpenEditType]);

    // Select columns based on view level
    const activeColumnDefs = viewLevel === 'type' ? typeColumnDefs : columnDefs;

    // Apply visibility and ordering using helper functions
    const orderedColumnDefs = useMemo(() => {
        const withVisibility = applyColumnVisibility(activeColumnDefs, visibleColumns);
        const withWidths = applyColumnWidths(withVisibility, columnWidths);
        return orderColumns(withWidths, columnOrder);
    }, [activeColumnDefs, visibleColumns, columnWidths, columnOrder]);

    // Summary stats
    const summary = fabricData?.summary || { total: 0, orderNow: 0, orderSoon: 0, ok: 0 };

    return (
        <div className="space-y-4">
            {/* Header */}
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                <div>
                    <h1 className="text-xl md:text-2xl font-bold text-gray-900">Fabrics</h1>
                    <p className="text-sm text-gray-500">Fabric inventory and stock management</p>
                </div>
                <div className="flex flex-wrap gap-2 sm:gap-3">
                    <button onClick={() => setShowAddSupplier(true)} className="btn-secondary flex items-center text-sm">
                        <Users size={18} className="mr-1.5" />Add Supplier
                    </button>
                    <button onClick={() => setShowAddType(true)} className="btn-primary flex items-center text-sm">
                        <Plus size={18} className="mr-1.5" />Add Type
                    </button>
                </div>
            </div>

            {/* View Level Toggle */}
            <div className="flex items-center gap-4">
                <div className="flex items-center gap-1 bg-gray-100 rounded-lg p-0.5">
                    <button
                        onClick={() => setViewLevel('color')}
                        className={`px-3 py-1.5 text-sm rounded-md transition-all ${viewLevel === 'color' ? 'bg-white shadow text-gray-900' : 'text-gray-600 hover:text-gray-900'}`}
                    >
                        By Color
                    </button>
                    <button
                        onClick={() => setViewLevel('type')}
                        className={`px-3 py-1.5 text-sm rounded-md transition-all ${viewLevel === 'type' ? 'bg-white shadow text-gray-900' : 'text-gray-600 hover:text-gray-900'}`}
                    >
                        By Type
                    </button>
                </div>
                <span className="text-xs text-gray-400">
                    {viewLevel === 'color' ? 'Individual fabric colors with stock levels' : 'Fabric types with default settings'}
                </span>
            </div>

            {/* Stats bar */}
            <div className="flex items-center gap-3 md:gap-4 text-sm">
                <div className="text-gray-500">
                    <span className="font-medium text-gray-900">{summary.total}</span> {viewLevel === 'color' ? 'fabrics' : 'types'}
                </div>
                {viewLevel === 'color' && (
                    <>
                        {summary.orderNow > 0 && (
                            <div className="flex items-center gap-1 text-red-600">
                                <AlertTriangle size={14} />
                                <span className="font-medium">{summary.orderNow}</span> order now
                            </div>
                        )}
                        {summary.orderSoon > 0 && (
                            <div className="text-yellow-600">
                                <span className="font-medium">{summary.orderSoon}</span> order soon
                            </div>
                        )}
                        {summary.ok > 0 && (
                            <div className="text-green-600">
                                <span className="font-medium">{summary.ok}</span> OK
                            </div>
                        )}
                    </>
                )}
            </div>

            {/* Filters */}
            <div className="flex flex-wrap gap-2 md:gap-3">
                <div className="relative w-full sm:w-auto">
                    <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
                    <input
                        type="text"
                        placeholder="Search fabric, color, supplier..."
                        value={searchInput}
                        onChange={(e) => setSearchInput(e.target.value)}
                        className="pl-8 pr-3 py-1.5 text-sm border rounded-lg w-full sm:w-48 md:w-56 focus:outline-none focus:ring-2 focus:ring-gray-200"
                    />
                </div>

                <select
                    value={filter.fabricTypeId}
                    onChange={(e) => setFilter(f => ({ ...f, fabricTypeId: e.target.value }))}
                    className="text-sm border rounded px-2 py-1.5 bg-white w-full sm:w-auto"
                >
                    <option value="">All Types</option>
                    {filterOptions?.fabricTypes?.map((t: any) => (
                        <option key={t.id} value={t.id}>{t.name}</option>
                    ))}
                </select>

                <select
                    value={filter.status}
                    onChange={(e) => setFilter(f => ({ ...f, status: e.target.value }))}
                    className="text-sm border rounded px-2 py-1.5 bg-white w-full sm:w-auto"
                >
                    <option value="">All Status</option>
                    <option value="ORDER NOW">Order Now</option>
                    <option value="ORDER SOON">Order Soon</option>
                    <option value="OK">OK</option>
                </select>

                <div className="hidden sm:block sm:flex-1" />

                {/* Add Color button - exclude Default fabric type */}
                {filterOptions?.fabricTypes?.filter((t: any) => t.name !== 'Default').length > 0 && (
                    <select
                        value=""
                        onChange={(e) => e.target.value && setShowAddColor(e.target.value)}
                        className="text-sm border rounded px-2 py-1.5 bg-white text-primary-600 w-full sm:w-auto"
                    >
                        <option value="">+ Add Color...</option>
                        {filterOptions?.fabricTypes?.filter((t: any) => t.name !== 'Default').map((t: any) => (
                            <option key={t.id} value={t.id}>{t.name}</option>
                        ))}
                    </select>
                )}

                {/* Page size selector */}
                <div className="flex items-center gap-1.5">
                    <span className="text-xs text-gray-500">Show:</span>
                    <select
                        value={pageSize}
                        onChange={(e) => handlePageSizeChange(parseInt(e.target.value, 10))}
                        className="text-xs border rounded px-1.5 py-1 bg-white"
                    >
                        {PAGE_SIZE_OPTIONS.map(size => (
                            <option key={size} value={size}>
                                {size === 0 ? 'All' : size}
                            </option>
                        ))}
                    </select>
                </div>

                <ColumnVisibilityDropdown
                    visibleColumns={visibleColumns}
                    onToggleColumn={handleToggleColumn}
                    onResetAll={handleResetAll}
                    columnIds={viewLevel === 'type' ? TYPE_COLUMN_IDS : COLOR_COLUMN_IDS}
                    columnHeaders={viewLevel === 'type' ? TYPE_HEADERS : COLOR_HEADERS}
                />
                {isManager && hasUnsavedChanges && (
                    <button
                        onClick={async () => {
                            const success = await savePreferencesToServer();
                            if (success) {
                                alert('Column preferences saved for all users');
                            } else {
                                alert('Failed to save preferences');
                            }
                        }}
                        disabled={isSavingPrefs}
                        className="flex items-center gap-1 text-xs px-2 py-1 rounded bg-blue-50 text-blue-600 hover:bg-blue-100 disabled:opacity-50 border border-blue-200"
                        title="Save current column visibility and order for all users"
                    >
                        <Save size={12} />
                        {isSavingPrefs ? 'Saving...' : 'Sync columns'}
                    </button>
                )}
            </div>

            {/* AG-Grid */}
            <div className="table-scroll-container border rounded">
                <div style={{ minWidth: '1100px', height: 'calc(100vh - 280px)', minHeight: '400px' }}>
                    <AgGridReact
                        ref={gridRef}
                        theme={compactThemeSmall}
                        rowData={fabricData?.items || []}
                        columnDefs={orderedColumnDefs}
                        loading={isLoading}
                        defaultColDef={{
                            sortable: true,
                            resizable: true,
                            suppressMovable: false,
                        }}
                        animateRows={false}
                        suppressCellFocus={true}
                        getRowId={(params) => params.data.fabricId || params.data.fabricTypeId}
                        pagination={true}
                        paginationPageSize={pageSize === 0 ? 999999 : pageSize}
                        paginationPageSizeSelector={false}
                        cacheQuickFilter={true}
                        onColumnMoved={onColumnMoved}
                        onColumnResized={onColumnResized}
                        maintainColumnOrder={true}
                        enableCellTextSelection={true}
                        ensureDomOrder={true}
                    />
                </div>
            </div>

            {/* Add Fabric Type Modal */}
            {showAddType && (
                <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
                    <div className="bg-white rounded-xl p-6 w-full max-w-md">
                        <div className="flex items-center justify-between mb-4">
                            <h2 className="text-lg font-semibold">Add Fabric Type</h2>
                            <button onClick={() => setShowAddType(false)} className="text-gray-400 hover:text-gray-600"><X size={20} /></button>
                        </div>
                        <form onSubmit={handleSubmitType} className="space-y-4">
                            <div>
                                <label className="label">Type Name</label>
                                <input className="input" value={typeForm.name} onChange={(e) => setTypeForm(f => ({ ...f, name: e.target.value }))} placeholder="e.g., Linen 60 Lea" required />
                            </div>
                            <div>
                                <label className="label">Composition</label>
                                <input className="input" value={typeForm.composition} onChange={(e) => setTypeForm(f => ({ ...f, composition: e.target.value }))} placeholder="e.g., 100% Linen" />
                            </div>
                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <label className="label">Unit</label>
                                    <select className="input" value={typeForm.unit} onChange={(e) => setTypeForm(f => ({ ...f, unit: e.target.value }))}>
                                        <option value="meter">Meter</option>
                                        <option value="kg">Kilogram</option>
                                    </select>
                                </div>
                                <div>
                                    <label className="label">Avg Shrinkage %</label>
                                    <input type="number" step="0.1" className="input" value={typeForm.avgShrinkagePct} onChange={(e) => setTypeForm(f => ({ ...f, avgShrinkagePct: Number(e.target.value) }))} min={0} max={100} />
                                </div>
                            </div>
                            <div className="border-t pt-4">
                                <p className="text-sm text-gray-600 mb-3">Default values (inherited by colors unless overridden):</p>
                                <div className="grid grid-cols-3 gap-4">
                                    <div>
                                        <label className="label">Cost/Unit (₹)</label>
                                        <input type="number" step="0.01" className="input" value={typeForm.defaultCostPerUnit} onChange={(e) => setTypeForm(f => ({ ...f, defaultCostPerUnit: e.target.value }))} placeholder="0" min={0} />
                                    </div>
                                    <div>
                                        <label className="label">Lead (days)</label>
                                        <input type="number" className="input" value={typeForm.defaultLeadTimeDays} onChange={(e) => setTypeForm(f => ({ ...f, defaultLeadTimeDays: e.target.value }))} placeholder="14" min={0} />
                                    </div>
                                    <div>
                                        <label className="label">Min Order</label>
                                        <input type="number" step="0.1" className="input" value={typeForm.defaultMinOrderQty} onChange={(e) => setTypeForm(f => ({ ...f, defaultMinOrderQty: e.target.value }))} placeholder="10" min={0} />
                                    </div>
                                </div>
                            </div>
                            <div className="flex gap-3 pt-2">
                                <button type="button" onClick={() => setShowAddType(false)} className="btn-secondary flex-1">Cancel</button>
                                <button type="submit" className="btn-primary flex-1" disabled={createType.isPending}>{createType.isPending ? 'Creating...' : 'Add Type'}</button>
                            </div>
                        </form>
                    </div>
                </div>
            )}

            {/* Edit Fabric Type Modal */}
            {showEditType && (
                <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
                    <div className="bg-white rounded-xl p-6 w-full max-w-md">
                        <div className="flex items-center justify-between mb-4">
                            <h2 className="text-lg font-semibold">Edit Fabric Type</h2>
                            <button onClick={() => setShowEditType(null)} className="text-gray-400 hover:text-gray-600"><X size={20} /></button>
                        </div>
                        <form onSubmit={handleSubmitEditType} className="space-y-4">
                            <div>
                                <label className="label">Type Name</label>
                                <input className="input" value={editTypeForm.name} onChange={(e) => setEditTypeForm(f => ({ ...f, name: e.target.value }))} placeholder="e.g., Linen 60 Lea" required />
                            </div>
                            <div>
                                <label className="label">Composition</label>
                                <input className="input" value={editTypeForm.composition} onChange={(e) => setEditTypeForm(f => ({ ...f, composition: e.target.value }))} placeholder="e.g., 100% Linen" />
                            </div>
                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <label className="label">Unit</label>
                                    <select className="input" value={editTypeForm.unit} onChange={(e) => setEditTypeForm(f => ({ ...f, unit: e.target.value }))}>
                                        <option value="meter">Meter</option>
                                        <option value="kg">Kilogram</option>
                                    </select>
                                </div>
                                <div>
                                    <label className="label">Avg Shrinkage %</label>
                                    <input type="number" step="0.1" className="input" value={editTypeForm.avgShrinkagePct} onChange={(e) => setEditTypeForm(f => ({ ...f, avgShrinkagePct: Number(e.target.value) }))} min={0} max={100} />
                                </div>
                            </div>
                            <div className="border-t pt-4">
                                <p className="text-sm text-gray-600 mb-3">Default values (inherited by colors unless overridden):</p>
                                <div className="grid grid-cols-3 gap-4">
                                    <div>
                                        <label className="label">Cost/Unit (₹)</label>
                                        <input type="number" step="0.01" className="input" value={editTypeForm.defaultCostPerUnit} onChange={(e) => setEditTypeForm(f => ({ ...f, defaultCostPerUnit: e.target.value }))} placeholder="Not set" min={0} />
                                    </div>
                                    <div>
                                        <label className="label">Lead (days)</label>
                                        <input type="number" className="input" value={editTypeForm.defaultLeadTimeDays} onChange={(e) => setEditTypeForm(f => ({ ...f, defaultLeadTimeDays: e.target.value }))} placeholder="Not set" min={0} />
                                    </div>
                                    <div>
                                        <label className="label">Min Order</label>
                                        <input type="number" step="0.1" className="input" value={editTypeForm.defaultMinOrderQty} onChange={(e) => setEditTypeForm(f => ({ ...f, defaultMinOrderQty: e.target.value }))} placeholder="Not set" min={0} />
                                    </div>
                                </div>
                            </div>
                            <div className="flex gap-3 pt-2">
                                <button type="button" onClick={() => setShowEditType(null)} className="btn-secondary flex-1">Cancel</button>
                                <button type="submit" className="btn-primary flex-1" disabled={updateType.isPending}>{updateType.isPending ? 'Saving...' : 'Save Changes'}</button>
                            </div>
                        </form>
                    </div>
                </div>
            )}

            {/* Add Color Modal */}
            {showAddColor && (
                <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
                    <div className="bg-white rounded-xl p-6 w-full max-w-md">
                        <div className="flex items-center justify-between mb-4">
                            <h2 className="text-lg font-semibold">Add Color Variation</h2>
                            <button onClick={() => setShowAddColor(null)} className="text-gray-400 hover:text-gray-600"><X size={20} /></button>
                        </div>
                        <form onSubmit={handleSubmitColor} className="space-y-4">
                            <div className="grid grid-cols-3 gap-4">
                                <div>
                                    <label className="label">Color Name</label>
                                    <input className="input" value={colorForm.colorName} onChange={(e) => setColorForm(f => ({ ...f, colorName: e.target.value }))} placeholder="e.g., Wildflower Blue" required />
                                </div>
                                <div>
                                    <label className="label">Standard Color</label>
                                    <select
                                        className="input"
                                        value={colorForm.standardColor}
                                        onChange={(e) => {
                                            const color = e.target.value;
                                            setColorForm(f => ({
                                                ...f,
                                                standardColor: color,
                                                colorHex: color ? STANDARD_COLOR_HEX[color] : f.colorHex,
                                            }));
                                        }}
                                    >
                                        <option value="">Select...</option>
                                        {STANDARD_COLORS.map(c => <option key={c} value={c}>{c}</option>)}
                                    </select>
                                </div>
                                <div>
                                    <label className="label">Color</label>
                                    <input type="color" className="input h-10" value={colorForm.colorHex} onChange={(e) => setColorForm(f => ({ ...f, colorHex: e.target.value }))} />
                                </div>
                            </div>
                            <div>
                                <label className="label">Supplier (optional)</label>
                                <select className="input" value={colorForm.supplierId} onChange={(e) => setColorForm(f => ({ ...f, supplierId: e.target.value }))}>
                                    <option value="">No supplier</option>
                                    {suppliers?.map((s: any) => <option key={s.id} value={s.id}>{s.name}</option>)}
                                </select>
                            </div>
                            <div className="border-t pt-4">
                                <p className="text-sm text-gray-600 mb-3">Leave blank to inherit from fabric type defaults:</p>
                                <div className="grid grid-cols-3 gap-4">
                                    <div>
                                        <label className="label">Cost/Unit (₹)</label>
                                        <input type="number" className="input" value={colorForm.costPerUnit} onChange={(e) => setColorForm(f => ({ ...f, costPerUnit: e.target.value }))} placeholder="Inherit" min={0} />
                                    </div>
                                    <div>
                                        <label className="label">Lead (days)</label>
                                        <input type="number" className="input" value={colorForm.leadTimeDays} onChange={(e) => setColorForm(f => ({ ...f, leadTimeDays: e.target.value }))} placeholder="Inherit" min={0} />
                                    </div>
                                    <div>
                                        <label className="label">Min Order</label>
                                        <input type="number" className="input" value={colorForm.minOrderQty} onChange={(e) => setColorForm(f => ({ ...f, minOrderQty: e.target.value }))} placeholder="Inherit" min={0} />
                                    </div>
                                </div>
                            </div>
                            <div className="flex gap-3 pt-2">
                                <button type="button" onClick={() => setShowAddColor(null)} className="btn-secondary flex-1">Cancel</button>
                                <button type="submit" className="btn-primary flex-1" disabled={createFabric.isPending}>{createFabric.isPending ? 'Creating...' : 'Add Color'}</button>
                            </div>
                        </form>
                    </div>
                </div>
            )}

            {/* Edit Fabric Modal */}
            {showEditFabric && (
                <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
                    <div className="bg-white rounded-xl p-6 w-full max-w-md">
                        <div className="flex items-center justify-between mb-4">
                            <h2 className="text-lg font-semibold">Edit Fabric</h2>
                            <button onClick={() => setShowEditFabric(null)} className="text-gray-400 hover:text-gray-600"><X size={20} /></button>
                        </div>
                        <div className="mb-4 p-3 bg-gray-50 rounded-lg">
                            <p className="text-sm text-gray-500">{showEditFabric.fabricTypeName}</p>
                        </div>
                        <form onSubmit={handleSubmitEdit} className="space-y-4">
                            <div className="grid grid-cols-3 gap-4">
                                <div>
                                    <label className="label">Color Name</label>
                                    <input className="input" value={editForm.colorName} onChange={(e) => setEditForm(f => ({ ...f, colorName: e.target.value }))} placeholder="e.g., Wildflower Blue" required />
                                </div>
                                <div>
                                    <label className="label">Standard Color</label>
                                    <select
                                        className="input"
                                        value={editForm.standardColor}
                                        onChange={(e) => {
                                            const color = e.target.value;
                                            setEditForm(f => ({
                                                ...f,
                                                standardColor: color,
                                                colorHex: color ? STANDARD_COLOR_HEX[color] : f.colorHex,
                                            }));
                                        }}
                                    >
                                        <option value="">Select...</option>
                                        {STANDARD_COLORS.map(c => <option key={c} value={c}>{c}</option>)}
                                    </select>
                                </div>
                                <div>
                                    <label className="label">Color</label>
                                    <input type="color" className="input h-10" value={editForm.colorHex} onChange={(e) => setEditForm(f => ({ ...f, colorHex: e.target.value }))} />
                                </div>
                            </div>
                            <div>
                                <label className="label">Supplier (optional)</label>
                                <select className="input" value={editForm.supplierId} onChange={(e) => setEditForm(f => ({ ...f, supplierId: e.target.value }))}>
                                    <option value="">No supplier</option>
                                    {suppliers?.map((s: any) => <option key={s.id} value={s.id}>{s.name}</option>)}
                                </select>
                            </div>
                            <div className="border-t pt-4">
                                <p className="text-sm text-gray-600 mb-3">Leave blank to inherit from fabric type defaults:</p>
                                <div className="grid grid-cols-3 gap-4">
                                    <div>
                                        <label className="label">Cost/Unit (₹)</label>
                                        <input type="number" className="input" value={editForm.costPerUnit} onChange={(e) => setEditForm(f => ({ ...f, costPerUnit: e.target.value }))} placeholder={`Inherit (₹${showEditFabric?.typeCostPerUnit ?? '?'})`} min={0} />
                                    </div>
                                    <div>
                                        <label className="label">Lead (days)</label>
                                        <input type="number" className="input" value={editForm.leadTimeDays} onChange={(e) => setEditForm(f => ({ ...f, leadTimeDays: e.target.value }))} placeholder={`Inherit (${showEditFabric?.typeLeadTimeDays ?? '?'})`} min={0} />
                                    </div>
                                    <div>
                                        <label className="label">Min Order</label>
                                        <input type="number" className="input" value={editForm.minOrderQty} onChange={(e) => setEditForm(f => ({ ...f, minOrderQty: e.target.value }))} placeholder={`Inherit (${showEditFabric?.typeMinOrderQty ?? '?'})`} min={0} />
                                    </div>
                                </div>
                            </div>
                            <div className="flex gap-3 pt-2">
                                <button type="button" onClick={() => setShowEditFabric(null)} className="btn-secondary flex-1">Cancel</button>
                                <button type="submit" className="btn-primary flex-1" disabled={updateFabric.isPending}>{updateFabric.isPending ? 'Saving...' : 'Save Changes'}</button>
                            </div>
                        </form>
                    </div>
                </div>
            )}

            {/* Inward Modal */}
            {showInward && (
                <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
                    <div className="bg-white rounded-xl p-6 w-full max-w-md">
                        <div className="flex items-center justify-between mb-4">
                            <h2 className="text-lg font-semibold">Fabric Inward</h2>
                            <button onClick={() => setShowInward(null)} className="text-gray-400 hover:text-gray-600"><X size={20} /></button>
                        </div>
                        <div className="mb-4 p-3 bg-gray-50 rounded-lg flex items-center gap-3">
                            <div className="w-6 h-6 rounded-full" style={{ backgroundColor: showInward.colorHex || '#ccc' }} />
                            <div>
                                <p className="font-medium">{showInward.colorName}</p>
                                <p className="text-xs text-gray-500">{showInward.fabricTypeName}</p>
                            </div>
                        </div>
                        <form onSubmit={handleSubmitInward} className="space-y-4">
                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <label className="label">Quantity ({showInward.unit === 'kg' ? 'kg' : 'meters'})</label>
                                    <input type="number" step="0.1" className="input" value={inwardForm.qty} onChange={(e) => setInwardForm(f => ({ ...f, qty: Number(e.target.value) }))} min={0.1} required />
                                </div>
                                <div>
                                    <label className="label">Price/Unit (₹)</label>
                                    <input type="number" step="0.01" className="input" value={inwardForm.costPerUnit} onChange={(e) => setInwardForm(f => ({ ...f, costPerUnit: Number(e.target.value) }))} min={0} placeholder={showInward.costPerUnit?.toString() || '0'} />
                                </div>
                            </div>
                            <div>
                                <label className="label">Supplier</label>
                                <select className="input" value={inwardForm.supplierId} onChange={(e) => setInwardForm(f => ({ ...f, supplierId: e.target.value }))}>
                                    <option value="">Select supplier</option>
                                    {suppliers?.map((s: any) => <option key={s.id} value={s.id}>{s.name}</option>)}
                                </select>
                            </div>
                            <div>
                                <label className="label">Notes (optional)</label>
                                <input className="input" value={inwardForm.notes} onChange={(e) => setInwardForm(f => ({ ...f, notes: e.target.value }))} placeholder="e.g., PO #1234, Invoice ref" />
                            </div>
                            <div className="flex gap-3 pt-2">
                                <button type="button" onClick={() => setShowInward(null)} className="btn-secondary flex-1">Cancel</button>
                                <button type="submit" className="btn-primary flex-1" disabled={createInward.isPending}>{createInward.isPending ? 'Saving...' : 'Add to Inventory'}</button>
                            </div>
                        </form>
                    </div>
                </div>
            )}

            {/* Add Supplier Modal */}
            {showAddSupplier && (
                <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
                    <div className="bg-white rounded-xl p-6 w-full max-w-md">
                        <div className="flex items-center justify-between mb-4">
                            <h2 className="text-lg font-semibold">Add Supplier</h2>
                            <button onClick={() => setShowAddSupplier(false)} className="text-gray-400 hover:text-gray-600"><X size={20} /></button>
                        </div>
                        <form onSubmit={handleSubmitSupplier} className="space-y-4">
                            <div>
                                <label className="label">Supplier Name</label>
                                <input className="input" value={supplierForm.name} onChange={(e) => setSupplierForm(f => ({ ...f, name: e.target.value }))} placeholder="e.g., ABC Textiles" required />
                            </div>
                            <div>
                                <label className="label">Contact Name</label>
                                <input className="input" value={supplierForm.contactName} onChange={(e) => setSupplierForm(f => ({ ...f, contactName: e.target.value }))} placeholder="e.g., John Doe" />
                            </div>
                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <label className="label">Email</label>
                                    <input type="email" className="input" value={supplierForm.email} onChange={(e) => setSupplierForm(f => ({ ...f, email: e.target.value }))} placeholder="email@supplier.com" />
                                </div>
                                <div>
                                    <label className="label">Phone</label>
                                    <input className="input" value={supplierForm.phone} onChange={(e) => setSupplierForm(f => ({ ...f, phone: e.target.value }))} placeholder="+91 98765 43210" />
                                </div>
                            </div>
                            <div>
                                <label className="label">Address</label>
                                <textarea className="input" rows={2} value={supplierForm.address} onChange={(e) => setSupplierForm(f => ({ ...f, address: e.target.value }))} placeholder="Full address..." />
                            </div>
                            <div className="flex gap-3 pt-2">
                                <button type="button" onClick={() => setShowAddSupplier(false)} className="btn-secondary flex-1">Cancel</button>
                                <button type="submit" className="btn-primary flex-1" disabled={createSupplier.isPending}>{createSupplier.isPending ? 'Creating...' : 'Add Supplier'}</button>
                            </div>
                        </form>
                    </div>
                </div>
            )}

            {/* Fabric Detail Modal */}
            {showDetail && (
                <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
                    <div className="bg-white rounded-xl p-6 w-full max-w-2xl max-h-[85vh] overflow-hidden flex flex-col">
                        <div className="flex items-center justify-between mb-4">
                            <div className="flex items-center gap-3">
                                <div className="w-8 h-8 rounded-full border-2 border-gray-300" style={{ backgroundColor: showDetail.colorHex || '#ccc' }} />
                                <div>
                                    <h2 className="text-lg font-semibold">{showDetail.colorName}</h2>
                                    <p className="text-sm text-gray-500">{showDetail.fabricTypeName}</p>
                                </div>
                            </div>
                            <button onClick={() => setShowDetail(null)} className="text-gray-400 hover:text-gray-600"><X size={20} /></button>
                        </div>

                        {/* Summary Stats */}
                        <div className="grid grid-cols-2 md:grid-cols-4 gap-2 md:gap-4 mb-4">
                            <div className="bg-gray-50 rounded-lg p-2 md:p-3 text-center">
                                <p className="text-xs text-gray-500">Current Balance</p>
                                <p className="text-base md:text-lg font-semibold">{showDetail.currentBalance?.toFixed(1) || 0} {showDetail.unit === 'kg' ? 'kg' : 'm'}</p>
                            </div>
                            <div className="bg-green-50 rounded-lg p-2 md:p-3 text-center">
                                <p className="text-xs text-green-600">Total Inward</p>
                                <p className="text-base md:text-lg font-semibold text-green-700">{showDetail.totalInward?.toFixed(1) || 0}</p>
                            </div>
                            <div className="bg-red-50 rounded-lg p-2 md:p-3 text-center">
                                <p className="text-xs text-red-600">Total Outward</p>
                                <p className="text-base md:text-lg font-semibold text-red-700">{showDetail.totalOutward?.toFixed(1) || 0}</p>
                            </div>
                            <div className="bg-blue-50 rounded-lg p-2 md:p-3 text-center">
                                <p className="text-xs text-blue-600">Status</p>
                                <p className={`text-sm font-semibold ${showDetail.stockStatus === 'OK' ? 'text-green-600' : showDetail.stockStatus === 'ORDER SOON' ? 'text-yellow-600' : 'text-red-600'}`}>
                                    {showDetail.stockStatus || 'N/A'}
                                </p>
                            </div>
                        </div>

                        {/* Transactions List */}
                        <div className="flex-1 overflow-y-auto">
                            <h3 className="font-medium text-gray-700 mb-3">Transaction History</h3>
                            {txnLoading ? (
                                <div className="flex justify-center py-8">
                                    <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-primary-600"></div>
                                </div>
                            ) : transactions?.length === 0 ? (
                                <div className="text-center py-8 text-gray-500">No transactions yet</div>
                            ) : (
                                <div className="space-y-2">
                                    {transactions?.map((txn: any) => (
                                        <div key={txn.id} className={`p-3 rounded-lg border ${txn.txnType === 'inward' ? 'bg-green-50 border-green-200' : 'bg-red-50 border-red-200'}`}>
                                            <div className="flex items-center justify-between">
                                                <div className="flex items-center gap-3">
                                                    {txn.txnType === 'inward' ? (
                                                        <ArrowDownCircle size={20} className="text-green-600" />
                                                    ) : (
                                                        <ArrowUpCircle size={20} className="text-red-600" />
                                                    )}
                                                    <div>
                                                        <p className="font-medium">
                                                            {txn.txnType === 'inward' ? '+' : '-'}{txn.qty} {txn.unit}
                                                            <span className="ml-2 text-xs text-gray-500 font-normal capitalize">
                                                                {txn.reason.replace(/_/g, ' ')}
                                                            </span>
                                                        </p>
                                                        <div className="flex items-center gap-2 text-xs text-gray-500">
                                                            <span>{new Date(txn.createdAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}</span>
                                                            <span>•</span>
                                                            <span>{txn.createdBy?.name || 'System'}</span>
                                                            {txn.supplier && (
                                                                <>
                                                                    <span>•</span>
                                                                    <span>From: {txn.supplier.name}</span>
                                                                </>
                                                            )}
                                                            {txn.costPerUnit && (
                                                                <>
                                                                    <span>•</span>
                                                                    <span>₹{txn.costPerUnit}/unit</span>
                                                                </>
                                                            )}
                                                        </div>
                                                        {txn.notes && <p className="text-xs text-gray-600 mt-1">{txn.notes}</p>}
                                                    </div>
                                                </div>
                                                <div className="flex items-center gap-2">
                                                    <div className={`text-lg font-semibold ${txn.txnType === 'inward' ? 'text-green-600' : 'text-red-600'}`}>
                                                        {txn.txnType === 'inward' ? '+' : '-'}{txn.qty}
                                                    </div>
                                                    {isAdmin && (
                                                        <button
                                                            onClick={() => {
                                                                if (confirm(`Delete this ${txn.txnType} transaction of ${txn.qty} ${txn.unit}?`)) {
                                                                    deleteTransaction.mutate(txn.id);
                                                                }
                                                            }}
                                                            className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded"
                                                            title="Delete transaction (admin only)"
                                                        >
                                                            <Trash2 size={16} />
                                                        </button>
                                                    )}
                                                </div>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>

                        {/* Footer */}
                        <div className="flex gap-3 pt-4 mt-4 border-t">
                            <button onClick={() => setShowDetail(null)} className="btn-secondary flex-1">Close</button>
                            <button
                                onClick={() => { setShowInward({ ...showDetail }); setShowDetail(null); }}
                                className="btn-primary flex-1 flex items-center justify-center gap-2"
                            >
                                <Package size={16} /> Add Inward
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
