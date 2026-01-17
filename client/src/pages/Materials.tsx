/**
 * Materials Page - 3-tier Material hierarchy management
 *
 * VIEW LEVELS:
 * - Material: Base fiber/material types (Linen, Pima Cotton, Cotton)
 * - Fabric: Textile construction variants (Linen 60 Lea Plain Weave, Pima Single Jersey 180gsm)
 * - Colour: Specific color variants with inventory tracking (the actual inventory unit)
 *
 * Each level shows aggregated data from below, with drill-down capability.
 * Inheritable fields: cost, lead time, min order qty (↑ indicates inherited value)
 *
 * TAB STRUCTURE:
 * - Materials (default): 3-tier fabric hierarchy
 * - Trims: Trim items catalog (buttons, zippers, labels, etc.)
 * - Services: Service items catalog (printing, embroidery, etc.)
 */

import { useState, useMemo, useRef, useEffect, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { AgGridReact } from 'ag-grid-react';
import type { ColDef, ICellRendererParams, ValueFormatterParams, CellClassParams } from 'ag-grid-community';
import { AllCommunityModule, ModuleRegistry } from 'ag-grid-community';
import { useSearchParams } from 'react-router-dom';
import {
    Search, Plus, RefreshCw, X, Layers, Scissors, Package,
    ChevronRight, Pencil, Eye, Users, TreeDeciduous, List
} from 'lucide-react';
import { materialsApi, fabricsApi } from '../services/api';
import { useAuth } from '../hooks/useAuth';
import { compactThemeSmall } from '../utils/agGridHelpers';
import { ColumnVisibilityDropdown, FabricStatusBadge, GridPreferencesToolbar } from '../components/common/grid';
import { useGridState, getColumnOrderFromApi, applyColumnVisibility, applyColumnWidths, orderColumns } from '../hooks/useGridState';
import { DetailPanel } from '../components/materials/DetailPanel';
import { MaterialEditModal } from '../components/materials/MaterialEditModal';
import { MaterialsTreeView } from '../components/materials/MaterialsTreeView';

// Page size options
const PAGE_SIZE_OPTIONS = [100, 500, 1000, 0] as const;

// Register AG Grid modules
ModuleRegistry.registerModules([AllCommunityModule]);

// Tab types
type TabType = 'materials' | 'trims' | 'services';

// View levels for materials tab
type ViewLevel = 'material' | 'fabric' | 'colour';

// Column IDs for each view level
const MATERIAL_COLUMN_IDS = ['name', 'fabricCount', 'colourCount', 'totalStock', 'actions'];
const FABRIC_COLUMN_IDS = [
    'materialName', 'name', 'constructionType', 'pattern', 'weight',
    'colourCount', 'defaultCostPerUnit', 'totalStock', 'actions'
];
const COLOUR_COLUMN_IDS = [
    'colourName', 'fabricName', 'materialName', 'standardColour', 'composition', 'weight',
    'costPerUnit', 'leadTimeDays', 'minOrderQty', 'supplierName',
    'currentBalance', 'totalInward', 'totalOutward', 'avgDailyConsumption', 'daysOfStock', 'stockStatus', 'actions'
];
const TRIM_COLUMN_IDS = ['code', 'name', 'category', 'costPerUnit', 'unit', 'supplierName', 'leadTimeDays', 'minOrderQty', 'usageCount', 'isActive', 'actions'];
const SERVICE_COLUMN_IDS = ['code', 'name', 'category', 'costPerJob', 'costUnit', 'vendorName', 'leadTimeDays', 'usageCount', 'isActive', 'actions'];

// Column headers
const MATERIAL_HEADERS: Record<string, string> = {
    name: 'Material', fabricCount: 'Fabrics', colourCount: 'Colours', totalStock: 'Total Stock', actions: ''
};
const FABRIC_HEADERS: Record<string, string> = {
    materialName: 'Material', name: 'Fabric', constructionType: 'Type', pattern: 'Pattern',
    weight: 'Weight', colourCount: 'Colours', defaultCostPerUnit: 'Cost/Unit', totalStock: 'Stock', actions: ''
};
const COLOUR_HEADERS: Record<string, string> = {
    colourName: 'Colour', fabricName: 'Fabric', materialName: 'Material', standardColour: 'Std Colour',
    composition: 'Composition', weight: 'Weight', costPerUnit: 'Cost/Unit', leadTimeDays: 'Lead (days)',
    minOrderQty: 'Min Order', supplierName: 'Supplier', currentBalance: 'Balance',
    totalInward: 'Total In', totalOutward: 'Total Out', avgDailyConsumption: 'Avg/Day',
    daysOfStock: 'Days Stock', stockStatus: 'Status', actions: ''
};
const TRIM_HEADERS: Record<string, string> = {
    code: 'Code', name: 'Name', category: 'Category', costPerUnit: 'Cost/Unit',
    unit: 'Unit', supplierName: 'Supplier', leadTimeDays: 'Lead Time', minOrderQty: 'Min Order',
    usageCount: 'Used In', isActive: 'Status', actions: ''
};
const SERVICE_HEADERS: Record<string, string> = {
    code: 'Code', name: 'Name', category: 'Category', costPerJob: 'Cost/Job', costUnit: 'Cost Unit',
    vendorName: 'Vendor', leadTimeDays: 'Lead Time', usageCount: 'Used In', isActive: 'Status', actions: ''
};

// Standard colors with hex values
const STANDARD_COLOR_HEX: Record<string, string> = {
    Red: '#DC2626', Orange: '#EA580C', Yellow: '#CA8A04', Green: '#16A34A',
    Blue: '#2563EB', Purple: '#9333EA', Pink: '#DB2777', Brown: '#92400E',
    Black: '#171717', White: '#FAFAFA', Grey: '#6B7280', Beige: '#D4B896',
    Navy: '#1E3A5F', Teal: '#0D9488', Indigo: '#4F46E5', Coral: '#F97316',
    Cream: '#FEF3C7', Natural: '#E7E5E4',
};
const STANDARD_COLORS = Object.keys(STANDARD_COLOR_HEX);

// Construction types
const CONSTRUCTION_TYPES = ['knit', 'woven'];

// Trim categories
const TRIM_CATEGORIES = ['button', 'zipper', 'label', 'thread', 'elastic', 'tape', 'hook', 'drawstring', 'other'];

// Service categories
const SERVICE_CATEGORIES = ['printing', 'embroidery', 'washing', 'dyeing', 'pleating', 'other'];

export default function Materials() {
    const queryClient = useQueryClient();
    const { user } = useAuth();
    const isAdmin = user?.role === 'admin';
    const gridRef = useRef<AgGridReact>(null);
    const [searchParams, setSearchParams] = useSearchParams();

    // State from URL params (with defaults)
    const activeTab = (searchParams.get('tab') as TabType) || 'materials';
    const initialViewLevel = (searchParams.get('view') as ViewLevel) || 'colour';
    const initialMaterialFilter = searchParams.get('material') || '';
    const initialFabricFilter = searchParams.get('fabric') || '';
    const initialStatusFilter = (searchParams.get('status') as '' | 'order_now' | 'order_soon' | 'ok') || '';

    // View level state for materials tab
    const [viewLevel, setViewLevel] = useState<ViewLevel>(initialViewLevel);

    // Tree view mode - use TanStack Table instead of AG-Grid
    const [useTreeView, setUseTreeView] = useState(true);

    // Filter state
    const [searchInput, setSearchInput] = useState('');
    const [materialFilter, setMaterialFilter] = useState(initialMaterialFilter);
    const [fabricFilter, setFabricFilter] = useState(initialFabricFilter);
    const [statusFilter, setStatusFilter] = useState<'' | 'order_now' | 'order_soon' | 'ok'>(initialStatusFilter);

    // Scroll position memory
    const scrollPositions = useRef<Record<string, number>>({});

    // Sync state to URL
    useEffect(() => {
        const params: Record<string, string> = {};
        if (activeTab !== 'materials') params.tab = activeTab;
        if (viewLevel !== 'colour') params.view = viewLevel;
        if (materialFilter) params.material = materialFilter;
        if (fabricFilter) params.fabric = fabricFilter;
        if (statusFilter) params.status = statusFilter;

        setSearchParams(params, { replace: true });
    }, [activeTab, viewLevel, materialFilter, fabricFilter, statusFilter, setSearchParams]);

    // Handle tab change with context preservation
    const setActiveTab = useCallback((tab: TabType) => {
        // Save scroll position before changing tab
        const currentKey = `${activeTab}-${viewLevel}`;
        scrollPositions.current[currentKey] = gridRef.current?.api?.getFirstDisplayedRowIndex() || 0;

        // Reset filters when changing tabs
        if (tab !== 'materials') {
            setMaterialFilter('');
            setFabricFilter('');
            setStatusFilter('');
        }
    }, [activeTab, viewLevel]);

    // Handle view level change with scroll memory
    const handleViewLevelChange = useCallback((newLevel: ViewLevel) => {
        // Save current scroll position
        const currentKey = `${activeTab}-${viewLevel}`;
        scrollPositions.current[currentKey] = gridRef.current?.api?.getFirstDisplayedRowIndex() || 0;

        // Clear filters when going up the hierarchy
        if (newLevel === 'material') {
            setMaterialFilter('');
            setFabricFilter('');
        } else if (newLevel === 'fabric') {
            setFabricFilter('');
        }

        setViewLevel(newLevel);
    }, [activeTab, viewLevel]);

    // Modal states
    const [showAddMaterial, setShowAddMaterial] = useState(false);
    const [showAddFabric, setShowAddFabric] = useState<string | null>(null); // materialId
    const [showAddColour, setShowAddColour] = useState<any>(null); // fabric data
    const [showAddTrim, setShowAddTrim] = useState(false);

    // Inline editing state
    const [editingCell, setEditingCell] = useState<{ id: string; field: string } | null>(null);
    const [editValue, setEditValue] = useState<string>('');
    const [showAddService, setShowAddService] = useState(false);
    const [showAddSupplier, setShowAddSupplier] = useState(false);
    const [showInward, setShowInward] = useState<any>(null);
    const [showDetail, setShowDetail] = useState<any>(null);
    const [showEditMaterial, setShowEditMaterial] = useState<any>(null);
    const [showEditFabric, setShowEditFabric] = useState<any>(null);
    const [showEditColour, setShowEditColour] = useState<any>(null);
    const [showEditTrim, setShowEditTrim] = useState<any>(null);
    const [showEditService, setShowEditService] = useState<any>(null);

    // Form states
    const [materialForm, setMaterialForm] = useState({ name: '', description: '' });
    const [fabricForm, setFabricForm] = useState({
        materialId: '', name: '', constructionType: 'woven', pattern: '',
        weight: '' as string | number, weightUnit: 'gsm', composition: '',
        defaultCostPerUnit: '' as string | number, defaultLeadTimeDays: '' as string | number,
        defaultMinOrderQty: '' as string | number, avgShrinkagePct: 0
    });
    const [colourForm, setColourForm] = useState({
        colourName: '', standardColour: '', colourHex: '#6B8E9F',
        costPerUnit: '' as string | number, supplierId: '',
        leadTimeDays: '' as string | number, minOrderQty: '' as string | number
    });
    const [trimForm, setTrimForm] = useState({
        code: '', name: '', category: 'button', description: '',
        costPerUnit: '' as string | number, unit: 'piece',
        supplierId: '', leadTimeDays: '' as string | number, minOrderQty: '' as string | number
    });
    const [serviceForm, setServiceForm] = useState({
        code: '', name: '', category: 'printing', description: '',
        costPerJob: '' as string | number, costUnit: 'per_piece',
        vendorId: '', leadTimeDays: '' as string | number
    });
    const [supplierForm, setSupplierForm] = useState({ name: '', contactName: '', email: '', phone: '', address: '' });
    const [inwardForm, setInwardForm] = useState({ qty: 0, notes: '', costPerUnit: 0, supplierId: '' });

    // Use separate grid state hooks for each view
    const materialGridState = useGridState({
        gridId: 'materialsMaterialGrid',
        allColumnIds: MATERIAL_COLUMN_IDS,
        defaultPageSize: 100,
    });
    const fabricGridState = useGridState({
        gridId: 'materialsFabricGrid',
        allColumnIds: FABRIC_COLUMN_IDS,
        defaultPageSize: 100,
    });
    const colourGridState = useGridState({
        gridId: 'materialsColourGrid',
        allColumnIds: COLOUR_COLUMN_IDS,
        defaultPageSize: 100,
    });
    const trimGridState = useGridState({
        gridId: 'trimCatalogGrid',
        allColumnIds: TRIM_COLUMN_IDS,
        defaultPageSize: 100,
    });
    const serviceGridState = useGridState({
        gridId: 'serviceCatalogGrid',
        allColumnIds: SERVICE_COLUMN_IDS,
        defaultPageSize: 100,
    });

    // Select active grid state based on tab and view level
    const getActiveGridState = () => {
        if (activeTab === 'trims') return trimGridState;
        if (activeTab === 'services') return serviceGridState;
        if (viewLevel === 'material') return materialGridState;
        if (viewLevel === 'fabric') return fabricGridState;
        return colourGridState;
    };

    const {
        visibleColumns, columnOrder, columnWidths, pageSize,
        handleToggleColumn, handleResetAll, handleColumnMoved, handleColumnResized, handlePageSizeChange,
        isManager, hasUserCustomizations, differsFromAdminDefaults, isSavingPrefs, resetToDefaults, savePreferencesToServer,
    } = getActiveGridState();

    // Apply quick filter when search input changes
    useEffect(() => {
        const timer = setTimeout(() => {
            gridRef.current?.api?.setGridOption('quickFilterText', searchInput);
        }, 150);
        return () => clearTimeout(timer);
    }, [searchInput]);

    // Fetch materials hierarchy data
    const { data: materialsData, isLoading: materialsLoading, refetch: refetchMaterials, isFetching: materialsFetching } = useQuery({
        queryKey: ['materialsHierarchy', viewLevel, materialFilter, fabricFilter, statusFilter],
        queryFn: () => materialsApi.getHierarchy({
            view: viewLevel,
            materialId: materialFilter || undefined,
            fabricId: fabricFilter || undefined,
            ...(statusFilter && { status: statusFilter }),
        }).then(r => r.data),
        enabled: activeTab === 'materials',
    });

    // Fetch trims data
    const { data: trimsData, isLoading: trimsLoading, refetch: refetchTrims, isFetching: trimsFetching } = useQuery({
        queryKey: ['trimsCatalog'],
        queryFn: () => materialsApi.getTrims().then(r => r.data),
        enabled: activeTab === 'trims',
    });

    // Fetch services data
    const { data: servicesData, isLoading: servicesLoading, refetch: refetchServices, isFetching: servicesFetching } = useQuery({
        queryKey: ['servicesCatalog'],
        queryFn: () => materialsApi.getServices().then(r => r.data),
        enabled: activeTab === 'services',
    });

    // Fetch filter options (materials list, fabrics list)
    const { data: filterOptions } = useQuery({
        queryKey: ['materialsFilters'],
        queryFn: () => materialsApi.getFilters().then(r => r.data),
        staleTime: 5 * 60 * 1000,
    });

    // Fetch suppliers
    const { data: suppliers } = useQuery({
        queryKey: ['suppliers'],
        queryFn: () => fabricsApi.getSuppliers().then(r => r.data),
    });

    // Get display data based on active tab
    const displayData = useMemo(() => {
        if (activeTab === 'trims') return trimsData?.items || [];
        if (activeTab === 'services') return servicesData?.items || [];
        return materialsData?.items || [];
    }, [activeTab, materialsData, trimsData, servicesData]);

    // Restore scroll position after data loads
    useEffect(() => {
        const key = `${activeTab}-${viewLevel}`;
        const savedPosition = scrollPositions.current[key];
        if (savedPosition && gridRef.current?.api) {
            setTimeout(() => {
                gridRef.current?.api?.ensureIndexVisible(savedPosition, 'top');
            }, 100);
        }
    }, [activeTab, viewLevel, displayData]);

    // Loading and fetching states
    const isLoading = activeTab === 'materials' ? materialsLoading : activeTab === 'trims' ? trimsLoading : servicesLoading;
    const isFetching = activeTab === 'materials' ? materialsFetching : activeTab === 'trims' ? trimsFetching : servicesFetching;
    const refetch = activeTab === 'materials' ? refetchMaterials : activeTab === 'trims' ? refetchTrims : refetchServices;

    // Mutations
    const createMaterial = useMutation({
        mutationFn: (data: any) => materialsApi.createMaterial(data),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['materialsHierarchy'] });
            queryClient.invalidateQueries({ queryKey: ['materialsFilters'] });
            setShowAddMaterial(false);
            setMaterialForm({ name: '', description: '' });
        },
        onError: (err: any) => alert(err.response?.data?.error || 'Failed to create material'),
    });

    const updateMaterial = useMutation({
        mutationFn: ({ id, data }: { id: string; data: any }) => materialsApi.updateMaterial(id, data),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['materialsHierarchy'] });
            queryClient.invalidateQueries({ queryKey: ['materialsFilters'] });
            setShowEditMaterial(null);
        },
        onError: (err: any) => alert(err.response?.data?.error || 'Failed to update material'),
    });

    const createFabric = useMutation({
        mutationFn: (data: any) => materialsApi.createFabric(data),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['materialsHierarchy'] });
            queryClient.invalidateQueries({ queryKey: ['materialsFilters'] });
            setShowAddFabric(null);
            setFabricForm({
                materialId: '', name: '', constructionType: 'woven', pattern: '',
                weight: '', weightUnit: 'gsm', composition: '',
                defaultCostPerUnit: '', defaultLeadTimeDays: '', defaultMinOrderQty: '', avgShrinkagePct: 0
            });
        },
        onError: (err: any) => alert(err.response?.data?.error || 'Failed to create fabric'),
    });

    const updateFabric = useMutation({
        mutationFn: ({ id, data }: { id: string; data: any }) => materialsApi.updateFabric(id, data),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['materialsHierarchy'] });
            setShowEditFabric(null);
        },
        onError: (err: any) => alert(err.response?.data?.error || 'Failed to update fabric'),
    });

    const createColour = useMutation({
        mutationFn: (data: any) => materialsApi.createColour(data),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['materialsHierarchy'] });
            setShowAddColour(null);
            setColourForm({
                colourName: '', standardColour: '', colourHex: '#6B8E9F',
                costPerUnit: '', supplierId: '', leadTimeDays: '', minOrderQty: ''
            });
        },
        onError: (err: any) => alert(err.response?.data?.error || 'Failed to create colour'),
    });

    const updateColour = useMutation({
        mutationFn: ({ id, data }: { id: string; data: any }) => materialsApi.updateColour(id, data),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['materialsHierarchy'] });
            setShowEditColour(null);
            setEditingCell(null);
            setEditValue('');
        },
        onError: (err: any) => alert(err.response?.data?.error || 'Failed to update colour'),
    });

    // Handle inline edit save
    const handleInlineEditSave = useCallback((colourId: string, field: string, value: string) => {
        if (!value.trim()) {
            setEditingCell(null);
            return;
        }
        const numValue = parseFloat(value);
        if (isNaN(numValue)) {
            setEditingCell(null);
            return;
        }
        updateColour.mutate({ id: colourId, data: { [field]: numValue } });
    }, [updateColour]);

    const createTrim = useMutation({
        mutationFn: (data: any) => materialsApi.createTrim(data),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['trimsCatalog'] });
            setShowAddTrim(false);
            setTrimForm({
                code: '', name: '', category: 'button', description: '',
                costPerUnit: '', unit: 'piece', supplierId: '', leadTimeDays: '', minOrderQty: ''
            });
        },
        onError: (err: any) => alert(err.response?.data?.error || 'Failed to create trim'),
    });

    const updateTrim = useMutation({
        mutationFn: ({ id, data }: { id: string; data: any }) => materialsApi.updateTrim(id, data),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['trimsCatalog'] });
            setShowEditTrim(null);
        },
        onError: (err: any) => alert(err.response?.data?.error || 'Failed to update trim'),
    });

    const createService = useMutation({
        mutationFn: (data: any) => materialsApi.createService(data),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['servicesCatalog'] });
            setShowAddService(false);
            setServiceForm({
                code: '', name: '', category: 'printing', description: '',
                costPerJob: '', costUnit: 'per_piece', vendorId: '', leadTimeDays: ''
            });
        },
        onError: (err: any) => alert(err.response?.data?.error || 'Failed to create service'),
    });

    const updateService = useMutation({
        mutationFn: ({ id, data }: { id: string; data: any }) => materialsApi.updateService(id, data),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['servicesCatalog'] });
            setShowEditService(null);
        },
        onError: (err: any) => alert(err.response?.data?.error || 'Failed to update service'),
    });

    const createSupplier = useMutation({
        mutationFn: (data: any) => fabricsApi.createSupplier(data),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['suppliers'] });
            setShowAddSupplier(false);
            setSupplierForm({ name: '', contactName: '', email: '', phone: '', address: '' });
        },
        onError: (err: any) => alert(err.response?.data?.error || 'Failed to create supplier'),
    });

    const createInward = useMutation({
        mutationFn: ({ colourId, data }: { colourId: string; data: any }) =>
            materialsApi.createColourTransaction(colourId, data),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['materialsHierarchy'] });
            setShowInward(null);
            setInwardForm({ qty: 0, notes: '', costPerUnit: 0, supplierId: '' });
        },
        onError: (err: any) => alert(err.response?.data?.error || 'Failed to record inward'),
    });

    // Form handlers
    const handleSubmitMaterial = (e: React.FormEvent) => {
        e.preventDefault();
        createMaterial.mutate(materialForm);
    };

    const handleSubmitFabric = (e: React.FormEvent) => {
        e.preventDefault();
        createFabric.mutate({
            ...fabricForm,
            materialId: showAddFabric,
            weight: fabricForm.weight !== '' ? Number(fabricForm.weight) : null,
            defaultCostPerUnit: fabricForm.defaultCostPerUnit !== '' ? Number(fabricForm.defaultCostPerUnit) : null,
            defaultLeadTimeDays: fabricForm.defaultLeadTimeDays !== '' ? Number(fabricForm.defaultLeadTimeDays) : null,
            defaultMinOrderQty: fabricForm.defaultMinOrderQty !== '' ? Number(fabricForm.defaultMinOrderQty) : null,
        });
    };

    const handleSubmitColour = (e: React.FormEvent) => {
        e.preventDefault();
        createColour.mutate({
            fabricId: showAddColour.fabricId,
            colourName: colourForm.colourName,
            standardColour: colourForm.standardColour || null,
            colourHex: colourForm.colourHex,
            costPerUnit: colourForm.costPerUnit !== '' ? Number(colourForm.costPerUnit) : null,
            supplierId: colourForm.supplierId || null,
            leadTimeDays: colourForm.leadTimeDays !== '' ? Number(colourForm.leadTimeDays) : null,
            minOrderQty: colourForm.minOrderQty !== '' ? Number(colourForm.minOrderQty) : null,
        });
    };

    const handleSubmitTrim = (e: React.FormEvent) => {
        e.preventDefault();
        createTrim.mutate({
            ...trimForm,
            costPerUnit: trimForm.costPerUnit !== '' ? Number(trimForm.costPerUnit) : 0,
            supplierId: trimForm.supplierId || null,
            leadTimeDays: trimForm.leadTimeDays !== '' ? Number(trimForm.leadTimeDays) : null,
            minOrderQty: trimForm.minOrderQty !== '' ? Number(trimForm.minOrderQty) : null,
        });
    };

    const handleSubmitService = (e: React.FormEvent) => {
        e.preventDefault();
        createService.mutate({
            ...serviceForm,
            costPerJob: serviceForm.costPerJob !== '' ? Number(serviceForm.costPerJob) : 0,
            vendorId: serviceForm.vendorId || null,
            leadTimeDays: serviceForm.leadTimeDays !== '' ? Number(serviceForm.leadTimeDays) : null,
        });
    };

    const handleSubmitSupplier = (e: React.FormEvent) => {
        e.preventDefault();
        createSupplier.mutate(supplierForm);
    };

    const handleSubmitInward = (e: React.FormEvent) => {
        e.preventDefault();
        if (!showInward) return;
        createInward.mutate({
            colourId: showInward.colourId,
            data: {
                txnType: 'inward',
                qty: inwardForm.qty,
                reason: 'supplier_receipt',
                notes: inwardForm.notes,
                costPerUnit: inwardForm.costPerUnit || null,
                supplierId: inwardForm.supplierId || null,
            },
        });
    };

    // Grid column moved handler
    const onColumnMoved = () => {
        const api = gridRef.current?.api;
        if (api) {
            handleColumnMoved(getColumnOrderFromApi(api));
        }
    };

    // Handle column resize
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

    // Get column definitions based on active tab and view level
    const getColumnDefs = (): ColDef[] => {
        if (activeTab === 'trims') {
            return [
                { colId: 'code', headerName: 'Code', field: 'code', width: 130, pinned: 'left' as const, cellClass: 'font-mono text-xs' },
                { colId: 'name', headerName: 'Name', field: 'name', width: 180, cellClass: 'font-medium' },
                {
                    colId: 'category', headerName: 'Category', field: 'category', width: 100,
                    cellRenderer: (params: ICellRendererParams) => (
                        <span className="px-2 py-0.5 text-xs rounded-full bg-gray-100 text-gray-700 capitalize">
                            {params.value}
                        </span>
                    ),
                },
                {
                    colId: 'costPerUnit', headerName: 'Cost/Unit', field: 'costPerUnit', width: 90,
                    valueFormatter: (params: ValueFormatterParams) => params.value != null ? `₹${params.value}` : '-',
                    cellClass: 'text-right',
                },
                { colId: 'unit', headerName: 'Unit', field: 'unit', width: 70, cellClass: 'text-xs capitalize' },
                {
                    colId: 'supplierName', headerName: 'Supplier', field: 'supplierName', width: 110,
                    valueFormatter: (params: ValueFormatterParams) => params.value || '-',
                    cellClass: 'text-xs',
                },
                {
                    colId: 'leadTimeDays', headerName: 'Lead Time', field: 'leadTimeDays', width: 85,
                    valueFormatter: (params: ValueFormatterParams) => params.value != null ? `${params.value}d` : '-',
                    cellClass: 'text-right text-xs',
                },
                {
                    colId: 'minOrderQty', headerName: 'Min Order', field: 'minOrderQty', width: 85,
                    valueFormatter: (params: ValueFormatterParams) => params.value || '-',
                    cellClass: 'text-right text-xs',
                },
                {
                    colId: 'usageCount', headerName: 'Used In', field: 'usageCount', width: 75,
                    cellRenderer: (params: ICellRendererParams) => (
                        <span className="text-xs font-medium text-blue-600">{params.value || 0} BOMs</span>
                    ),
                },
                {
                    colId: 'isActive', headerName: 'Status', field: 'isActive', width: 80,
                    cellRenderer: (params: ICellRendererParams) => (
                        <span className={`px-2 py-0.5 text-xs rounded-full ${params.value ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
                            {params.value ? 'Active' : 'Inactive'}
                        </span>
                    ),
                },
                {
                    colId: 'actions', headerName: '', width: 80, pinned: 'right' as const, sortable: false,
                    cellRenderer: (params: ICellRendererParams) => {
                        const row = params.data;
                        if (!row) return null;
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
                                    onClick={() => setShowEditTrim(row)}
                                    className="p-1 rounded hover:bg-blue-100 text-gray-500 hover:text-blue-600"
                                    title="Edit trim"
                                >
                                    <Pencil size={14} />
                                </button>
                            </div>
                        );
                    },
                },
            ];
        }

        if (activeTab === 'services') {
            return [
                { colId: 'code', headerName: 'Code', field: 'code', width: 140, pinned: 'left' as const, cellClass: 'font-mono text-xs' },
                { colId: 'name', headerName: 'Name', field: 'name', width: 200, cellClass: 'font-medium' },
                {
                    colId: 'category', headerName: 'Category', field: 'category', width: 100,
                    cellRenderer: (params: ICellRendererParams) => (
                        <span className="px-2 py-0.5 text-xs rounded-full bg-purple-100 text-purple-700 capitalize">
                            {params.value}
                        </span>
                    ),
                },
                {
                    colId: 'costPerJob', headerName: 'Cost/Job', field: 'costPerJob', width: 90,
                    valueFormatter: (params: ValueFormatterParams) => params.value != null ? `₹${params.value}` : '-',
                    cellClass: 'text-right',
                },
                {
                    colId: 'costUnit', headerName: 'Cost Unit', field: 'costUnit', width: 90,
                    valueFormatter: (params: ValueFormatterParams) => {
                        const v = params.value;
                        if (!v) return '-';
                        return v === 'per_piece' ? '/pc' : v === 'per_meter' ? '/m' : v;
                    },
                    cellClass: 'text-xs text-gray-500',
                },
                {
                    colId: 'vendorName', headerName: 'Vendor', field: 'vendorName', width: 110,
                    valueFormatter: (params: ValueFormatterParams) => params.value || '-',
                    cellClass: 'text-xs',
                },
                {
                    colId: 'leadTimeDays', headerName: 'Lead Time', field: 'leadTimeDays', width: 85,
                    valueFormatter: (params: ValueFormatterParams) => params.value != null ? `${params.value}d` : '-',
                    cellClass: 'text-right text-xs',
                },
                {
                    colId: 'usageCount', headerName: 'Used In', field: 'usageCount', width: 75,
                    cellRenderer: (params: ICellRendererParams) => (
                        <span className="text-xs font-medium text-blue-600">{params.value || 0} BOMs</span>
                    ),
                },
                {
                    colId: 'isActive', headerName: 'Status', field: 'isActive', width: 80,
                    cellRenderer: (params: ICellRendererParams) => (
                        <span className={`px-2 py-0.5 text-xs rounded-full ${params.value ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
                            {params.value ? 'Active' : 'Inactive'}
                        </span>
                    ),
                },
                {
                    colId: 'actions', headerName: '', width: 80, pinned: 'right' as const, sortable: false,
                    cellRenderer: (params: ICellRendererParams) => {
                        const row = params.data;
                        if (!row) return null;
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
                                    onClick={() => setShowEditService(row)}
                                    className="p-1 rounded hover:bg-blue-100 text-gray-500 hover:text-blue-600"
                                    title="Edit service"
                                >
                                    <Pencil size={14} />
                                </button>
                            </div>
                        );
                    },
                },
            ];
        }

        // Materials tab - columns based on view level
        if (viewLevel === 'material') {
            return [
                { colId: 'name', headerName: 'Material', field: 'name', width: 180, pinned: 'left' as const, cellClass: 'font-semibold' },
                {
                    colId: 'fabricCount', headerName: 'Fabrics', field: 'fabricCount', width: 80,
                    cellRenderer: (params: ICellRendererParams) => (
                        <button
                            onClick={() => {
                                setMaterialFilter(params.data.id);
                                setViewLevel('fabric');
                            }}
                            className="text-blue-600 hover:underline font-medium"
                        >
                            {params.value}
                        </button>
                    ),
                },
                { colId: 'colourCount', headerName: 'Colours', field: 'colourCount', width: 80, cellClass: 'text-right text-xs' },
                {
                    colId: 'totalStock', headerName: 'Total Stock', field: 'totalStock', width: 100,
                    valueFormatter: (params: ValueFormatterParams) => params.value != null ? `${params.value.toFixed(1)} m` : '-',
                    cellClass: 'text-right font-medium',
                },
                {
                    colId: 'actions', headerName: '', width: 100, pinned: 'right' as const, sortable: false,
                    cellRenderer: (params: ICellRendererParams) => {
                        const row = params.data;
                        if (!row) return null;
                        return (
                            <div className="flex items-center gap-1">
                                <button
                                    onClick={() => setShowEditMaterial(row)}
                                    className="p-1 rounded hover:bg-blue-100 text-gray-500 hover:text-blue-600"
                                    title="Edit material"
                                >
                                    <Pencil size={14} />
                                </button>
                                <button
                                    onClick={() => setShowAddFabric(row.id)}
                                    className="p-1 rounded hover:bg-green-100 text-gray-500 hover:text-green-600"
                                    title="Add fabric"
                                >
                                    <Plus size={14} />
                                </button>
                            </div>
                        );
                    },
                },
            ];
        }

        if (viewLevel === 'fabric') {
            return [
                { colId: 'materialName', headerName: 'Material', field: 'materialName', width: 120, cellClass: 'text-xs text-gray-500' },
                { colId: 'name', headerName: 'Fabric', field: 'name', width: 200, pinned: 'left' as const, cellClass: 'font-medium' },
                {
                    colId: 'constructionType', headerName: 'Type', field: 'constructionType', width: 80,
                    cellRenderer: (params: ICellRendererParams) => (
                        <span className={`px-2 py-0.5 text-xs rounded-full ${params.value === 'knit' ? 'bg-blue-100 text-blue-700' : 'bg-amber-100 text-amber-700'} capitalize`}>
                            {params.value}
                        </span>
                    ),
                },
                { colId: 'pattern', headerName: 'Pattern', field: 'pattern', width: 120, cellClass: 'text-xs capitalize' },
                {
                    colId: 'weight', headerName: 'Weight', field: 'weight', width: 90,
                    valueFormatter: (params: ValueFormatterParams) => {
                        if (params.value == null) return '-';
                        const unit = params.data?.weightUnit || 'gsm';
                        return `${params.value} ${unit}`;
                    },
                    cellClass: 'text-right text-xs',
                },
                {
                    colId: 'colourCount', headerName: 'Colours', field: 'colourCount', width: 80,
                    cellRenderer: (params: ICellRendererParams) => (
                        <button
                            onClick={() => {
                                setFabricFilter(params.data.id);
                                setViewLevel('colour');
                            }}
                            className="text-blue-600 hover:underline font-medium"
                        >
                            {params.value}
                        </button>
                    ),
                },
                {
                    colId: 'defaultCostPerUnit', headerName: 'Cost/Unit', field: 'defaultCostPerUnit', width: 90,
                    valueFormatter: (params: ValueFormatterParams) => params.value != null ? `₹${params.value}` : '-',
                    cellClass: 'text-right',
                },
                {
                    colId: 'totalStock', headerName: 'Stock', field: 'totalStock', width: 90,
                    valueFormatter: (params: ValueFormatterParams) => params.value != null ? `${params.value.toFixed(1)} m` : '-',
                    cellClass: 'text-right font-medium',
                },
                {
                    colId: 'actions', headerName: '', width: 100, pinned: 'right' as const, sortable: false,
                    cellRenderer: (params: ICellRendererParams) => {
                        const row = params.data;
                        if (!row) return null;
                        return (
                            <div className="flex items-center gap-1">
                                <button
                                    onClick={() => setShowEditFabric(row)}
                                    className="p-1 rounded hover:bg-blue-100 text-gray-500 hover:text-blue-600"
                                    title="Edit fabric"
                                >
                                    <Pencil size={14} />
                                </button>
                                <button
                                    onClick={() => setShowAddColour(row)}
                                    className="p-1 rounded hover:bg-green-100 text-gray-500 hover:text-green-600"
                                    title="Add colour"
                                >
                                    <Plus size={14} />
                                </button>
                            </div>
                        );
                    },
                },
            ];
        }

        // Colour view (default) - flat single array of columns
        return [
            {
                colId: 'colourName', headerName: 'Colour', field: 'colourName', width: 160, pinned: 'left' as const,
                cellRenderer: (params: ICellRendererParams) => {
                    const { colourHex, colourName } = params.data || {};
                    return (
                        <div className="flex items-center gap-2">
                            <div
                                className="w-4 h-4 rounded-full border border-gray-300 flex-shrink-0"
                                style={{ backgroundColor: colourHex || '#ccc' }}
                            />
                            <span className="truncate font-medium">{colourName}</span>
                        </div>
                    );
                },
            },
            {
                colId: 'fabricName', headerName: 'Fabric', field: 'fabricName', width: 140,
            },
            { colId: 'materialName', headerName: 'Material', field: 'materialName', width: 100, cellClass: 'text-xs text-gray-500' },
            { colId: 'standardColour', headerName: 'Std Colour', field: 'standardColour', width: 90, cellClass: 'text-xs text-gray-500 capitalize' },
            {
                colId: 'composition', headerName: 'Composition', field: 'composition', width: 130,
                valueFormatter: (params: ValueFormatterParams) => params.value || '-',
                cellClass: 'text-xs text-gray-600',
            },
            {
                colId: 'weight', headerName: 'Weight', field: 'weight', width: 80,
                cellRenderer: (params: ICellRendererParams) => {
                    const { weight, weightUnit } = params.data || {};
                    if (weight == null) return '-';
                    return <span className="text-xs">{weight} {weightUnit || 'gsm'}</span>;
                },
            },
            {
                colId: 'costPerUnit', headerName: 'Cost/Unit', field: 'costPerUnit', width: 90,
                cellRenderer: (params: ICellRendererParams) => {
                    const { id, costPerUnit, inheritedCost } = params.data || {};
                    const effectiveCost = costPerUnit ?? inheritedCost;
                    const isInherited = costPerUnit == null && inheritedCost != null;
                    const isEditing = editingCell?.id === id && editingCell?.field === 'costPerUnit';

                    if (isEditing) {
                        return (
                            <input
                                type="number"
                                className="w-full px-1 py-0.5 text-sm border rounded bg-white text-right"
                                autoFocus
                                value={editValue}
                                onChange={(e) => setEditValue(e.target.value)}
                                onBlur={() => handleInlineEditSave(id, 'costPerUnit', editValue)}
                                onKeyDown={(e) => {
                                    if (e.key === 'Enter') handleInlineEditSave(id, 'costPerUnit', editValue);
                                    if (e.key === 'Escape') { setEditingCell(null); setEditValue(''); }
                                }}
                            />
                        );
                    }

                    return (
                        <div
                            className="flex items-center justify-end gap-1 cursor-pointer hover:bg-blue-50 px-1 -mx-1 rounded"
                            onClick={() => {
                                setEditingCell({ id, field: 'costPerUnit' });
                                setEditValue(effectiveCost?.toString() || '');
                            }}
                            title="Click to edit"
                        >
                            <span>₹{effectiveCost ?? '-'}</span>
                            {isInherited && <span className="text-gray-400 text-[10px]" title="Inherited from fabric">↑</span>}
                        </div>
                    );
                },
            },
            {
                colId: 'leadTimeDays', headerName: 'Lead (days)', field: 'leadTimeDays', width: 85,
                cellRenderer: (params: ICellRendererParams) => {
                    const { id, leadTimeDays, inheritedLeadTime } = params.data || {};
                    const effectiveLeadTime = leadTimeDays ?? inheritedLeadTime;
                    const isInherited = leadTimeDays == null && inheritedLeadTime != null;
                    const isEditing = editingCell?.id === id && editingCell?.field === 'leadTimeDays';

                    if (isEditing) {
                        return (
                            <input
                                type="number"
                                className="w-full px-1 py-0.5 text-sm border rounded bg-white text-right"
                                autoFocus
                                value={editValue}
                                onChange={(e) => setEditValue(e.target.value)}
                                onBlur={() => handleInlineEditSave(id, 'leadTimeDays', editValue)}
                                onKeyDown={(e) => {
                                    if (e.key === 'Enter') handleInlineEditSave(id, 'leadTimeDays', editValue);
                                    if (e.key === 'Escape') { setEditingCell(null); setEditValue(''); }
                                }}
                            />
                        );
                    }

                    return (
                        <div
                            className="flex items-center justify-end gap-1 text-xs cursor-pointer hover:bg-blue-50 px-1 -mx-1 rounded"
                            onClick={() => {
                                setEditingCell({ id, field: 'leadTimeDays' });
                                setEditValue(effectiveLeadTime?.toString() || '');
                            }}
                            title="Click to edit"
                        >
                            <span>{effectiveLeadTime ?? '-'}</span>
                            {isInherited && <span className="text-gray-400 text-[10px]" title="Inherited from fabric">↑</span>}
                        </div>
                    );
                },
            },
            {
                colId: 'minOrderQty', headerName: 'Min Order', field: 'minOrderQty', width: 85,
                cellRenderer: (params: ICellRendererParams) => {
                    const { id, minOrderQty, inheritedMinOrder } = params.data || {};
                    const effectiveMinOrder = minOrderQty ?? inheritedMinOrder;
                    const isInherited = minOrderQty == null && inheritedMinOrder != null;
                    const isEditing = editingCell?.id === id && editingCell?.field === 'minOrderQty';

                    if (isEditing) {
                        return (
                            <input
                                type="number"
                                className="w-full px-1 py-0.5 text-sm border rounded bg-white text-right"
                                autoFocus
                                value={editValue}
                                onChange={(e) => setEditValue(e.target.value)}
                                onBlur={() => handleInlineEditSave(id, 'minOrderQty', editValue)}
                                onKeyDown={(e) => {
                                    if (e.key === 'Enter') handleInlineEditSave(id, 'minOrderQty', editValue);
                                    if (e.key === 'Escape') { setEditingCell(null); setEditValue(''); }
                                }}
                            />
                        );
                    }

                    return (
                        <div
                            className="flex items-center justify-end gap-1 text-xs cursor-pointer hover:bg-blue-50 px-1 -mx-1 rounded"
                            onClick={() => {
                                setEditingCell({ id, field: 'minOrderQty' });
                                setEditValue(effectiveMinOrder?.toString() || '');
                            }}
                            title="Click to edit"
                        >
                            <span>{effectiveMinOrder ? `${effectiveMinOrder}m` : '-'}</span>
                            {isInherited && <span className="text-gray-400 text-[10px]" title="Inherited from fabric">↑</span>}
                        </div>
                    );
                },
            },
            {
                colId: 'supplierName', headerName: 'Supplier', field: 'supplierName', width: 100,
                valueFormatter: (params: ValueFormatterParams) => params.value || '-',
                cellClass: 'text-xs',
            },
            {
                colId: 'currentBalance', headerName: 'Balance', field: 'currentBalance', width: 80,
                valueFormatter: (params: ValueFormatterParams) => {
                    const val = params.value || 0;
                    return `${val.toFixed(1)}m`;
                },
                cellClass: (params: CellClassParams) => {
                    const val = params.value || 0;
                    if (val === 0) return 'text-right text-gray-400';
                    return 'text-right font-medium';
                },
            },
            {
                colId: 'totalInward', headerName: 'Total In', field: 'totalInward', width: 75,
                valueFormatter: (params: ValueFormatterParams) => {
                    const val = params.value || 0;
                    return val > 0 ? `+${val.toFixed(1)}` : '-';
                },
                cellClass: 'text-right text-xs text-green-600',
            },
            {
                colId: 'totalOutward', headerName: 'Total Out', field: 'totalOutward', width: 75,
                valueFormatter: (params: ValueFormatterParams) => {
                    const val = params.value || 0;
                    return val > 0 ? `-${val.toFixed(1)}` : '-';
                },
                cellClass: 'text-right text-xs text-red-600',
            },
            {
                colId: 'avgDailyConsumption', headerName: 'Avg/Day', field: 'avgDailyConsumption', width: 70,
                valueFormatter: (params: ValueFormatterParams) => {
                    const val = params.value;
                    if (val == null || val === 0) return '-';
                    return val.toFixed(2);
                },
                cellClass: 'text-right text-xs text-gray-600',
            },
            {
                colId: 'daysOfStock', headerName: 'Days Stock', field: 'daysOfStock', width: 85,
                valueFormatter: (params: ValueFormatterParams) => params.value != null ? `${params.value}d` : '-',
                cellClass: (params: CellClassParams) => {
                    const days = params.value;
                    if (days == null) return 'text-right text-xs';
                    if (days <= 7) return 'text-right text-xs text-red-600 font-medium';
                    if (days <= 14) return 'text-right text-xs text-yellow-600';
                    return 'text-right text-xs text-green-600';
                },
            },
            {
                colId: 'stockStatus', headerName: 'Status', field: 'stockStatus', width: 90,
                cellRenderer: (params: ICellRendererParams) => (
                    <FabricStatusBadge status={params.value || 'OK'} />
                ),
            },
            {
                colId: 'actions', headerName: '', width: 100, pinned: 'right' as const, sortable: false,
                cellRenderer: (params: ICellRendererParams) => {
                    const row = params.data;
                    if (!row) return null;
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
                                onClick={() => setShowEditColour(row)}
                                className="p-1 rounded hover:bg-blue-100 text-gray-500 hover:text-blue-600"
                                title="Edit colour"
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
                        </div>
                    );
                },
            },
        ];
    };

    // eslint-disable-next-line react-hooks/exhaustive-deps
    const columnDefs = useMemo(() => getColumnDefs(), [activeTab, viewLevel, isAdmin, editingCell, editValue]);

    // Get column IDs and headers for current view
    const getColumnConfig = () => {
        if (activeTab === 'trims') return { ids: TRIM_COLUMN_IDS, headers: TRIM_HEADERS };
        if (activeTab === 'services') return { ids: SERVICE_COLUMN_IDS, headers: SERVICE_HEADERS };
        if (viewLevel === 'material') return { ids: MATERIAL_COLUMN_IDS, headers: MATERIAL_HEADERS };
        if (viewLevel === 'fabric') return { ids: FABRIC_COLUMN_IDS, headers: FABRIC_HEADERS };
        return { ids: COLOUR_COLUMN_IDS, headers: COLOUR_HEADERS };
    };

    const { ids: currentColumnIds, headers: currentHeaders } = getColumnConfig();

    // Apply visibility and ordering
    const orderedColumnDefs = useMemo(() => {
        const withVisibility = applyColumnVisibility(columnDefs, visibleColumns);
        const withWidths = applyColumnWidths(withVisibility, columnWidths);
        return orderColumns(withWidths, columnOrder);
    }, [columnDefs, visibleColumns, columnWidths, columnOrder]);

    // Summary stats
    const summary = useMemo(() => {
        if (activeTab === 'trims') {
            return { total: trimsData?.items?.length || 0, active: trimsData?.items?.filter((i: any) => i.isActive).length || 0 };
        }
        if (activeTab === 'services') {
            return { total: servicesData?.items?.length || 0, active: servicesData?.items?.filter((i: any) => i.isActive).length || 0 };
        }
        return materialsData?.summary || { total: 0, orderNow: 0, orderSoon: 0, ok: 0 };
    }, [activeTab, materialsData, trimsData, servicesData]);

    // Get add button based on current view
    const getAddButton = () => {
        if (activeTab === 'trims') {
            return (
                <button onClick={() => setShowAddTrim(true)} className="btn-primary flex items-center text-sm">
                    <Plus size={18} className="mr-1.5" />Add Trim
                </button>
            );
        }
        if (activeTab === 'services') {
            return (
                <button onClick={() => setShowAddService(true)} className="btn-primary flex items-center text-sm">
                    <Plus size={18} className="mr-1.5" />Add Service
                </button>
            );
        }
        if (viewLevel === 'material') {
            return (
                <button onClick={() => setShowAddMaterial(true)} className="btn-primary flex items-center text-sm">
                    <Plus size={18} className="mr-1.5" />Add Material
                </button>
            );
        }
        return null;
    };

    return (
        <div className="space-y-4">
            {/* Header */}
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                <div>
                    <h1 className="text-xl md:text-2xl font-bold text-gray-900">Materials</h1>
                    <p className="text-sm text-gray-500">Material hierarchy, trims & services catalog</p>
                </div>
                <div className="flex flex-wrap gap-2 sm:gap-3">
                    <button onClick={() => setShowAddSupplier(true)} className="btn-secondary flex items-center text-sm">
                        <Users size={18} className="mr-1.5" />Add Supplier
                    </button>
                    {getAddButton()}
                </div>
            </div>

            {/* Tabs */}
            <div className="flex items-center gap-4">
                <div className="flex items-center gap-1 bg-gray-100 rounded-lg p-0.5 w-fit">
                    <button
                        onClick={() => { setActiveTab('materials'); setSearchParams({ view: viewLevel }); }}
                        className={`px-4 py-2 text-sm rounded-md transition-all flex items-center gap-2 ${activeTab === 'materials' ? 'bg-white shadow text-gray-900 font-medium' : 'text-gray-600 hover:text-gray-900'}`}
                    >
                        <Layers size={16} />
                        Materials
                    </button>
                    <button
                        onClick={() => { setActiveTab('trims'); setSearchParams({ tab: 'trims' }); }}
                        className={`px-4 py-2 text-sm rounded-md transition-all flex items-center gap-2 ${activeTab === 'trims' ? 'bg-white shadow text-gray-900 font-medium' : 'text-gray-600 hover:text-gray-900'}`}
                    >
                        <Scissors size={16} />
                        Trims
                    </button>
                    <button
                        onClick={() => { setActiveTab('services'); setSearchParams({ tab: 'services' }); }}
                        className={`px-4 py-2 text-sm rounded-md transition-all flex items-center gap-2 ${activeTab === 'services' ? 'bg-white shadow text-gray-900 font-medium' : 'text-gray-600 hover:text-gray-900'}`}
                    >
                        <Package size={16} />
                        Services
                    </button>
                </div>

                {/* Tree/List View Toggle (Materials tab only) */}
                {activeTab === 'materials' && (
                    <div className="flex items-center gap-1 bg-gray-100 rounded-lg p-0.5">
                        <button
                            onClick={() => setUseTreeView(true)}
                            className={`px-3 py-1.5 text-sm rounded-md transition-all flex items-center gap-1.5 ${
                                useTreeView ? 'bg-white shadow text-gray-900 font-medium' : 'text-gray-600 hover:text-gray-900'
                            }`}
                            title="Tree View - Hierarchical expand/collapse"
                        >
                            <TreeDeciduous size={14} />
                            Tree
                        </button>
                        <button
                            onClick={() => setUseTreeView(false)}
                            className={`px-3 py-1.5 text-sm rounded-md transition-all flex items-center gap-1.5 ${
                                !useTreeView ? 'bg-white shadow text-gray-900 font-medium' : 'text-gray-600 hover:text-gray-900'
                            }`}
                            title="List View - Flat table with view levels"
                        >
                            <List size={14} />
                            List
                        </button>
                    </div>
                )}
            </div>

            {/* View Level Toggle (Materials tab only, List view only) */}
            {activeTab === 'materials' && !useTreeView && (
                <div className="flex items-center gap-4">
                    <div className="flex items-center gap-1 bg-gray-100 rounded-lg p-0.5">
                        <button
                            onClick={() => handleViewLevelChange('material')}
                            className={`px-3 py-1.5 text-sm rounded-md transition-all ${viewLevel === 'material' ? 'bg-white shadow text-gray-900' : 'text-gray-600 hover:text-gray-900'}`}
                        >
                            By Material
                        </button>
                        <button
                            onClick={() => handleViewLevelChange('fabric')}
                            className={`px-3 py-1.5 text-sm rounded-md transition-all ${viewLevel === 'fabric' ? 'bg-white shadow text-gray-900' : 'text-gray-600 hover:text-gray-900'}`}
                        >
                            By Fabric
                        </button>
                        <button
                            onClick={() => handleViewLevelChange('colour')}
                            className={`px-3 py-1.5 text-sm rounded-md transition-all ${viewLevel === 'colour' ? 'bg-white shadow text-gray-900' : 'text-gray-600 hover:text-gray-900'}`}
                        >
                            By Colour
                        </button>
                    </div>

                    {/* Rich Breadcrumb Navigation */}
                    {(materialFilter || fabricFilter) && (
                        <div className="flex items-center gap-2 text-sm bg-blue-50 border border-blue-200 rounded-lg px-3 py-1.5">
                            <button
                                onClick={() => { setMaterialFilter(''); setFabricFilter(''); setStatusFilter(''); handleViewLevelChange('material'); }}
                                className="text-blue-600 hover:text-blue-800 hover:underline"
                            >
                                All Materials
                            </button>
                            {materialFilter && (
                                <>
                                    <ChevronRight size={14} className="text-blue-300" />
                                    <button
                                        onClick={() => { setFabricFilter(''); handleViewLevelChange('fabric'); }}
                                        className={fabricFilter ? 'text-blue-600 hover:text-blue-800 hover:underline' : 'text-gray-900 font-medium'}
                                    >
                                        {filterOptions?.materials?.find((m: any) => m.id === materialFilter)?.name || 'Material'}
                                    </button>
                                </>
                            )}
                            {fabricFilter && (
                                <>
                                    <ChevronRight size={14} className="text-blue-300" />
                                    <span className="text-gray-900 font-medium">
                                        {filterOptions?.fabrics?.find((f: any) => f.id === fabricFilter)?.name || 'Fabric'}
                                    </span>
                                </>
                            )}
                            <button
                                onClick={() => { setMaterialFilter(''); setFabricFilter(''); setStatusFilter(''); }}
                                className="ml-2 text-blue-400 hover:text-red-500 p-0.5 rounded hover:bg-blue-100"
                                title="Clear filters"
                            >
                                <X size={14} />
                            </button>
                        </div>
                    )}
                </div>
            )}

            {/* Tree View (Materials tab only) - Self-managed modals */}
            {activeTab === 'materials' && useTreeView && (
                <MaterialsTreeView
                    onViewDetails={(node) => setShowDetail(node)}
                    onAddInward={(node) => setShowInward(node)}
                    onAddSupplier={() => setShowAddSupplier(true)}
                />
            )}

            {/* List View - Stats bar, filters, AG-Grid (shown for trims/services OR materials list view) */}
            {(activeTab !== 'materials' || !useTreeView) && (
            <>
            {/* Enhanced Stats bar */}
            <div className="flex items-center gap-4 text-sm bg-gray-50 rounded-lg px-4 py-2">
                <div className="flex items-center gap-1.5">
                    <span className="text-gray-500">Total:</span>
                    <span className="font-semibold text-gray-900">{summary.total}</span>
                    <span className="text-gray-400">
                        {activeTab === 'materials'
                            ? (viewLevel === 'material' ? 'materials' : viewLevel === 'fabric' ? 'fabrics' : 'colours')
                            : activeTab === 'trims' ? 'trims' : 'services'
                        }
                    </span>
                </div>
                {activeTab === 'materials' && viewLevel === 'colour' && (
                    <>
                        <div className="h-4 w-px bg-gray-300" />
                        <button
                            onClick={() => setStatusFilter(statusFilter === 'order_now' ? '' : 'order_now')}
                            className={`flex items-center gap-1.5 px-2 py-0.5 rounded transition-colors ${
                                statusFilter === 'order_now' ? 'bg-red-100 ring-1 ring-red-300' : 'hover:bg-red-50'
                            }`}
                        >
                            <span className="w-2 h-2 rounded-full bg-red-500" />
                            <span className="text-red-600 font-medium">{(summary as any).orderNow || 0}</span>
                            <span className="text-red-500 text-xs">Order Now</span>
                        </button>
                        <button
                            onClick={() => setStatusFilter(statusFilter === 'order_soon' ? '' : 'order_soon')}
                            className={`flex items-center gap-1.5 px-2 py-0.5 rounded transition-colors ${
                                statusFilter === 'order_soon' ? 'bg-yellow-100 ring-1 ring-yellow-300' : 'hover:bg-yellow-50'
                            }`}
                        >
                            <span className="w-2 h-2 rounded-full bg-yellow-500" />
                            <span className="text-yellow-600 font-medium">{(summary as any).orderSoon || 0}</span>
                            <span className="text-yellow-500 text-xs">Order Soon</span>
                        </button>
                        <button
                            onClick={() => setStatusFilter(statusFilter === 'ok' ? '' : 'ok')}
                            className={`flex items-center gap-1.5 px-2 py-0.5 rounded transition-colors ${
                                statusFilter === 'ok' ? 'bg-green-100 ring-1 ring-green-300' : 'hover:bg-green-50'
                            }`}
                        >
                            <span className="w-2 h-2 rounded-full bg-green-500" />
                            <span className="text-green-600 font-medium">{(summary as any).ok || 0}</span>
                            <span className="text-green-500 text-xs">OK</span>
                        </button>
                    </>
                )}
                {(activeTab === 'trims' || activeTab === 'services') && (
                    <>
                        <div className="h-4 w-px bg-gray-300" />
                        <div className="flex items-center gap-1.5">
                            <span className="w-2 h-2 rounded-full bg-green-500" />
                            <span className="text-green-600 font-medium">{(summary as any).active || 0}</span>
                            <span className="text-gray-500 text-xs">active</span>
                        </div>
                        <div className="flex items-center gap-1.5">
                            <span className="w-2 h-2 rounded-full bg-gray-400" />
                            <span className="text-gray-500 font-medium">{(summary.total || 0) - ((summary as any).active || 0)}</span>
                            <span className="text-gray-400 text-xs">inactive</span>
                        </div>
                    </>
                )}
            </div>

            {/* Filters */}
            <div className="flex flex-wrap gap-2 md:gap-3">
                <div className="relative w-full sm:w-auto">
                    <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
                    <input
                        type="text"
                        placeholder={`Search ${activeTab}...`}
                        value={searchInput}
                        onChange={(e) => setSearchInput(e.target.value)}
                        className="pl-8 pr-3 py-1.5 text-sm border rounded-lg w-full sm:w-48 md:w-56 focus:outline-none focus:ring-2 focus:ring-gray-200"
                    />
                </div>

                {/* Material & Fabric Filters - Materials tab only */}
                {activeTab === 'materials' && (
                    <>
                        {/* Material filter - visible in fabric/colour views */}
                        {(viewLevel === 'fabric' || viewLevel === 'colour') && (
                            <select
                                value={materialFilter}
                                onChange={(e) => {
                                    setMaterialFilter(e.target.value);
                                    setFabricFilter('');
                                }}
                                className="text-sm border rounded-lg px-2 py-1.5 bg-white min-w-[120px]"
                            >
                                <option value="">All Materials</option>
                                {filterOptions?.materials?.map((m: any) => (
                                    <option key={m.id} value={m.id}>{m.name}</option>
                                ))}
                            </select>
                        )}

                        {/* Fabric filter - visible in colour view only */}
                        {viewLevel === 'colour' && (
                            <select
                                value={fabricFilter}
                                onChange={(e) => setFabricFilter(e.target.value)}
                                className="text-sm border rounded-lg px-2 py-1.5 bg-white min-w-[140px]"
                            >
                                <option value="">All Fabrics</option>
                                {(materialFilter
                                    ? filterOptions?.fabrics?.filter((f: any) => f.materialId === materialFilter)
                                    : filterOptions?.fabrics
                                )?.map((f: any) => (
                                    <option key={f.id} value={f.id}>{f.name}</option>
                                ))}
                            </select>
                        )}

                        {/* Status filter - colour view only */}
                        {viewLevel === 'colour' && (
                            <select
                                value={statusFilter}
                                onChange={(e) => setStatusFilter(e.target.value as any)}
                                className="text-sm border rounded-lg px-2 py-1.5 bg-white"
                            >
                                <option value="">All Status</option>
                                <option value="order_now">🔴 Order Now</option>
                                <option value="order_soon">🟡 Order Soon</option>
                                <option value="ok">🟢 OK</option>
                            </select>
                        )}

                        {/* Quick-add Colour dropdown - colour view only */}
                        {viewLevel === 'colour' && filterOptions?.fabrics?.length > 0 && (
                            <select
                                value=""
                                onChange={(e) => {
                                    const fabric = filterOptions.fabrics.find((f: any) => f.id === e.target.value);
                                    if (fabric) {
                                        setShowAddColour({ fabricId: fabric.id, name: fabric.name });
                                    }
                                }}
                                className="text-sm border rounded-lg px-2 py-1.5 bg-white text-green-600"
                            >
                                <option value="">+ Add Colour...</option>
                                {filterOptions.fabrics.map((f: any) => (
                                    <option key={f.id} value={f.id}>{f.name}</option>
                                ))}
                            </select>
                        )}
                    </>
                )}

                <div className="hidden sm:block sm:flex-1" />

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

                {/* Refresh Button */}
                <button
                    onClick={() => refetch()}
                    disabled={isFetching}
                    className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium text-gray-600 bg-gray-50 border border-gray-200 rounded-lg hover:bg-gray-100 hover:border-gray-300 disabled:opacity-50 transition-all"
                    title="Refresh table data"
                >
                    <RefreshCw size={14} className={isFetching ? 'animate-spin' : ''} />
                    {isFetching ? 'Refreshing...' : 'Refresh'}
                </button>

                <ColumnVisibilityDropdown
                    visibleColumns={visibleColumns}
                    onToggleColumn={handleToggleColumn}
                    onResetAll={handleResetAll}
                    columnIds={currentColumnIds}
                    columnHeaders={currentHeaders}
                />
                <GridPreferencesToolbar
                    hasUserCustomizations={hasUserCustomizations}
                    differsFromAdminDefaults={differsFromAdminDefaults}
                    isSavingPrefs={isSavingPrefs}
                    onResetToDefaults={resetToDefaults}
                    isManager={isManager}
                    onSaveAsDefaults={savePreferencesToServer}
                />
            </div>

            {/* AG-Grid */}
            <div className="table-scroll-container border rounded">
                <div style={{ minWidth: '900px', height: 'calc(100vh - 340px)', minHeight: '400px' }}>
                    <AgGridReact
                        ref={gridRef}
                        theme={compactThemeSmall}
                        rowData={displayData}
                        columnDefs={orderedColumnDefs}
                        loading={isLoading}
                        defaultColDef={{
                            sortable: true,
                            resizable: true,
                            suppressMovable: false,
                        }}
                        animateRows={false}
                        suppressCellFocus={true}
                        getRowId={(params) => params.data.id || params.data.colourId || params.data.fabricId || params.data.materialId}
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
            </>
            )}

            {/* Add Material Modal */}
            {showAddMaterial && (
                <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
                    <div className="bg-white rounded-xl p-6 w-full max-w-md">
                        <div className="flex items-center justify-between mb-4">
                            <h2 className="text-lg font-semibold">Add Material</h2>
                            <button onClick={() => setShowAddMaterial(false)} className="text-gray-400 hover:text-gray-600"><X size={20} /></button>
                        </div>
                        <form onSubmit={handleSubmitMaterial} className="space-y-4">
                            <div>
                                <label className="label">Material Name</label>
                                <input
                                    className="input"
                                    value={materialForm.name}
                                    onChange={(e) => setMaterialForm(f => ({ ...f, name: e.target.value }))}
                                    placeholder="e.g., Linen, Pima Cotton"
                                    required
                                />
                            </div>
                            <div>
                                <label className="label">Description (optional)</label>
                                <textarea
                                    className="input"
                                    rows={2}
                                    value={materialForm.description}
                                    onChange={(e) => setMaterialForm(f => ({ ...f, description: e.target.value }))}
                                    placeholder="Optional description..."
                                />
                            </div>
                            <div className="flex gap-3 pt-2">
                                <button type="button" onClick={() => setShowAddMaterial(false)} className="btn-secondary flex-1">Cancel</button>
                                <button type="submit" className="btn-primary flex-1" disabled={createMaterial.isPending}>
                                    {createMaterial.isPending ? 'Creating...' : 'Add Material'}
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}

            {/* Add Fabric Modal */}
            {showAddFabric && (
                <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
                    <div className="bg-white rounded-xl p-6 w-full max-w-lg max-h-[90vh] overflow-y-auto">
                        <div className="flex items-center justify-between mb-4">
                            <h2 className="text-lg font-semibold">Add Fabric</h2>
                            <button onClick={() => setShowAddFabric(null)} className="text-gray-400 hover:text-gray-600"><X size={20} /></button>
                        </div>
                        <div className="mb-4 p-3 bg-gray-50 rounded-lg">
                            <p className="text-sm text-gray-500">Material: <span className="font-medium text-gray-900">{filterOptions?.materials?.find((m: any) => m.id === showAddFabric)?.name}</span></p>
                        </div>
                        <form onSubmit={handleSubmitFabric} className="space-y-4">
                            <div>
                                <label className="label">Fabric Name</label>
                                <input
                                    className="input"
                                    value={fabricForm.name}
                                    onChange={(e) => setFabricForm(f => ({ ...f, name: e.target.value }))}
                                    placeholder="e.g., 60 Lea Plain Weave"
                                    required
                                />
                            </div>
                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <label className="label">Construction Type</label>
                                    <div className="flex gap-2">
                                        {CONSTRUCTION_TYPES.map(type => (
                                            <button
                                                key={type}
                                                type="button"
                                                onClick={() => setFabricForm(f => ({ ...f, constructionType: type, pattern: '' }))}
                                                className={`flex-1 py-2 px-3 text-sm rounded-lg border transition-colors capitalize ${fabricForm.constructionType === type ? 'bg-primary-50 border-primary-300 text-primary-700' : 'bg-white border-gray-200 text-gray-600 hover:bg-gray-50'}`}
                                            >
                                                {type}
                                            </button>
                                        ))}
                                    </div>
                                </div>
                                <div>
                                    <label className="label">Pattern</label>
                                    <select
                                        className="input"
                                        value={fabricForm.pattern}
                                        onChange={(e) => setFabricForm(f => ({ ...f, pattern: e.target.value }))}
                                    >
                                        <option value="">Select pattern...</option>
                                        {fabricForm.constructionType === 'knit' && (
                                            <>
                                                <option value="single_jersey">Single Jersey</option>
                                                <option value="french_terry">French Terry</option>
                                                <option value="rib">Rib</option>
                                                <option value="interlock">Interlock</option>
                                                <option value="fleece">Fleece</option>
                                                <option value="pique">Pique</option>
                                            </>
                                        )}
                                        {fabricForm.constructionType === 'woven' && (
                                            <>
                                                <option value="plain">Plain Weave</option>
                                                <option value="twill">Twill</option>
                                                <option value="satin">Satin</option>
                                                <option value="poplin">Poplin</option>
                                                <option value="chambray">Chambray</option>
                                                <option value="oxford">Oxford</option>
                                                <option value="linen_regular">Linen Regular</option>
                                            </>
                                        )}
                                    </select>
                                </div>
                            </div>
                            <div className="grid grid-cols-3 gap-4">
                                <div>
                                    <label className="label">Weight</label>
                                    <input
                                        type="number"
                                        step="0.1"
                                        className="input"
                                        value={fabricForm.weight}
                                        onChange={(e) => setFabricForm(f => ({ ...f, weight: e.target.value }))}
                                        placeholder="180"
                                    />
                                </div>
                                <div>
                                    <label className="label">Weight Unit</label>
                                    <select
                                        className="input"
                                        value={fabricForm.weightUnit}
                                        onChange={(e) => setFabricForm(f => ({ ...f, weightUnit: e.target.value }))}
                                    >
                                        <option value="gsm">GSM</option>
                                        <option value="lea">Lea</option>
                                        <option value="oz">oz/yd²</option>
                                    </select>
                                </div>
                                <div>
                                    <label className="label">Shrinkage %</label>
                                    <input
                                        type="number"
                                        step="0.1"
                                        className="input"
                                        value={fabricForm.avgShrinkagePct}
                                        onChange={(e) => setFabricForm(f => ({ ...f, avgShrinkagePct: Number(e.target.value) }))}
                                        min={0}
                                        max={100}
                                    />
                                </div>
                            </div>
                            <div>
                                <label className="label">Composition</label>
                                <input
                                    className="input"
                                    value={fabricForm.composition}
                                    onChange={(e) => setFabricForm(f => ({ ...f, composition: e.target.value }))}
                                    placeholder="e.g., 100% Linen, 55% Linen 45% Cotton"
                                />
                            </div>
                            <div className="border-t pt-4">
                                <p className="text-sm text-gray-600 mb-3">Default values (inherited by colours unless overridden):</p>
                                <div className="grid grid-cols-3 gap-4">
                                    <div>
                                        <label className="label">Cost/Unit (₹)</label>
                                        <input
                                            type="number"
                                            step="0.01"
                                            className="input"
                                            value={fabricForm.defaultCostPerUnit}
                                            onChange={(e) => setFabricForm(f => ({ ...f, defaultCostPerUnit: e.target.value }))}
                                            placeholder="0"
                                        />
                                    </div>
                                    <div>
                                        <label className="label">Lead (days)</label>
                                        <input
                                            type="number"
                                            className="input"
                                            value={fabricForm.defaultLeadTimeDays}
                                            onChange={(e) => setFabricForm(f => ({ ...f, defaultLeadTimeDays: e.target.value }))}
                                            placeholder="14"
                                        />
                                    </div>
                                    <div>
                                        <label className="label">Min Order</label>
                                        <input
                                            type="number"
                                            step="0.1"
                                            className="input"
                                            value={fabricForm.defaultMinOrderQty}
                                            onChange={(e) => setFabricForm(f => ({ ...f, defaultMinOrderQty: e.target.value }))}
                                            placeholder="10"
                                        />
                                    </div>
                                </div>
                            </div>
                            <div className="flex gap-3 pt-2">
                                <button type="button" onClick={() => setShowAddFabric(null)} className="btn-secondary flex-1">Cancel</button>
                                <button type="submit" className="btn-primary flex-1" disabled={createFabric.isPending}>
                                    {createFabric.isPending ? 'Creating...' : 'Add Fabric'}
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}

            {/* Add Colour Modal */}
            {showAddColour && (
                <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
                    <div className="bg-white rounded-xl p-6 w-full max-w-md">
                        <div className="flex items-center justify-between mb-4">
                            <h2 className="text-lg font-semibold">Add Colour</h2>
                            <button onClick={() => setShowAddColour(null)} className="text-gray-400 hover:text-gray-600"><X size={20} /></button>
                        </div>
                        <div className="mb-4 p-3 bg-gray-50 rounded-lg">
                            <p className="text-sm text-gray-500">Fabric: <span className="font-medium text-gray-900">{showAddColour.name}</span></p>
                        </div>
                        <form onSubmit={handleSubmitColour} className="space-y-4">
                            <div className="grid grid-cols-3 gap-4">
                                <div>
                                    <label className="label">Colour Name</label>
                                    <input
                                        className="input"
                                        value={colourForm.colourName}
                                        onChange={(e) => setColourForm(f => ({ ...f, colourName: e.target.value }))}
                                        placeholder="e.g., Navy Blue"
                                        required
                                    />
                                </div>
                                <div>
                                    <label className="label">Standard Colour</label>
                                    <select
                                        className="input"
                                        value={colourForm.standardColour}
                                        onChange={(e) => {
                                            const color = e.target.value;
                                            setColourForm(f => ({
                                                ...f,
                                                standardColour: color,
                                                colourHex: color ? STANDARD_COLOR_HEX[color] : f.colourHex,
                                            }));
                                        }}
                                    >
                                        <option value="">Select...</option>
                                        {STANDARD_COLORS.map(c => <option key={c} value={c}>{c}</option>)}
                                    </select>
                                </div>
                                <div>
                                    <label className="label">Colour</label>
                                    <input
                                        type="color"
                                        className="input h-10"
                                        value={colourForm.colourHex}
                                        onChange={(e) => setColourForm(f => ({ ...f, colourHex: e.target.value }))}
                                    />
                                </div>
                            </div>
                            <div>
                                <label className="label">Supplier (optional)</label>
                                <select
                                    className="input"
                                    value={colourForm.supplierId}
                                    onChange={(e) => setColourForm(f => ({ ...f, supplierId: e.target.value }))}
                                >
                                    <option value="">No supplier</option>
                                    {suppliers?.map((s: any) => <option key={s.id} value={s.id}>{s.name}</option>)}
                                </select>
                            </div>
                            <div className="border-t pt-4">
                                <p className="text-sm text-gray-600 mb-3">Leave blank to inherit from fabric defaults:</p>
                                <div className="grid grid-cols-3 gap-4">
                                    <div>
                                        <label className="label">Cost/Unit (₹)</label>
                                        <input
                                            type="number"
                                            className="input"
                                            value={colourForm.costPerUnit}
                                            onChange={(e) => setColourForm(f => ({ ...f, costPerUnit: e.target.value }))}
                                            placeholder="Inherit"
                                        />
                                    </div>
                                    <div>
                                        <label className="label">Lead (days)</label>
                                        <input
                                            type="number"
                                            className="input"
                                            value={colourForm.leadTimeDays}
                                            onChange={(e) => setColourForm(f => ({ ...f, leadTimeDays: e.target.value }))}
                                            placeholder="Inherit"
                                        />
                                    </div>
                                    <div>
                                        <label className="label">Min Order</label>
                                        <input
                                            type="number"
                                            className="input"
                                            value={colourForm.minOrderQty}
                                            onChange={(e) => setColourForm(f => ({ ...f, minOrderQty: e.target.value }))}
                                            placeholder="Inherit"
                                        />
                                    </div>
                                </div>
                            </div>
                            <div className="flex gap-3 pt-2">
                                <button type="button" onClick={() => setShowAddColour(null)} className="btn-secondary flex-1">Cancel</button>
                                <button type="submit" className="btn-primary flex-1" disabled={createColour.isPending}>
                                    {createColour.isPending ? 'Creating...' : 'Add Colour'}
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}

            {/* Add Trim Modal */}
            {showAddTrim && (
                <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
                    <div className="bg-white rounded-xl p-6 w-full max-w-md">
                        <div className="flex items-center justify-between mb-4">
                            <h2 className="text-lg font-semibold">Add Trim</h2>
                            <button onClick={() => setShowAddTrim(false)} className="text-gray-400 hover:text-gray-600"><X size={20} /></button>
                        </div>
                        <form onSubmit={handleSubmitTrim} className="space-y-4">
                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <label className="label">Code</label>
                                    <input
                                        className="input font-mono"
                                        value={trimForm.code}
                                        onChange={(e) => setTrimForm(f => ({ ...f, code: e.target.value.toUpperCase() }))}
                                        placeholder="BTN-SHELL-18L"
                                        required
                                    />
                                </div>
                                <div>
                                    <label className="label">Category</label>
                                    <select
                                        className="input"
                                        value={trimForm.category}
                                        onChange={(e) => setTrimForm(f => ({ ...f, category: e.target.value }))}
                                    >
                                        {TRIM_CATEGORIES.map(c => <option key={c} value={c} className="capitalize">{c}</option>)}
                                    </select>
                                </div>
                            </div>
                            <div>
                                <label className="label">Name</label>
                                <input
                                    className="input"
                                    value={trimForm.name}
                                    onChange={(e) => setTrimForm(f => ({ ...f, name: e.target.value }))}
                                    placeholder="e.g., Shell Button 18L"
                                    required
                                />
                            </div>
                            <div>
                                <label className="label">Description (optional)</label>
                                <textarea
                                    className="input"
                                    rows={2}
                                    value={trimForm.description}
                                    onChange={(e) => setTrimForm(f => ({ ...f, description: e.target.value }))}
                                />
                            </div>
                            <div className="grid grid-cols-3 gap-4">
                                <div>
                                    <label className="label">Cost/Unit (₹)</label>
                                    <input
                                        type="number"
                                        step="0.01"
                                        className="input"
                                        value={trimForm.costPerUnit}
                                        onChange={(e) => setTrimForm(f => ({ ...f, costPerUnit: e.target.value }))}
                                        required
                                    />
                                </div>
                                <div>
                                    <label className="label">Unit</label>
                                    <select
                                        className="input"
                                        value={trimForm.unit}
                                        onChange={(e) => setTrimForm(f => ({ ...f, unit: e.target.value }))}
                                    >
                                        <option value="piece">Piece</option>
                                        <option value="meter">Meter</option>
                                        <option value="spool">Spool</option>
                                        <option value="set">Set</option>
                                    </select>
                                </div>
                                <div>
                                    <label className="label">Lead (days)</label>
                                    <input
                                        type="number"
                                        className="input"
                                        value={trimForm.leadTimeDays}
                                        onChange={(e) => setTrimForm(f => ({ ...f, leadTimeDays: e.target.value }))}
                                    />
                                </div>
                            </div>
                            <div>
                                <label className="label">Supplier (optional)</label>
                                <select
                                    className="input"
                                    value={trimForm.supplierId}
                                    onChange={(e) => setTrimForm(f => ({ ...f, supplierId: e.target.value }))}
                                >
                                    <option value="">No supplier</option>
                                    {suppliers?.map((s: any) => <option key={s.id} value={s.id}>{s.name}</option>)}
                                </select>
                            </div>
                            <div className="flex gap-3 pt-2">
                                <button type="button" onClick={() => setShowAddTrim(false)} className="btn-secondary flex-1">Cancel</button>
                                <button type="submit" className="btn-primary flex-1" disabled={createTrim.isPending}>
                                    {createTrim.isPending ? 'Creating...' : 'Add Trim'}
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}

            {/* Add Service Modal */}
            {showAddService && (
                <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
                    <div className="bg-white rounded-xl p-6 w-full max-w-md">
                        <div className="flex items-center justify-between mb-4">
                            <h2 className="text-lg font-semibold">Add Service</h2>
                            <button onClick={() => setShowAddService(false)} className="text-gray-400 hover:text-gray-600"><X size={20} /></button>
                        </div>
                        <form onSubmit={handleSubmitService} className="space-y-4">
                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <label className="label">Code</label>
                                    <input
                                        className="input font-mono"
                                        value={serviceForm.code}
                                        onChange={(e) => setServiceForm(f => ({ ...f, code: e.target.value.toUpperCase() }))}
                                        placeholder="PRINT-BLOCK-01"
                                        required
                                    />
                                </div>
                                <div>
                                    <label className="label">Category</label>
                                    <select
                                        className="input"
                                        value={serviceForm.category}
                                        onChange={(e) => setServiceForm(f => ({ ...f, category: e.target.value }))}
                                    >
                                        {SERVICE_CATEGORIES.map(c => <option key={c} value={c} className="capitalize">{c}</option>)}
                                    </select>
                                </div>
                            </div>
                            <div>
                                <label className="label">Name</label>
                                <input
                                    className="input"
                                    value={serviceForm.name}
                                    onChange={(e) => setServiceForm(f => ({ ...f, name: e.target.value }))}
                                    placeholder="e.g., Block Print - Indigo Floral"
                                    required
                                />
                            </div>
                            <div>
                                <label className="label">Description (optional)</label>
                                <textarea
                                    className="input"
                                    rows={2}
                                    value={serviceForm.description}
                                    onChange={(e) => setServiceForm(f => ({ ...f, description: e.target.value }))}
                                />
                            </div>
                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <label className="label">Cost/Job (₹)</label>
                                    <input
                                        type="number"
                                        step="0.01"
                                        className="input"
                                        value={serviceForm.costPerJob}
                                        onChange={(e) => setServiceForm(f => ({ ...f, costPerJob: e.target.value }))}
                                        required
                                    />
                                </div>
                                <div>
                                    <label className="label">Cost Unit</label>
                                    <select
                                        className="input"
                                        value={serviceForm.costUnit}
                                        onChange={(e) => setServiceForm(f => ({ ...f, costUnit: e.target.value }))}
                                    >
                                        <option value="per_piece">Per Piece</option>
                                        <option value="per_meter">Per Meter</option>
                                    </select>
                                </div>
                            </div>
                            <div className="flex gap-3 pt-2">
                                <button type="button" onClick={() => setShowAddService(false)} className="btn-secondary flex-1">Cancel</button>
                                <button type="submit" className="btn-primary flex-1" disabled={createService.isPending}>
                                    {createService.isPending ? 'Creating...' : 'Add Service'}
                                </button>
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
                                <input
                                    className="input"
                                    value={supplierForm.name}
                                    onChange={(e) => setSupplierForm(f => ({ ...f, name: e.target.value }))}
                                    placeholder="e.g., ABC Textiles"
                                    required
                                />
                            </div>
                            <div>
                                <label className="label">Contact Name</label>
                                <input
                                    className="input"
                                    value={supplierForm.contactName}
                                    onChange={(e) => setSupplierForm(f => ({ ...f, contactName: e.target.value }))}
                                />
                            </div>
                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <label className="label">Email</label>
                                    <input
                                        type="email"
                                        className="input"
                                        value={supplierForm.email}
                                        onChange={(e) => setSupplierForm(f => ({ ...f, email: e.target.value }))}
                                    />
                                </div>
                                <div>
                                    <label className="label">Phone</label>
                                    <input
                                        className="input"
                                        value={supplierForm.phone}
                                        onChange={(e) => setSupplierForm(f => ({ ...f, phone: e.target.value }))}
                                    />
                                </div>
                            </div>
                            <div>
                                <label className="label">Address</label>
                                <textarea
                                    className="input"
                                    rows={2}
                                    value={supplierForm.address}
                                    onChange={(e) => setSupplierForm(f => ({ ...f, address: e.target.value }))}
                                />
                            </div>
                            <div className="flex gap-3 pt-2">
                                <button type="button" onClick={() => setShowAddSupplier(false)} className="btn-secondary flex-1">Cancel</button>
                                <button type="submit" className="btn-primary flex-1" disabled={createSupplier.isPending}>
                                    {createSupplier.isPending ? 'Creating...' : 'Add Supplier'}
                                </button>
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
                            <div className="w-6 h-6 rounded-full" style={{ backgroundColor: showInward.colourHex || '#ccc' }} />
                            <div>
                                <p className="font-medium">{showInward.colourName}</p>
                                <p className="text-xs text-gray-500">{showInward.fabricName}</p>
                            </div>
                        </div>
                        <form onSubmit={handleSubmitInward} className="space-y-4">
                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <label className="label">Quantity (meters)</label>
                                    <input
                                        type="number"
                                        step="0.1"
                                        className="input"
                                        value={inwardForm.qty}
                                        onChange={(e) => setInwardForm(f => ({ ...f, qty: Number(e.target.value) }))}
                                        min={0.1}
                                        required
                                    />
                                </div>
                                <div>
                                    <label className="label">Price/Unit (₹)</label>
                                    <input
                                        type="number"
                                        step="0.01"
                                        className="input"
                                        value={inwardForm.costPerUnit}
                                        onChange={(e) => setInwardForm(f => ({ ...f, costPerUnit: Number(e.target.value) }))}
                                        placeholder={showInward.effectiveCostPerUnit?.toString() || '0'}
                                    />
                                </div>
                            </div>
                            <div>
                                <label className="label">Supplier</label>
                                <select
                                    className="input"
                                    value={inwardForm.supplierId}
                                    onChange={(e) => setInwardForm(f => ({ ...f, supplierId: e.target.value }))}
                                >
                                    <option value="">Select supplier</option>
                                    {suppliers?.map((s: any) => <option key={s.id} value={s.id}>{s.name}</option>)}
                                </select>
                            </div>
                            <div>
                                <label className="label">Notes (optional)</label>
                                <input
                                    className="input"
                                    value={inwardForm.notes}
                                    onChange={(e) => setInwardForm(f => ({ ...f, notes: e.target.value }))}
                                    placeholder="e.g., PO #1234, Invoice ref"
                                />
                            </div>
                            <div className="flex gap-3 pt-2">
                                <button type="button" onClick={() => setShowInward(null)} className="btn-secondary flex-1">Cancel</button>
                                <button type="submit" className="btn-primary flex-1" disabled={createInward.isPending}>
                                    {createInward.isPending ? 'Saving...' : 'Add to Inventory'}
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}

            {/* Detail Slide-out Panel */}
            <DetailPanel
                item={showDetail}
                type={
                    activeTab === 'trims' ? 'trim' :
                    activeTab === 'services' ? 'service' :
                    viewLevel === 'colour' ? 'colour' :
                    viewLevel === 'fabric' ? 'fabric' : 'material'
                }
                isOpen={!!showDetail}
                onClose={() => setShowDetail(null)}
                onEdit={() => {
                    if (activeTab === 'trims') setShowEditTrim(showDetail);
                    else if (activeTab === 'services') setShowEditService(showDetail);
                    else if (viewLevel === 'colour') setShowEditColour(showDetail);
                    else if (viewLevel === 'fabric') setShowEditFabric(showDetail);
                    else setShowEditMaterial(showDetail);
                    setShowDetail(null);
                }}
            />

            {/* Unified Edit Modal - handles Material, Fabric, Colour, Trim, Service */}
            <MaterialEditModal
                type={
                    showEditMaterial ? 'material' :
                    showEditFabric ? 'fabric' :
                    showEditColour ? 'colour' :
                    showEditTrim ? 'trim' :
                    showEditService ? 'service' : 'material'
                }
                item={showEditMaterial || showEditFabric || showEditColour || showEditTrim || showEditService}
                isOpen={!!(showEditMaterial || showEditFabric || showEditColour || showEditTrim || showEditService)}
                onClose={() => {
                    setShowEditMaterial(null);
                    setShowEditFabric(null);
                    setShowEditColour(null);
                    setShowEditTrim(null);
                    setShowEditService(null);
                }}
            />
        </div>
    );
}
