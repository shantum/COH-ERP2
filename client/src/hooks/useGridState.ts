/**
 * Hook for managing AG-Grid state with localStorage persistence
 * Handles column visibility, column order, and page size
 */

import { useState, useCallback, useEffect } from 'react';

interface UseGridStateOptions {
    gridId: string;
    allColumnIds: string[];
    defaultPageSize?: number;
}

interface UseGridStateReturn {
    visibleColumns: Set<string>;
    columnOrder: string[];
    pageSize: number;
    handleToggleColumn: (colId: string) => void;
    handleResetAll: () => void;
    handleColumnMoved: (newOrder: string[]) => void;
    handlePageSizeChange: (newSize: number) => void;
}

export function useGridState({
    gridId,
    allColumnIds,
    defaultPageSize = 100,
}: UseGridStateOptions): UseGridStateReturn {
    // Keys for localStorage
    const visibilityKey = `${gridId}VisibleColumns`;
    const orderKey = `${gridId}ColumnOrder`;
    const pageSizeKey = `${gridId}PageSize`;

    // Column visibility state
    const [visibleColumns, setVisibleColumns] = useState<Set<string>>(() => {
        const saved = localStorage.getItem(visibilityKey);
        if (saved) {
            try {
                return new Set(JSON.parse(saved));
            } catch {
                return new Set(allColumnIds);
            }
        }
        return new Set(allColumnIds);
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

    // Page size state
    const [pageSize, setPageSize] = useState<number>(() => {
        const saved = localStorage.getItem(pageSizeKey);
        return saved ? parseInt(saved, 10) : defaultPageSize;
    });

    // Persist to localStorage
    useEffect(() => {
        localStorage.setItem(visibilityKey, JSON.stringify([...visibleColumns]));
    }, [visibleColumns, visibilityKey]);

    useEffect(() => {
        localStorage.setItem(orderKey, JSON.stringify(columnOrder));
    }, [columnOrder, orderKey]);

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
        setVisibleColumns(new Set(allColumnIds));
        setColumnOrder([...allColumnIds]);
    }, [allColumnIds]);

    const handleColumnMoved = useCallback((newOrder: string[]) => {
        if (newOrder.length > 0) {
            setColumnOrder(newOrder);
        }
    }, []);

    const handlePageSizeChange = useCallback((newSize: number) => {
        setPageSize(newSize);
    }, []);

    return {
        visibleColumns,
        columnOrder,
        pageSize,
        handleToggleColumn,
        handleResetAll,
        handleColumnMoved,
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
