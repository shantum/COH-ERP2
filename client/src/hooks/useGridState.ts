/**
 * Hook for managing AG-Grid state with localStorage persistence
 * Handles column visibility, column order, column widths, and page size
 *
 * Preference hierarchy:
 * 1. User's saved preferences (database) - highest priority
 * 2. Admin defaults (SystemSetting) - fallback
 * 3. Code defaults (component props) - lowest priority
 *
 * Features:
 * - All users can save their own preferences (auto-saves on change)
 * - Admins can save defaults that apply to all users
 *
 * Migrated to use Server Functions instead of Axios API calls.
 */

import { useState, useCallback, useEffect, useRef, useMemo } from 'react';
import {
    getAdminGridPreferences,
    getUserPreferences,
    updateUserPreferences,
    deleteUserPreferences,
    updateAdminGridPreferences,
} from '../server/functions/admin';
import type { UserPreferences, AdminGridPreferences } from '../server/functions/admin';
import { usePermissions } from './usePermissions';

interface UseGridStateOptions {
    gridId: string;
    allColumnIds: string[];
    defaultPageSize?: number;
    defaultHiddenColumns?: string[]; // Columns hidden by default when no preferences exist
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
    // User preferences
    hasUnsavedChanges: boolean;
    hasUserCustomizations: boolean; // True if user has any saved customizations
    differsFromAdminDefaults: boolean; // True if current state differs from admin defaults
    isSavingPrefs: boolean;
    resetToDefaults: () => Promise<boolean>;
    // Admin-only: save as defaults for all users
    isManager: boolean;
    savePreferencesToServer: () => Promise<boolean>;
}

interface AdminPrefs {
    visibleColumns: string[];
    columnOrder: string[];
    columnWidths: Record<string, number>;
    updatedAt?: string;
}

interface UserPrefs {
    visibleColumns: string[];
    columnOrder: string[];
    columnWidths: Record<string, number>;
    adminVersion: string | null;
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
    const defaultVisibleColumns = useMemo(() => new Set(
        allColumnIds.filter(id => !defaultHiddenColumns.includes(id))
    ), [allColumnIds, defaultHiddenColumns]);

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

    // Debounce timer for width changes
    const widthSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

    // Preference loading state
    const [prefsLoaded, setPrefsLoaded] = useState(false);
    const [isSavingPrefs, setIsSavingPrefs] = useState(false);

    // Saved preferences for comparison
    const [savedUserPrefs, setSavedUserPrefs] = useState<UserPrefs | null>(null);
    const [savedAdminPrefs, setSavedAdminPrefs] = useState<AdminPrefs | null>(null);


    // Check if user is admin (Owner or Manager)
    const { isManager } = usePermissions();

    // Fetch both admin and user preferences on mount
    useEffect(() => {
        if (prefsLoaded) return;

        const fetchPreferences = async () => {
            try {
                // Fetch both in parallel using Server Functions
                const [adminResult, userResult] = await Promise.all([
                    getAdminGridPreferences({ data: { gridId } }).catch(() => ({ success: true, data: null })),
                    getUserPreferences({ data: { gridId } }).catch(() => ({ success: true, data: null })),
                ]);

                const adminPrefs = adminResult.success ? adminResult.data as AdminGridPreferences | null : null;
                const userPrefs = userResult.success ? userResult.data as UserPreferences | null : null;

                // Store admin prefs for reference
                if (adminPrefs && adminPrefs.visibleColumns?.length > 0) {
                    setSavedAdminPrefs({
                        visibleColumns: adminPrefs.visibleColumns,
                        columnOrder: adminPrefs.columnOrder,
                        columnWidths: adminPrefs.columnWidths,
                        updatedAt: adminPrefs.updatedAt || undefined,
                    });
                }

                // Determine which preferences to apply
                if (userPrefs && userPrefs.visibleColumns?.length > 0) {
                    // User has saved preferences - use them
                    setVisibleColumns(new Set(userPrefs.visibleColumns));
                    if (userPrefs.columnOrder?.length > 0) {
                        setColumnOrder(userPrefs.columnOrder);
                    }
                    if (userPrefs.columnWidths && Object.keys(userPrefs.columnWidths).length > 0) {
                        setColumnWidths(userPrefs.columnWidths);
                    }
                    setSavedUserPrefs({
                        visibleColumns: userPrefs.visibleColumns,
                        columnOrder: userPrefs.columnOrder,
                        columnWidths: userPrefs.columnWidths,
                        adminVersion: userPrefs.adminVersion,
                    });

                    // Persist to localStorage for offline use
                    localStorage.setItem(visibilityKey, JSON.stringify(userPrefs.visibleColumns));
                    if (userPrefs.columnOrder) localStorage.setItem(orderKey, JSON.stringify(userPrefs.columnOrder));
                    if (userPrefs.columnWidths) localStorage.setItem(widthsKey, JSON.stringify(userPrefs.columnWidths));
                } else if (adminPrefs && adminPrefs.visibleColumns?.length > 0) {
                    // No user prefs, use admin defaults
                    setVisibleColumns(new Set(adminPrefs.visibleColumns));
                    if (adminPrefs.columnOrder?.length > 0) {
                        setColumnOrder(adminPrefs.columnOrder);
                    }
                    if (adminPrefs.columnWidths && Object.keys(adminPrefs.columnWidths).length > 0) {
                        setColumnWidths(adminPrefs.columnWidths);
                    }

                    // Persist to localStorage for offline use
                    localStorage.setItem(visibilityKey, JSON.stringify(adminPrefs.visibleColumns));
                    if (adminPrefs.columnOrder) localStorage.setItem(orderKey, JSON.stringify(adminPrefs.columnOrder));
                    if (adminPrefs.columnWidths) localStorage.setItem(widthsKey, JSON.stringify(adminPrefs.columnWidths));
                }
                // If neither exists, keep localStorage/default values
            } catch (error) {
                // Preferences not available, continue with localStorage values
                console.error('Failed to fetch grid preferences:', error);
            } finally {
                setPrefsLoaded(true);
            }
        };

        fetchPreferences();
    }, [prefsLoaded, gridId, allColumnIds, visibilityKey, orderKey, widthsKey]);

