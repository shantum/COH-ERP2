/**
 * Hook for managing OrdersTable state with localStorage persistence
 * Handles column visibility, column order, column widths
 *
 * Adapted from useGridState.ts for TanStack Table
 *
 * Migrated to use Server Functions instead of Axios API calls.
 */

import { useState, useCallback, useEffect, useRef, useMemo } from 'react';
import type { ColumnOrderState, VisibilityState, ColumnSizingState } from '@tanstack/react-table';
import {
    getAdminGridPreferences,
    getUserPreferences,
    updateUserPreferences,
    deleteUserPreferences,
    updateAdminGridPreferences,
} from '../../../server/functions/admin';
import type { UserPreferences, AdminGridPreferences } from '../../../server/functions/admin';
import { usePermissions } from '../../../hooks/usePermissions';
import { ALL_COLUMN_IDS, DEFAULT_VISIBLE_COLUMNS, DEFAULT_COLUMN_WIDTHS, TABLE_ID } from './constants';
import { reportError } from '@/utils/errorReporter';

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

interface UseOrdersTableStateReturn {
    // TanStack Table state
    columnVisibility: VisibilityState;
    columnOrder: ColumnOrderState;
    columnSizing: ColumnSizingState;

    // State setters for TanStack Table
    setColumnVisibility: React.Dispatch<React.SetStateAction<VisibilityState>>;
    setColumnOrder: React.Dispatch<React.SetStateAction<ColumnOrderState>>;
    setColumnSizing: React.Dispatch<React.SetStateAction<ColumnSizingState>>;

    // Actions
    handleToggleColumn: (colId: string) => void;
    handleResetAll: () => void;

    // User preferences
    hasUserCustomizations: boolean;
    differsFromAdminDefaults: boolean;
    isSavingPrefs: boolean;
    resetToDefaults: () => Promise<boolean>;

    // Admin-only
    isManager: boolean;
    savePreferencesToServer: () => Promise<boolean>;
}

// localStorage keys
const VISIBILITY_KEY = `${TABLE_ID}ColumnVisibility`;
const ORDER_KEY = `${TABLE_ID}ColumnOrder`;
const SIZING_KEY = `${TABLE_ID}ColumnSizing`;

// Convert default visible columns array to visibility state
function getDefaultVisibility(): VisibilityState {
    const visibility: VisibilityState = {};
    ALL_COLUMN_IDS.forEach(id => {
        visibility[id] = (DEFAULT_VISIBLE_COLUMNS as readonly string[]).includes(id);
    });
    return visibility;
}

// Convert visibility state to array for API
function visibilityToArray(visibility: VisibilityState): string[] {
    return Object.entries(visibility)
        .filter(([, visible]) => visible)
        .map(([id]) => id);
}

// Convert array to visibility state
function arrayToVisibility(columns: string[]): VisibilityState {
    const visibility: VisibilityState = {};
    ALL_COLUMN_IDS.forEach(id => {
        visibility[id] = columns.includes(id);
    });
    return visibility;
}

// Migration: map old column IDs to new ones
// v7: 'order' split into orderInfo + customerInfo + paymentInfo
const COLUMN_MIGRATIONS: Record<string, string> = {
    // v7: old combined 'order' → orderInfo (primary)
    'order': 'orderInfo',
    // v3: orderCustomer → customerInfo
    'orderCustomer': 'customerInfo',
    // v1: old granular columns → appropriate new column
    'orderDate': 'orderInfo',
    'orderAge': 'orderInfo',
    'orderNumber': 'orderInfo',
    'customerName': 'customerInfo',
    'city': 'customerInfo',
    'customerOrderCount': 'customerInfo',
    'customerLtv': 'customerInfo',
    'paymentMethod': 'paymentInfo',
    'orderValue': 'paymentInfo',
    'discountCode': 'paymentInfo',
    'rtoHistory': 'paymentInfo',
    // Other migrations
    'skuCode': 'productName',
    'shopifyStatus': 'shopifyTracking',
    'shopifyAwb': 'shopifyTracking',
    'shopifyCourier': 'shopifyTracking',
    // v4: skuStock merged into qty
    'skuStock': 'qty',
    // v6: awb + courier merged into trackingInfo
    'awb': 'trackingInfo',
    'courier': 'trackingInfo',
};

