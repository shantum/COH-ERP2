/**
 * AG-Grid Permission-Aware Column Utilities
 * 
 * Provides hooks and column builders that respect user permissions
 * for viewing and editing columns.
 * 
 * Usage:
 * import { usePermissionColumns, createPermissionColumn } from '../hooks/usePermissionColumns';
 * 
 * const baseColumns = [
 *   createSkuColumn(),
 *   createPermissionColumn('fabricCost', 'Fabric Cost', {
 *     viewPermission: 'products:view:cost',
 *     editPermission: 'products:edit:cost',
 *   }),
 * ];
 * 
 * const columns = usePermissionColumns(baseColumns);
 */

import { useMemo } from 'react';
import type { ColDef } from 'ag-grid-community';
import { usePermissions } from './usePermissions';
import { formatCurrency } from '../utils/agGridHelpers';

// ============================================
// TYPES
// ============================================

export interface PermissionAwareColumnOptions extends Partial<ColDef> {
    /** Permission required to view this column (null column returned if missing) */
    viewPermission?: string;
    /** Permission required to edit cells in this column */
    editPermission?: string;
}

// Extended ColDef with permission metadata
export interface PermissionColDef extends ColDef {
    viewPermission?: string;
    editPermission?: string;
}

// ============================================
// HOOK: usePermissionColumns
// ============================================

/**
 * Filter and transform column definitions based on user permissions.
 * 
 * - Removes columns where user lacks viewPermission
 * - Wraps editable callback to check editPermission
 * 
 * @param columns Array of column definitions (some may be null)
 * @returns Filtered columns with permission-aware editable callbacks
 */
export function usePermissionColumns<T extends PermissionColDef>(
    columns: (T | null | undefined)[]
): T[] {
    const { hasPermission } = usePermissions();

    return useMemo(() => {
        return columns
            // Remove null/undefined columns (permission-blocked at creation time)
            .filter((col): col is T => col != null)
            // Filter by viewPermission
            .filter(col => {
                if (!col.viewPermission) return true;
                return hasPermission(col.viewPermission);
            })
            // Transform editable to check editPermission
            .map(col => {
                if (!col.editPermission) return col;

                const originalEditable = col.editable;

                return {
                    ...col,
                    editable: (params: any) => {
                        // First check permission
                        if (!hasPermission(col.editPermission!)) return false;

                        // Then check original editable logic
                        if (typeof originalEditable === 'function') {
                            return originalEditable(params);
                        }
                        return originalEditable ?? false;
                    },
                };
            });
    }, [columns, hasPermission]);
}

// ============================================
// PERMISSION-AWARE COLUMN BUILDERS
// ============================================

/**
 * Create a currency column with permission controls
 */
export function createCostColumn(
    field: string,
    headerName: string,
    options: PermissionAwareColumnOptions = {}
): PermissionColDef {
    const { viewPermission, editPermission, ...colOptions } = options;

    return {
        field,
        headerName,
        width: 120,
        type: 'numericColumn',
        valueFormatter: (params) => formatCurrency(params.value),
        filter: 'agNumberColumnFilter',
        viewPermission,
        editPermission,
        ...colOptions,
    };
}

/**
 * Create a confidential number column (consumption, financial data, etc.)
 */
export function createConfidentialColumn(
    field: string,
    headerName: string,
    options: PermissionAwareColumnOptions = {}
): PermissionColDef {
    const { viewPermission, editPermission, ...colOptions } = options;

    return {
        field,
        headerName,
        width: 100,
        type: 'numericColumn',
        filter: 'agNumberColumnFilter',
        viewPermission,
        editPermission,
        ...colOptions,
    };
}

/**
 * Create a set of standard cost columns for products
 * These are automatically permission-gated for products:view:cost
 */
export function createProductCostColumns(): PermissionColDef[] {
    return [
        createCostColumn('fabricCost', 'Fabric Cost', {
            viewPermission: 'products:view:cost',
        }),
        createCostColumn('laborCost', 'Labor Cost', {
            viewPermission: 'products:view:cost',
        }),
        createCostColumn('trimsCost', 'Trims Cost', {
            viewPermission: 'products:view:cost',
            editPermission: 'products:edit:cost',
            editable: true,
        }),
        createCostColumn('liningCost', 'Lining Cost', {
            viewPermission: 'products:view:cost',
            editPermission: 'products:edit:cost',
            editable: true,
        }),
        createCostColumn('packagingCost', 'Packaging Cost', {
            viewPermission: 'products:view:cost',
            editPermission: 'products:edit:cost',
            editable: true,
        }),
        createCostColumn('totalCogs', 'COGS', {
            viewPermission: 'products:view:cost',
        }),
        createConfidentialColumn('costMultiple', 'Cost Multiple', {
            viewPermission: 'products:view:cost',
            valueFormatter: (params) => params.value ? `${params.value.toFixed(1)}x` : '-',
        }),
    ];
}

/**
 * Create consumption column for products
 */
export function createConsumptionColumn(
    field: string = 'fabricConsumption',
    headerName: string = 'Consumption'
): PermissionColDef {
    return createConfidentialColumn(field, headerName, {
        viewPermission: 'products:view:consumption',
        editPermission: 'products:edit:consumption',
        editable: true,
        valueFormatter: (params) => params.value ? `${params.value.toFixed(2)}m` : '-',
    });
}

/**
 * Create financial columns for orders (totalAmount, unitPrice, etc.)
 */
export function createOrderFinancialColumns(): PermissionColDef[] {
    return [
        createCostColumn('totalAmount', 'Total', {
            viewPermission: 'orders:view:financial',
        }),
        createCostColumn('unitPrice', 'Unit Price', {
            viewPermission: 'orders:view:financial',
        }),
    ];
}

// ============================================
// UTILITY: Check if any columns require permissions
// ============================================

/**
 * Get list of required permissions for a set of columns
 * Useful for debugging and documentation
 */
export function getRequiredPermissions(columns: PermissionColDef[]): string[] {
    const permissions = new Set<string>();

    for (const col of columns) {
        if (col.viewPermission) permissions.add(col.viewPermission);
        if (col.editPermission) permissions.add(col.editPermission);
    }

    return Array.from(permissions);
}
