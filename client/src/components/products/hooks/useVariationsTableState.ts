/**
 * useVariationsTableState - Column width persistence for VariationsDataTable
 *
 * Simplified version of useGridState for HTML tables.
 * Persists column widths to localStorage and syncs with admin preferences.
 */

import { useState, useCallback, useEffect, useRef } from 'react';
import {
    getAdminGridPreferences,
    getUserPreferences,
    updateUserPreferences,
    updateAdminGridPreferences,
} from '../../../server/functions/admin';
import { usePermissions } from '../../../hooks/usePermissions';

const GRID_ID = 'variationsTable';

// Default column widths (in pixels)
const DEFAULT_COLUMN_WIDTHS: Record<string, number> = {
    expander: 28,
    image: 40,
    product: 280,
    fabric: 160,
    skus: 50,
    avgMrp: 65,
    consumption: 55,
    bomCost: 60,
    stock: 55,
    shopifyStatus: 60,
    shopifyStock: 60,
    fabricStock: 60,
    sales30Day: 50,
    status: 55,
    actions: 75,
};

interface UseVariationsTableStateReturn {
    columnWidths: Record<string, number>;
    handleColumnResize: (colId: string, width: number) => void;
    isManager: boolean;
    saveAsAdminDefault: () => Promise<boolean>;
    isSaving: boolean;
}

export function useVariationsTableState(): UseVariationsTableStateReturn {
    const widthsKey = `${GRID_ID}ColumnWidths`;
    const { isManager } = usePermissions();
    const [isSaving, setIsSaving] = useState(false);
    const [prefsLoaded, setPrefsLoaded] = useState(false);

    // Column widths state
    const [columnWidths, setColumnWidths] = useState<Record<string, number>>(() => {
        const saved = localStorage.getItem(widthsKey);
        if (saved) {
            try {
                return { ...DEFAULT_COLUMN_WIDTHS, ...JSON.parse(saved) };
            } catch {
                return DEFAULT_COLUMN_WIDTHS;
            }
        }
        return DEFAULT_COLUMN_WIDTHS;
    });

    // Debounce timer for saving
    const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

    // Load preferences from server on mount
    useEffect(() => {
        if (prefsLoaded) return;

        const fetchPreferences = async () => {
            try {
                const [adminResult, userResult] = await Promise.all([
                    getAdminGridPreferences({ data: { gridId: GRID_ID } }).catch(() => ({ success: true, data: null })),
                    getUserPreferences({ data: { gridId: GRID_ID } }).catch(() => ({ success: true, data: null })),
                ]);

                // User preferences take priority over admin defaults
                const userPrefs = userResult.success ? userResult.data : null;
                const adminPrefs = adminResult.success ? adminResult.data : null;

                if (userPrefs?.columnWidths && Object.keys(userPrefs.columnWidths).length > 0) {
                    setColumnWidths({ ...DEFAULT_COLUMN_WIDTHS, ...userPrefs.columnWidths });
                    localStorage.setItem(widthsKey, JSON.stringify(userPrefs.columnWidths));
                } else if (adminPrefs?.columnWidths && Object.keys(adminPrefs.columnWidths).length > 0) {
                    setColumnWidths({ ...DEFAULT_COLUMN_WIDTHS, ...adminPrefs.columnWidths });
                    localStorage.setItem(widthsKey, JSON.stringify(adminPrefs.columnWidths));
                }
            } catch (error) {
                console.error('Failed to fetch variations table preferences:', error);
            } finally {
                setPrefsLoaded(true);
            }
        };

        fetchPreferences();
    }, [prefsLoaded, widthsKey]);

    // Handle column resize - simple state update, debounced persistence
    const handleColumnResize = useCallback((colId: string, width: number) => {
        if (!colId || width <= 0) return;

        // Update state immediately for responsive UI
        setColumnWidths(prev => ({ ...prev, [colId]: width }));
    }, []);

    // Debounced save to localStorage and server when columnWidths changes
    useEffect(() => {
        if (!prefsLoaded) return; // Don't save during initial load

        // Clear existing timer
        if (saveTimer.current) {
            clearTimeout(saveTimer.current);
        }

        // Debounce save by 500ms
        saveTimer.current = setTimeout(() => {
            // Save to localStorage
            localStorage.setItem(widthsKey, JSON.stringify(columnWidths));

            // Save to server (fire and forget)
            updateUserPreferences({
                data: {
                    gridId: GRID_ID,
                    visibleColumns: [],
                    columnOrder: [],
                    columnWidths,
                },
            }).catch(error => {
                console.error('Failed to save column widths:', error);
            });
        }, 500);

        return () => {
            if (saveTimer.current) {
                clearTimeout(saveTimer.current);
            }
        };
    }, [columnWidths, prefsLoaded, widthsKey]);

    // Admin: save current widths as default for all users
    const saveAsAdminDefault = useCallback(async (): Promise<boolean> => {
        if (!isManager) return false;
        setIsSaving(true);
        try {
            const result = await updateAdminGridPreferences({
                data: {
                    gridId: GRID_ID,
                    visibleColumns: [],
                    columnOrder: [],
                    columnWidths,
                },
            });
            return result.success;
        } catch (error) {
            console.error('Failed to save admin defaults:', error);
            return false;
        } finally {
            setIsSaving(false);
        }
    }, [isManager, columnWidths]);

    return {
        columnWidths,
        handleColumnResize,
        isManager,
        saveAsAdminDefault,
        isSaving,
    };
}