// Special migration: old 'order' column expands to three new columns
const ORDER_EXPANSION = ['orderInfo', 'customerInfo', 'paymentInfo'];

// Migrate old column IDs to new ones
function migrateColumns(columns: string[]): string[] {
    const migrated = new Set<string>();
    for (const col of columns) {
        // Special case: 'order' expands to three columns
        if (col === 'order') {
            ORDER_EXPANSION.forEach(c => migrated.add(c));
        } else if (COLUMN_MIGRATIONS[col]) {
            migrated.add(COLUMN_MIGRATIONS[col]);
        } else if ((ALL_COLUMN_IDS as readonly string[]).includes(col)) {
            migrated.add(col);
        }
    }
    return Array.from(migrated);
}

// Migrate column order - filter out old IDs and add new ones
function migrateColumnOrder(order: string[]): string[] {
    const validOrder: string[] = [];
    const seen = new Set<string>();

    for (const col of order) {
        // Special case: 'order' expands to three columns in order
        if (col === 'order') {
            ORDER_EXPANSION.forEach(c => {
                if (!seen.has(c)) {
                    validOrder.push(c);
                    seen.add(c);
                }
            });
        } else {
            const mappedCol = COLUMN_MIGRATIONS[col] || col;
            if ((ALL_COLUMN_IDS as readonly string[]).includes(mappedCol) && !seen.has(mappedCol)) {
                validOrder.push(mappedCol);
                seen.add(mappedCol);
            }
        }
    }

    // Add any missing columns from ALL_COLUMN_IDS
    for (const col of ALL_COLUMN_IDS) {
        if (!seen.has(col)) {
            validOrder.push(col);
        }
    }

    return validOrder;
}

// SSR-safe localStorage access
function getFromLocalStorage<T>(key: string, fallback: T): T {
    if (typeof window === 'undefined') return fallback;
    try {
        const saved = localStorage.getItem(key);
        if (saved) return JSON.parse(saved);
    } catch {
        // Ignore parse errors
    }
    return fallback;
}

