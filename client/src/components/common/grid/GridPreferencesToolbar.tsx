/**
 * Toolbar component for managing grid column preferences
 *
 * Features:
 * - Auto-save: User preferences save automatically (debounced in useGridState)
 * - Reset: Users can reset to admin defaults when they have customizations
 * - Set as default: Admins can save current layout as default for all users
 */

import { Save, RotateCcw } from 'lucide-react';

interface GridPreferencesToolbarProps {
    // User preferences state
    hasUserCustomizations: boolean;        // User has saved custom preferences
    differsFromAdminDefaults: boolean;     // Current state differs from admin defaults
    isSavingPrefs: boolean;                // Currently saving preferences
    onResetToDefaults: () => Promise<boolean>;
    // Admin-only: save as defaults for all users
    isManager: boolean;
    onSaveAsDefaults: () => Promise<boolean>;
}

export function GridPreferencesToolbar({
    hasUserCustomizations,
    differsFromAdminDefaults,
    isSavingPrefs,
    onResetToDefaults,
    isManager,
    onSaveAsDefaults,
}: GridPreferencesToolbarProps) {
    const handleResetToDefaults = async () => {
        if (!confirm('Reset to default column layout?')) {
            return;
        }
        const success = await onResetToDefaults();
        if (!success) {
            alert('Failed to reset preferences');
        }
    };

    const handleSaveAsDefaults = async () => {
        const success = await onSaveAsDefaults();
        if (success) {
            alert('Column defaults saved for all users');
        } else {
            alert('Failed to save defaults');
        }
    };

    // Don't render if no buttons to show
    if (!hasUserCustomizations && !(isManager && differsFromAdminDefaults)) {
        return null;
    }

    return (
        <div className="flex items-center gap-2">
            {/* Admin: Save as defaults for all users - shown when current differs from defaults */}
            {isManager && differsFromAdminDefaults && (
                <button
                    onClick={handleSaveAsDefaults}
                    disabled={isSavingPrefs}
                    className="flex items-center gap-1 text-xs px-2 py-1 rounded bg-blue-50 text-blue-600 hover:bg-blue-100 disabled:opacity-50 border border-blue-200"
                    title="Set current columns as default for all users"
                >
                    <Save size={12} />
                    Set as default
                </button>
            )}

            {/* Reset to defaults button - shown when user has customizations */}
            {hasUserCustomizations && (
                <button
                    onClick={handleResetToDefaults}
                    disabled={isSavingPrefs}
                    className="flex items-center gap-1 text-xs px-2 py-1 rounded text-gray-500 hover:bg-gray-100 hover:text-gray-700 disabled:opacity-50"
                    title="Reset to default column layout"
                >
                    <RotateCcw size={12} />
                    Reset
                </button>
            )}
        </div>
    );
}
