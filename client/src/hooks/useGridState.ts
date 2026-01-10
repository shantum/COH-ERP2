/**
 * Hook for managing AG-Grid state with localStorage persistence
 * Handles column visibility, column order, column widths, and page size
 */

import { useState, useCallback, useEffect, useRef } from 'react';

interface UseGridStateOptions {
    gridId: string;
    allColumnIds: string[];
    defaultPageSize?: number;
    defaultHiddenColumns?: string[]; // Columns hidden by default when no localStorage state exists
}

interface UseGridStateReturn {
    visibleColumns: Set<string>;
    columnOrder: string[];
    columnWidths: Record<string, number>;
    pageSize: number;
    handleToggleColumn: (colId: string) => void;
    handleResetAll: () => void;
    handleColumnMoved: (newOrder: string[]) => void;
    handleColumnResized: (colId: string, width: number) => void;
    handlePageSizeChange: (newSize: number) => void;
}

export function useGridState({
    gridId,
    allColumnIds,
    defaultPageSize = 100,
    defaultHiddenColumns = [],
}: UseGridStateOptions): UseGridStateReturn {
    // Keys for localStorage
    const visibilityKey = `${gridId}VisibleColumns`;
    const orderKey = `${gridId}ColumnOrder`;
    const widthsKey = `${gridId}ColumnWidths`;
    const pageSizeKey = `${gridId}PageSize`;

    // Compute default visible columns (all except defaultHiddenColumns)
    const defaultVisibleColumns = new Set(
        allColumnIds.filter(id => !defaultHiddenColumns.includes(id))
    );

    // Column visibility state
    const [visibleColumns, setVisibleColumns] = useState<Set<string>>(() => {
        const saved = localStorage.getItem(visibilityKey);
        if (saved) {
            try {
                return new Set(JSON.parse(saved));
            } catch {
                return defaultVisibleColumns;
            }
        }
        return defaultVisibleColumns;
    });

    // Column order state
    const [columnOrder, setColumnOrder] = useState<string[]>(() => {
        const saved = localStorage.getItem(orderKey);
        if (saved) {
            try {
                return JSON.parse(saved);
            } catch {
                return allColumnIds;
            }
        }
        return allColumnIds;
    });

    // Column widths state
    const [columnWidths, setColumnWidths] = useState<Record<string, number>>(() => {
        const saved = localStorage.getItem(widthsKey);
        if (saved) {
            try {
                return JSON.parse(saved);
            } catch {
                return {};
            }
        }
        return {};
    });

    // Page size state
    const [pageSize, setPageSize] = useState<number>(() => {
        const saved = localStorage.getItem(pageSizeKey);
        return saved ? parseInt(saved, 10) : defaultPageSize;
    });

    // Debounce timer for width changes (to avoid saving on every pixel)
    const widthSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

    // Persist to localStorage
    useEffect(() => {
        localStorage.setItem(visibilityKey, JSON.stringify([...visibleColumns]));
    }, [visibleColumns, visibilityKey]);

    useEffect(() => {
        localStorage.setItem(orderKey, JSON.stringify(columnOrder));
    }, [columnOrder, orderKey]);

    useEffect(() => {
        // Debounce width saves to avoid excessive writes during drag
        if (widthSaveTimer.current) {
            clearTimeout(widthSaveTimer.current);
        }
        widthSaveTimer.current = setTimeout(() => {
            localStorage.setItem(widthsKey, JSON.stringify(columnWidths));
        }, 300);
        return () => {
            if (widthSaveTimer.current) {
                clearTimeout(widthSaveTimer.current);
            }
        };
    }, [columnWidths, widthsKey]);

    useEffect(() => {
        localStorage.setItem(pageSizeKey, String(pageSize));
    }, [pageSize, pageSizeKey]);

    // Handlers
    const handleToggleColumn = useCallback((colId: string) => {
        setVisibleColumns(prev => {
            const next = new Set(prev);
            if (next.has(colId)) {
                next.delete(colId);
            } else {
                next.add(colId);
            }
            return next;
        });
    }, []);

    const handleResetAll = useCallback(() => {
        setVisibleColumns(defaultVisibleColumns);
        setColumnOrder([...allColumnIds]);
        setColumnWidths({});
    }, [allColumnIds, defaultVisibleColumns]);

    const handleColumnMoved = useCallback((newOrder: string[]) => {
        if (newOrder.length > 0) {
            setColumnOrder(newOrder);
        }
    }, []);

    const handleColumnResized = useCallback((colId: string, width: number) => {
        if (colId && width > 0) {
            setColumnWidths(prev => ({
                ...prev,
                [colId]: width,
            }));
        }
    }, []);

    const handlePageSizeChange = useCallback((newSize: number) => {
        setPageSize(newSize);
    }, []);

    return {
        visibleColumns,
        columnOrder,
        columnWidths,
        pageSize,
        handleToggleColumn,
        handleResetAll,
        handleColumnMoved,
        handleColumnResized,
        handlePageSizeChange,
    };
}

/**
 * Helper to get column order from AG-Grid API
 */
export function getColumnOrderFromApi(api: any): string[] {
    return api.getAllDisplayedColumns()
        .map((col: any) => col.getColId())
        .filter((id: string | undefined): id is string => id !== undefined);
}

/**
 * Helper to apply visibility to column definitions
 */
export function applyColumnVisibility<T extends { colId?: string; field?: string }>(
    columnDefs: T[],
    visibleColumns: Set<string>
): (T & { hide: boolean })[] {
    return columnDefs.map(col => {
        const colId = col.colId || col.field;
        return {
            ...col,
            hide: colId ? !visibleColumns.has(colId) : false,
        };
    });
}

/**
 * Helper to order columns based on saved order
 */
export function orderColumns<T extends { colId?: string }>(
    columnDefs: T[],
    columnOrder: string[]
): T[] {
    const colMap = new Map(columnDefs.map(col => [col.colId, col]));
    const ordered: T[] = [];

    // Add columns in saved order
    for (const colId of columnOrder) {
        const col = colMap.get(colId);
        if (col) {
            ordered.push(col);
            colMap.delete(colId);
        }
    }

    // Add any remaining columns
    for (const col of colMap.values()) {
        ordered.push(col);
    }

    return ordered;
}

/**
 * Helper to apply saved column widths to column definitions
 */
export function applyColumnWidths<T extends { colId?: string; field?: string; width?: number }>(
    columnDefs: T[],
    columnWidths: Record<string, number>
): T[] {
    return columnDefs.map(col => {
        const colId = col.colId || col.field;
        const savedWidth = colId ? columnWidths[colId] : undefined;
        if (savedWidth) {
            return { ...col, width: savedWidth };
        }
        return col;
    });
}