export function useOrdersTableState(): UseOrdersTableStateReturn {
    // Default visibility state
    const defaultVisibility = useMemo(() => getDefaultVisibility(), []);

    // Column visibility state - SSR-safe initialization
    const [columnVisibility, setColumnVisibility] = useState<VisibilityState>(() => {
        if (typeof window === 'undefined') return getDefaultVisibility();
        const saved = getFromLocalStorage<VisibilityState | null>(VISIBILITY_KEY, null);
        if (saved) {
            // Migrate old visibility state
            const visibleCols = Object.entries(saved)
                .filter(([, visible]) => visible)
                .map(([id]) => id);
            const migratedCols = migrateColumns(visibleCols);
            return arrayToVisibility(migratedCols);
        }
        return getDefaultVisibility();
    });

    // Column order state - SSR-safe initialization
    const [columnOrder, setColumnOrder] = useState<ColumnOrderState>(() => {
        if (typeof window === 'undefined') return [...ALL_COLUMN_IDS];
        const saved = getFromLocalStorage<string[] | null>(ORDER_KEY, null);
        if (saved) {
            return migrateColumnOrder(saved);
        }
        return [...ALL_COLUMN_IDS];
    });

    // Column sizing state - SSR-safe initialization
    const [columnSizing, setColumnSizing] = useState<ColumnSizingState>(() => {
        if (typeof window === 'undefined') return DEFAULT_COLUMN_WIDTHS as ColumnSizingState;
        return getFromLocalStorage<ColumnSizingState>(SIZING_KEY, DEFAULT_COLUMN_WIDTHS as ColumnSizingState);
    });

    // Debounce timer for width changes
    const sizingSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

    // Preference loading state
    const [prefsLoaded, setPrefsLoaded] = useState(false);
    const [isSavingPrefs, setIsSavingPrefs] = useState(false);

    // Saved preferences for comparison
    const [savedUserPrefs, setSavedUserPrefs] = useState<UserPrefs | null>(null);
    const [savedAdminPrefs, setSavedAdminPrefs] = useState<AdminPrefs | null>(null);

    // Check if user is admin
    const { isManager } = usePermissions();

    // Fetch preferences on mount
    useEffect(() => {
        if (prefsLoaded) return;

        const fetchPreferences = async () => {
            try {
                // Fetch both in parallel using Server Functions
                const [adminResult, userResult] = await Promise.all([
                    getAdminGridPreferences({ data: { gridId: TABLE_ID } }).catch(() => ({ success: true, data: null })),
                    getUserPreferences({ data: { gridId: TABLE_ID } }).catch(() => ({ success: true, data: null })),
                ]);

                const adminPrefs = adminResult.success ? adminResult.data as AdminGridPreferences | null : null;
                const userPrefs = userResult.success ? userResult.data as UserPreferences | null : null;

                if (adminPrefs && adminPrefs.visibleColumns?.length > 0) {
                    setSavedAdminPrefs({
                        visibleColumns: adminPrefs.visibleColumns,
                        columnOrder: adminPrefs.columnOrder,
                        columnWidths: adminPrefs.columnWidths,
                        updatedAt: adminPrefs.updatedAt || undefined,
                    });
                }

                if (userPrefs && userPrefs.visibleColumns?.length > 0) {
                    const migratedVisible = migrateColumns(userPrefs.visibleColumns);
                    const migratedOrder = userPrefs.columnOrder?.length > 0
                        ? migrateColumnOrder(userPrefs.columnOrder)
                        : [...ALL_COLUMN_IDS];

                    setColumnVisibility(arrayToVisibility(migratedVisible));
                    setColumnOrder(migratedOrder);
                    if (userPrefs.columnWidths && Object.keys(userPrefs.columnWidths).length > 0) {
                        setColumnSizing(userPrefs.columnWidths);
                    }
                    setSavedUserPrefs({
                        visibleColumns: migratedVisible,
                        columnOrder: migratedOrder,
                        columnWidths: userPrefs.columnWidths,
                        adminVersion: userPrefs.adminVersion,
                    });

                    // Persist migrated values to localStorage (SSR-safe)
                    if (typeof window !== 'undefined') {
                        localStorage.setItem(VISIBILITY_KEY, JSON.stringify(arrayToVisibility(migratedVisible)));
                        localStorage.setItem(ORDER_KEY, JSON.stringify(migratedOrder));
                        if (userPrefs.columnWidths) localStorage.setItem(SIZING_KEY, JSON.stringify(userPrefs.columnWidths));
                    }
                } else if (adminPrefs && adminPrefs.visibleColumns?.length > 0) {
                    const migratedVisible = migrateColumns(adminPrefs.visibleColumns);
                    const migratedOrder = adminPrefs.columnOrder?.length > 0
                        ? migrateColumnOrder(adminPrefs.columnOrder)
                        : [...ALL_COLUMN_IDS];

                    setColumnVisibility(arrayToVisibility(migratedVisible));
                    setColumnOrder(migratedOrder);
                    if (adminPrefs.columnWidths && Object.keys(adminPrefs.columnWidths).length > 0) {
                        setColumnSizing(adminPrefs.columnWidths);
                    }

                    // Persist migrated values to localStorage (SSR-safe)
                    if (typeof window !== 'undefined') {
                        localStorage.setItem(VISIBILITY_KEY, JSON.stringify(arrayToVisibility(migratedVisible)));
                        localStorage.setItem(ORDER_KEY, JSON.stringify(migratedOrder));
                        if (adminPrefs.columnWidths) localStorage.setItem(SIZING_KEY, JSON.stringify(adminPrefs.columnWidths));
                    }
                }
            } catch (error) {
                console.error('Failed to fetch grid preferences:', error);
                reportError(error, { hook: 'useOrdersTableState', action: 'fetchPreferences' });
            } finally {
                setPrefsLoaded(true);
            }
        };

        fetchPreferences();
    }, [prefsLoaded]);

    // Detect if current state differs from saved user preferences
    const hasUnsavedChanges = useMemo(() => {
        if (!prefsLoaded) return false;

        const currentVisible = visibilityToArray(columnVisibility).sort();

        if (savedUserPrefs) {
            const savedVisible = [...savedUserPrefs.visibleColumns].sort();
            if (JSON.stringify(currentVisible) !== JSON.stringify(savedVisible)) return true;
            if (JSON.stringify(columnOrder) !== JSON.stringify(savedUserPrefs.columnOrder)) return true;

            const currentSizingKeys = Object.keys(columnSizing).sort();
            const savedSizingKeys = Object.keys(savedUserPrefs.columnWidths).sort();
            if (JSON.stringify(currentSizingKeys) !== JSON.stringify(savedSizingKeys)) return true;
            for (const key of currentSizingKeys) {
                if (columnSizing[key] !== savedUserPrefs.columnWidths[key]) return true;
            }
            return false;
        }

        const referencePrefs = savedAdminPrefs || {
            visibleColumns: DEFAULT_VISIBLE_COLUMNS,
            columnOrder: [...ALL_COLUMN_IDS],
            columnWidths: DEFAULT_COLUMN_WIDTHS,
        };

        const refVisible = [...referencePrefs.visibleColumns].sort();
        if (JSON.stringify(currentVisible) !== JSON.stringify(refVisible)) return true;
        if (JSON.stringify(columnOrder) !== JSON.stringify(referencePrefs.columnOrder)) return true;

        return false;
    }, [prefsLoaded, savedUserPrefs, savedAdminPrefs, columnVisibility, columnOrder, columnSizing]);

    // Detect if differs from admin defaults
    const differsFromAdminDefaults = useMemo(() => {
        if (!prefsLoaded) return false;

        const currentVisible = visibilityToArray(columnVisibility).sort();
        const referencePrefs = savedAdminPrefs || {
            visibleColumns: DEFAULT_VISIBLE_COLUMNS,
            columnOrder: [...ALL_COLUMN_IDS],
        };

        const refVisible = [...referencePrefs.visibleColumns].sort();
        if (JSON.stringify(currentVisible) !== JSON.stringify(refVisible)) return true;
        if (JSON.stringify(columnOrder) !== JSON.stringify(referencePrefs.columnOrder)) return true;

        return false;
    }, [prefsLoaded, savedAdminPrefs, columnVisibility, columnOrder]);

    // Save user preferences
    const saveUserPreferences = useCallback(async (): Promise<boolean> => {
        setIsSavingPrefs(true);
        try {
            const result = await updateUserPreferences({
                data: {
                    gridId: TABLE_ID,
                    visibleColumns: visibilityToArray(columnVisibility),
                    columnOrder,
                    columnWidths: columnSizing,
                    adminVersion: savedAdminPrefs?.updatedAt || undefined,
                },
            });

            if (result.success) {
                setSavedUserPrefs({
                    visibleColumns: visibilityToArray(columnVisibility),
                    columnOrder,
                    columnWidths: columnSizing,
                    adminVersion: savedAdminPrefs?.updatedAt || null,
                });
                return true;
            }
            return false;
        } catch (error) {
            console.error('Failed to save user preferences:', error);
            reportError(error, { hook: 'useOrdersTableState', action: 'savePreferences' });
            return false;
        } finally {
            setIsSavingPrefs(false);
        }
    }, [columnVisibility, columnOrder, columnSizing, savedAdminPrefs]);

    // Auto-save user preferences when changes are detected (debounced)
    const autoSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
    useEffect(() => {
        if (!prefsLoaded || !hasUnsavedChanges) return;

        if (autoSaveTimer.current) {
            clearTimeout(autoSaveTimer.current);
        }

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
            await deleteUserPreferences({ data: { gridId: TABLE_ID } });

            if (savedAdminPrefs) {
                setColumnVisibility(arrayToVisibility(savedAdminPrefs.visibleColumns));
                setColumnOrder(savedAdminPrefs.columnOrder);
                setColumnSizing(savedAdminPrefs.columnWidths);
            } else {
                setColumnVisibility(defaultVisibility);
                setColumnOrder([...ALL_COLUMN_IDS]);
                setColumnSizing(DEFAULT_COLUMN_WIDTHS as ColumnSizingState);
            }

            setSavedUserPrefs(null);
            return true;
        } catch (error) {
            console.error('Failed to reset preferences:', error);
            reportError(error, { hook: 'useOrdersTableState', action: 'resetPreferences' });
            return false;
        } finally {
            setIsSavingPrefs(false);
        }
    }, [savedAdminPrefs, defaultVisibility]);

    // Admin-only: save as defaults
    const savePreferencesToServer = useCallback(async (): Promise<boolean> => {
        if (!isManager) return false;
        setIsSavingPrefs(true);
        try {
            const result = await updateAdminGridPreferences({
                data: {
                    gridId: TABLE_ID,
                    visibleColumns: visibilityToArray(columnVisibility),
                    columnOrder,
                    columnWidths: columnSizing,
                },
            });

            if (result.success && result.data) {
                setSavedAdminPrefs({
                    visibleColumns: visibilityToArray(columnVisibility),
                    columnOrder,
                    columnWidths: columnSizing,
                    updatedAt: result.data.updatedAt || new Date().toISOString(),
                });
                return true;
            }
            return false;
        } catch (error) {
            console.error('Failed to save grid preferences:', error);
            reportError(error, { hook: 'useOrdersTableState', action: 'saveGridPreferences' });
            return false;
        } finally {
            setIsSavingPrefs(false);
        }
    }, [isManager, columnVisibility, columnOrder, columnSizing]);

    // Persist to localStorage (SSR-safe)
    useEffect(() => {
        if (typeof window !== 'undefined') {
            localStorage.setItem(VISIBILITY_KEY, JSON.stringify(columnVisibility));
        }
    }, [columnVisibility]);

    useEffect(() => {
        if (typeof window !== 'undefined') {
            localStorage.setItem(ORDER_KEY, JSON.stringify(columnOrder));
        }
    }, [columnOrder]);

    useEffect(() => {
        if (typeof window === 'undefined') return;
        if (sizingSaveTimer.current) {
            clearTimeout(sizingSaveTimer.current);
        }
        sizingSaveTimer.current = setTimeout(() => {
            localStorage.setItem(SIZING_KEY, JSON.stringify(columnSizing));
        }, 300);
        return () => {
            if (sizingSaveTimer.current) {
                clearTimeout(sizingSaveTimer.current);
            }
        };
    }, [columnSizing]);

    // Toggle column visibility
    const handleToggleColumn = useCallback((colId: string) => {
        setColumnVisibility(prev => ({
            ...prev,
            [colId]: !prev[colId],
        }));
    }, []);

    // Reset all to defaults
    const handleResetAll = useCallback(() => {
        if (savedAdminPrefs) {
            setColumnVisibility(arrayToVisibility(savedAdminPrefs.visibleColumns));
            setColumnOrder(savedAdminPrefs.columnOrder);
            setColumnSizing(savedAdminPrefs.columnWidths);
        } else {
            setColumnVisibility(defaultVisibility);
            setColumnOrder([...ALL_COLUMN_IDS]);
            setColumnSizing(DEFAULT_COLUMN_WIDTHS as ColumnSizingState);
        }
    }, [savedAdminPrefs, defaultVisibility]);

    return {
        columnVisibility,
        columnOrder,
        columnSizing,
        setColumnVisibility,
        setColumnOrder,
        setColumnSizing,
        handleToggleColumn,
        handleResetAll,
        hasUserCustomizations: savedUserPrefs !== null,
        differsFromAdminDefaults,
        isSavingPrefs,
        resetToDefaults,
        isManager,
        savePreferencesToServer,
    };
}
