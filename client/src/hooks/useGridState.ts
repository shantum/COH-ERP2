/**
 * Hook for managing AG-Grid state with localStorage persistence
 * Handles column visibility, column order, column widths, and page size
 * Supports server sync for sharing preferences across all users (admin feature)
 */

import { useState, useCallback, useEffect, useRef, useMemo } from 'react';
import { adminApi } from '../services/api';
import { usePermissions } from './usePermissions';

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
    // Server sync functionality
    isManager: boolean;
    hasUnsavedChanges: boolean;
    isSavingPrefs: boolean;
    savePreferencesToServer: () => Promise<boolean>;
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

    // Server sync state
    const [serverPrefsLoaded, setServerPrefsLoaded] = useState(false);
    const [isSavingPrefs, setIsSavingPrefs] = useState(false);
    const [savedServerPrefs, setSavedServerPrefs] = useState<{
        visibleColumns: string[];
        columnOrder: string[];
        columnWidths: Record<string, number>;
    } | null>(null);

    // Check if user is admin (Owner or Manager)
    const { isManager } = usePermissions();

    // Fetch server preferences on mount and apply them (overrides localStorage)
    useEffect(() => {
        if (serverPrefsLoaded) return;

        adminApi.getGridPreferences(gridId)
            .then((res) => {
                const prefs = res.data;
                if (prefs && prefs.visibleColumns && prefs.visibleColumns.length > 0) {
                    // Apply server preferences
                    setVisibleColumns(new Set(prefs.visibleColumns));
                    if (prefs.columnOrder && prefs.columnOrder.length > 0) {
                        setColumnOrder(prefs.columnOrder);
                    }
                    if (prefs.columnWidths && Object.keys(prefs.columnWidths).length > 0) {
                        setColumnWidths(prefs.columnWidths);
                    }
                    // Store as reference for change detection
                    setSavedServerPrefs({
                        visibleColumns: prefs.visibleColumns,
                        columnOrder: prefs.columnOrder || allColumnIds,
                        columnWidths: prefs.columnWidths || {},
                    });
                    // Also persist to localStorage for offline use
                    localStorage.setItem(visibilityKey, JSON.stringify(prefs.visibleColumns));
                    if (prefs.columnOrder) localStorage.setItem(orderKey, JSON.stringify(prefs.columnOrder));
                    if (prefs.columnWidths) localStorage.setItem(widthsKey, JSON.stringify(prefs.columnWidths));
                }
            })
            .catch(() => {
                // Server preferences not available, continue with localStorage values
            })
            .finally(() => {
                setServerPrefsLoaded(true);
            });
    }, [serverPrefsLoaded, gridId, allColumnIds, visibilityKey, orderKey, widthsKey]);

    // Detect if current preferences differ from saved server preferences
    const hasUnsavedChanges = useMemo(() => {
        if (!serverPrefsLoaded) return false;

        // If no server prefs saved yet, any local config is "new"
        if (!savedServerPrefs) {
            // Only show as changed if user has customized from defaults
            const currentVisible = [...visibleColumns].sort();
            const defaultVisible = [...defaultVisibleColumns].sort();
            const visibilityChanged = JSON.stringify(currentVisible) !== JSON.stringify(defaultVisible);
            const orderChanged = JSON.stringify(columnOrder) !== JSON.stringify(allColumnIds);
            return visibilityChanged || orderChanged;
        }

        // Compare with saved server preferences
        const currentVisible = [...visibleColumns].sort();
        const savedVisible = [...savedServerPrefs.visibleColumns].sort();
        if (JSON.stringify(currentVisible) !== JSON.stringify(savedVisible)) return true;

        if (JSON.stringify(columnOrder) !== JSON.stringify(savedServerPrefs.columnOrder)) return true;

        // Column widths comparison
        const currentWidthKeys = Object.keys(columnWidths).sort();
        const savedWidthKeys = Object.keys(savedServerPrefs.columnWidths).sort();
        if (JSON.stringify(currentWidthKeys) !== JSON.stringify(savedWidthKeys)) return true;
        for (const key of currentWidthKeys) {
            if (columnWidths[key] !== savedServerPrefs.columnWidths[key]) return true;
        }

        return false;
    }, [serverPrefsLoaded, savedServerPrefs, visibleColumns, columnOrder, columnWidths, defaultVisibleColumns, allColumnIds]);

    // Function for admin to save current preferences to server
    const savePreferencesToServer = useCallback(async (): Promise<boolean> => {
        if (!isManager) return false;
        setIsSavingPrefs(true);
        try {
            const newPrefs = {
                visibleColumns: [...visibleColumns],
                columnOrder,
                columnWidths,
            };
            await adminApi.saveGridPreferences(gridId, newPrefs);
            // Update saved reference so button hides
            setSavedServerPrefs(newPrefs);
            return true;
        } catch (error) {
            console.error('Failed to save grid preferences:', error);
            return false;
        } finally {
            setIsSavingPrefs(false);
        }
    }, [isManager, visibleColumns, columnOrder, columnWidths, gridId]);

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
        // Server sync functionality
        isManager,
        hasUnsavedChanges,
        isSavingPrefs,
        savePreferencesToServer,
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