    // Detect if current preferences differ from saved user preferences
    const hasUnsavedChanges = useMemo(() => {
        if (!prefsLoaded) return false;

        const currentVisible = [...visibleColumns].sort();

        // If user has saved prefs, compare against those
        if (savedUserPrefs) {
            const savedVisible = [...savedUserPrefs.visibleColumns].sort();
            if (JSON.stringify(currentVisible) !== JSON.stringify(savedVisible)) return true;
            if (JSON.stringify(columnOrder) !== JSON.stringify(savedUserPrefs.columnOrder)) return true;

            // Column widths comparison
            const currentWidthKeys = Object.keys(columnWidths).sort();
            const savedWidthKeys = Object.keys(savedUserPrefs.columnWidths).sort();
            if (JSON.stringify(currentWidthKeys) !== JSON.stringify(savedWidthKeys)) return true;
            for (const key of currentWidthKeys) {
                if (columnWidths[key] !== savedUserPrefs.columnWidths[key]) return true;
            }
            return false;
        }

        // If no saved user prefs, compare against admin defaults or code defaults
        const referencePrefs = savedAdminPrefs || {
            visibleColumns: [...defaultVisibleColumns],
            columnOrder: allColumnIds,
            columnWidths: {},
        };

        const refVisible = [...referencePrefs.visibleColumns].sort();
        if (JSON.stringify(currentVisible) !== JSON.stringify(refVisible)) return true;
        if (JSON.stringify(columnOrder) !== JSON.stringify(referencePrefs.columnOrder)) return true;

        // Only consider width changes if there are any saved widths
        if (Object.keys(columnWidths).length > 0 || Object.keys(referencePrefs.columnWidths).length > 0) {
            const currentWidthKeys = Object.keys(columnWidths).sort();
            const savedWidthKeys = Object.keys(referencePrefs.columnWidths).sort();
            if (JSON.stringify(currentWidthKeys) !== JSON.stringify(savedWidthKeys)) return true;
            for (const key of currentWidthKeys) {
                if (columnWidths[key] !== referencePrefs.columnWidths[key]) return true;
            }
        }

        return false;
    }, [prefsLoaded, savedUserPrefs, savedAdminPrefs, visibleColumns, columnOrder, columnWidths, defaultVisibleColumns, allColumnIds]);

    // Detect if current state differs from admin defaults (for "Set as default" button)
    const differsFromAdminDefaults = useMemo(() => {
        if (!prefsLoaded) return false;

        const currentVisible = [...visibleColumns].sort();
        const referencePrefs = savedAdminPrefs || {
            visibleColumns: [...defaultVisibleColumns],
            columnOrder: allColumnIds,
            columnWidths: {},
        };

        const refVisible = [...referencePrefs.visibleColumns].sort();
        if (JSON.stringify(currentVisible) !== JSON.stringify(refVisible)) return true;
        if (JSON.stringify(columnOrder) !== JSON.stringify(referencePrefs.columnOrder)) return true;

        return false;
    }, [prefsLoaded, savedAdminPrefs, visibleColumns, columnOrder, defaultVisibleColumns, allColumnIds]);

