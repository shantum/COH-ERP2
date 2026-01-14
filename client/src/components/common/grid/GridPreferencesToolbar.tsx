/**
 * Toolbar component for managing grid column preferences
 * Shows save/reset buttons for all users and admin sync functionality
 */

import { Save, RotateCcw, Info, X } from 'lucide-react';

interface GridPreferencesToolbarProps {
    // User preferences
    hasUnsavedChanges: boolean;
    isSavingPrefs: boolean;
    onSaveUserPreferences: () => Promise<boolean>;
    onResetToDefaults: () => Promise<boolean>;
    // Admin defaults notification
    newDefaultsAvailable: boolean;
    onAdoptNewDefaults: () => Promise<boolean>;
    onDismissNewDefaults: () => Promise<boolean>;
    // Admin-only: save as defaults for all users
    isManager: boolean;
    onSaveAsDefaults: () => Promise<boolean>;
}

export function GridPreferencesToolbar({
    hasUnsavedChanges,
    isSavingPrefs,
    onSaveUserPreferences,
    onResetToDefaults,
    newDefaultsAvailable,
    onAdoptNewDefaults,
    onDismissNewDefaults,
    isManager,
    onSaveAsDefaults,
}: GridPreferencesToolbarProps) {
    const handleSaveUserPrefs = async () => {
        const success = await onSaveUserPreferences();
        if (!success) {
            alert('Failed to save preferences');
        }
    };

    const handleResetToDefaults = async () => {
        if (!confirm('Reset to default column layout? This will delete your saved preferences.')) {
            return;
        }
        const success = await onResetToDefaults();
        if (!success) {
            alert('Failed to reset preferences');
        }
    };

    const handleSaveAsDefaults = async () => {
        if (!confirm('Save current layout as the default for all users?')) {
            return;
        }
        const success = await onSaveAsDefaults();
        if (success) {
            alert('Column preferences saved for all users');
        } else {
            alert('Failed to save preferences');
        }
    };

    const handleAdoptNewDefaults = async () => {
        const success = await onAdoptNewDefaults();
        if (!success) {
            alert('Failed to adopt new defaults');
        }
    };

    const handleDismissNewDefaults = async () => {
        const success = await onDismissNewDefaults();
        if (!success) {
            alert('Failed to dismiss notification');
        }
    };

    return (
        <div className="flex items-center gap-2 flex-wrap">
            {/* New defaults available notification */}
            {newDefaultsAvailable && (
                <div className="flex items-center gap-2 px-2 py-1 bg-blue-50 border border-blue-200 rounded text-xs">
                    <Info size={12} className="text-blue-500" />
                    <span className="text-blue-700">New column defaults available</span>
                    <button
                        onClick={handleAdoptNewDefaults}
                        disabled={isSavingPrefs}
                        className="px-2 py-0.5 bg-blue-500 text-white rounded hover:bg-blue-600 disabled:opacity-50"
                    >
                        Use defaults
                    </button>
                    <button
                        onClick={handleDismissNewDefaults}
                        disabled={isSavingPrefs}
                        className="p-0.5 text-blue-400 hover:text-blue-600"
                        title="Keep my layout"
                    >
                        <X size={12} />
                    </button>
                </div>
            )}

            {/* Save user preferences button - shown when user has unsaved changes */}
            {hasUnsavedChanges && !newDefaultsAvailable && (
                <button
                    onClick={handleSaveUserPrefs}
                    disabled={isSavingPrefs}
                    className="flex items-center gap-1 text-xs px-2 py-1 rounded bg-green-50 text-green-600 hover:bg-green-100 disabled:opacity-50 border border-green-200"
                    title="Save your column layout"
                >
                    <Save size={12} />
                    {isSavingPrefs ? 'Saving...' : 'Save layout'}
                </button>
            )}

            {/* Reset to defaults button - shown when user has saved preferences */}
            {hasUnsavedChanges && (
                <button
                    onClick={handleResetToDefaults}
                    disabled={isSavingPrefs}
                    className="flex items-center gap-1 text-xs px-2 py-1 rounded text-gray-500 hover:bg-gray-100 disabled:opacity-50"
                    title="Reset to default column layout"
                >
                    <RotateCcw size={12} />
                    Reset
                </button>
            )}

            {/* Admin: Save as defaults for all users */}
            {isManager && hasUnsavedChanges && (
                <button
                    onClick={handleSaveAsDefaults}
                    disabled={isSavingPrefs}
                    className="flex items-center gap-1 text-xs px-2 py-1 rounded bg-purple-50 text-purple-600 hover:bg-purple-100 disabled:opacity-50 border border-purple-200"
                    title="Save as default for all users (admin)"
                >
                    <Save size={12} />
                    Set as default
                </button>
            )}
        </div>
    );
}