    // Save user preferences
    const saveUserPreferences = useCallback(async (): Promise<boolean> => {
        setIsSavingPrefs(true);
        try {
            const result = await updateUserPreferences({
                data: {
                    gridId,
                    visibleColumns: [...visibleColumns],
                    columnOrder,
                    columnWidths,
                    adminVersion: savedAdminPrefs?.updatedAt || undefined,
                },
            });

            if (result.success) {
                // Update saved reference
                setSavedUserPrefs({
                    visibleColumns: [...visibleColumns],
                    columnOrder,
                    columnWidths,
                    adminVersion: savedAdminPrefs?.updatedAt || null,
                });
                return true;
            }
            return false;
        } catch (error) {
            console.error('Failed to save user preferences:', error);
            return false;
        } finally {
            setIsSavingPrefs(false);
        }
    }, [visibleColumns, columnOrder, columnWidths, gridId, savedAdminPrefs]);

    // Auto-save user preferences when changes are detected (debounced)
    const autoSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
    useEffect(() => {
        if (!prefsLoaded || !hasUnsavedChanges) return;

        // Clear any pending save
        if (autoSaveTimer.current) {
            clearTimeout(autoSaveTimer.current);
        }

        // Debounce save by 1 second
        autoSaveTimer.current = setTimeout(() => {
            saveUserPreferences();
        }, 1000);

        return () => {
            if (autoSaveTimer.current) {
                clearTimeout(autoSaveTimer.current);
            }
        };
    }, [prefsLoaded, hasUnsavedChanges, saveUserPreferences]);

    // Reset to admin defaults
    const resetToDefaults = useCallback(async (): Promise<boolean> => {
        setIsSavingPrefs(true);
        try {
            // Delete user preferences using Server Function
            await deleteUserPreferences({ data: { gridId } });

            // Apply admin defaults or code defaults
            if (savedAdminPrefs) {
                setVisibleColumns(new Set(savedAdminPrefs.visibleColumns));
                setColumnOrder(savedAdminPrefs.columnOrder);
                setColumnWidths(savedAdminPrefs.columnWidths);
            } else {
                setVisibleColumns(defaultVisibleColumns);
                setColumnOrder([...allColumnIds]);
                setColumnWidths({});
            }

            // Clear saved user prefs
            setSavedUserPrefs(null);

            return true;
        } catch (error) {
            console.error('Failed to reset preferences:', error);
            return false;
        } finally {
            setIsSavingPrefs(false);
        }
    }, [gridId, savedAdminPrefs, defaultVisibleColumns, allColumnIds]);

    // Admin-only: save as defaults for all users
    const savePreferencesToServer = useCallback(async (): Promise<boolean> => {
        if (!isManager) return false;
        setIsSavingPrefs(true);
        try {
            const result = await updateAdminGridPreferences({
                data: {
                    gridId,
                    visibleColumns: [...visibleColumns],
                    columnOrder,
                    columnWidths,
                },
            });

            if (result.success && result.data) {
                // Update admin prefs reference with new timestamp
                setSavedAdminPrefs({
                    visibleColumns: [...visibleColumns],
                    columnOrder,
                    columnWidths,
                    updatedAt: result.data.updatedAt || new Date().toISOString(),
                });
                return true;
            }
            return false;
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
        // Reset to admin defaults if available, otherwise code defaults
        if (savedAdminPrefs) {
            setVisibleColumns(new Set(savedAdminPrefs.visibleColumns));
            setColumnOrder(savedAdminPrefs.columnOrder);
            setColumnWidths(savedAdminPrefs.columnWidths);
        } else {
            setVisibleColumns(defaultVisibleColumns);
            setColumnOrder([...allColumnIds]);
            setColumnWidths({});
        }
    }, [savedAdminPrefs, allColumnIds, defaultVisibleColumns]);

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
        // User preferences
        hasUnsavedChanges,
        hasUserCustomizations: savedUserPrefs !== null,
        differsFromAdminDefaults,
        isSavingPrefs,
        resetToDefaults,
        // Admin-only
        isManager,
        savePreferencesToServer,
    };
}

/**
 * Helper to get column order from AG-Grid API
 */
export function getColumnOrderFromApi(api: { getAllDisplayedColumns(): Array<{ getColId(): string | undefined }> }): string[] {
    return api.getAllDisplayedColumns()
        .map((col) => col.getColId())
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
