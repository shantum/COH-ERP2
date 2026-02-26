import { useState, useEffect } from 'react';
import { useQueryClient, useMutation } from '@tanstack/react-query';
import { useServerFn } from '@tanstack/react-start';
import {
    updateReturnSettings,
    type ReturnConfigResponse,
} from '../../../server/functions/returns';

export interface SettingsTabProps {
    config: ReturnConfigResponse | undefined;
    loading: boolean;
    onRefresh: () => void;
}

export function SettingsTab({ config, loading, onRefresh }: SettingsTabProps) {
    const queryClient = useQueryClient();
    const updateSettingsFn = useServerFn(updateReturnSettings);

    // Editable state
    const [windowDays, setWindowDays] = useState(config?.windowDays ?? 14);
    const [windowWarningDays, setWindowWarningDays] = useState(config?.windowWarningDays ?? 12);
    const [autoRejectAfterDays, setAutoRejectAfterDays] = useState<number | null>(config?.autoRejectAfterDays ?? null);
    const [allowExpiredOverride, setAllowExpiredOverride] = useState(config?.allowExpiredOverride ?? true);
    const [hasChanges, setHasChanges] = useState(false);

    // Sync local state when config loads/changes (only if user hasn't edited)
    useEffect(() => {
        if (config && !hasChanges) {
            setWindowDays(config.windowDays);
            setWindowWarningDays(config.windowWarningDays);
            setAutoRejectAfterDays(config.autoRejectAfterDays);
            setAllowExpiredOverride(config.allowExpiredOverride ?? true);
        }
    }, [config, hasChanges]);

    const saveMutation = useMutation({
        mutationFn: () => updateSettingsFn({
            data: {
                windowDays,
                windowWarningDays,
                autoRejectAfterDays,
                allowExpiredOverride,
            },
        }),
        onSuccess: () => {
            setHasChanges(false);
            queryClient.invalidateQueries({ queryKey: ['returns', 'config'] });
            onRefresh();
        },
    });

    const handleChange = <T,>(setter: (val: T) => void, value: T) => {
        setter(value);
        setHasChanges(true);
    };

    const handleReset = () => {
        if (config) {
            setWindowDays(config.windowDays);
            setWindowWarningDays(config.windowWarningDays);
            setAutoRejectAfterDays(config.autoRejectAfterDays);
            setAllowExpiredOverride(config.allowExpiredOverride ?? true);
            setHasChanges(false);
        }
    };

    if (loading) {
        return <div className="text-center py-12">Loading settings...</div>;
    }

    if (!config) {
        return <div className="text-center py-12 text-gray-500">Failed to load settings</div>;
    }

    const daysRemaining = windowDays - windowWarningDays;

    return (
        <div className="space-y-6">
            {/* Return Window Settings - Editable */}
            <div className="bg-white border border-gray-200 rounded-lg p-6">
                <div className="flex items-center justify-between mb-4">
                    <h3 className="text-lg font-semibold">Return Policy</h3>
                    {hasChanges && (
                        <div className="flex items-center gap-2">
                            <button
                                onClick={handleReset}
                                className="px-3 py-1.5 text-sm text-gray-600 hover:text-gray-800"
                            >
                                Reset
                            </button>
                            <button
                                onClick={() => saveMutation.mutate()}
                                disabled={saveMutation.isPending}
                                className="px-4 py-1.5 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
                            >
                                {saveMutation.isPending ? 'Saving...' : 'Save Changes'}
                            </button>
                        </div>
                    )}
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">
                            Return Window
                        </label>
                        <div className="flex items-center gap-2">
                            <input
                                type="number"
                                value={windowDays}
                                onChange={(e) => handleChange(setWindowDays, parseInt(e.target.value) || 14)}
                                min={1}
                                max={365}
                                className="w-20 px-3 py-2 border border-gray-300 rounded-lg text-sm"
                            />
                            <span className="text-sm text-gray-500">days</span>
                        </div>
                        <p className="text-xs text-gray-500 mt-1">
                            From delivery date
                        </p>
                    </div>

                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">
                            Warning After
                        </label>
                        <div className="flex items-center gap-2">
                            <input
                                type="number"
                                value={windowWarningDays}
                                onChange={(e) => handleChange(setWindowWarningDays, parseInt(e.target.value) || 0)}
                                min={0}
                                max={windowDays - 1}
                                className="w-20 px-3 py-2 border border-gray-300 rounded-lg text-sm"
                            />
                            <span className="text-sm text-gray-500">days</span>
                        </div>
                        <p className="text-xs text-gray-500 mt-1">
                            Shows warning at {daysRemaining} day{daysRemaining !== 1 ? 's' : ''} remaining
                        </p>
                    </div>

                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">
                            Auto-Reject After
                        </label>
                        <div className="flex items-center gap-2">
                            <input
                                type="number"
                                value={autoRejectAfterDays ?? ''}
                                onChange={(e) => handleChange(
                                    setAutoRejectAfterDays,
                                    e.target.value ? parseInt(e.target.value) : null
                                )}
                                min={windowDays}
                                placeholder="Never"
                                className="w-20 px-3 py-2 border border-gray-300 rounded-lg text-sm"
                            />
                            <span className="text-sm text-gray-500">days</span>
                        </div>
                        <p className="text-xs text-gray-500 mt-1">
                            Leave empty to allow overrides
                        </p>
                    </div>

                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">
                            Allow Expired Override
                        </label>
                        <label className="flex items-center gap-2 mt-2">
                            <input
                                type="checkbox"
                                checked={allowExpiredOverride}
                                onChange={(e) => handleChange(setAllowExpiredOverride, e.target.checked)}
                                className="rounded border-gray-300"
                            />
                            <span className="text-sm text-gray-600">
                                Allow returns after window
                            </span>
                        </label>
                    </div>
                </div>

                {saveMutation.isError && (
                    <div className="mt-4 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
                        {(saveMutation.error as Error)?.message || 'Failed to save settings'}
                    </div>
                )}
            </div>

            {/* Read-only Options Display */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {/* Reason Categories */}
                <div className="bg-white border border-gray-200 rounded-lg p-4">
                    <h4 className="text-sm font-medium text-gray-700 mb-3">Return Reasons</h4>
                    <div className="flex flex-wrap gap-1.5">
                        {config.reasonCategories.map((reason) => (
                            <span key={reason.value} className="px-2 py-0.5 bg-blue-50 text-blue-700 rounded text-xs">
                                {reason.label}
                            </span>
                        ))}
                    </div>
                </div>

                {/* Item Conditions */}
                <div className="bg-white border border-gray-200 rounded-lg p-4">
                    <h4 className="text-sm font-medium text-gray-700 mb-3">Item Conditions</h4>
                    <div className="flex flex-wrap gap-1.5">
                        {config.conditions.map((condition) => (
                            <span key={condition.value} className="px-2 py-0.5 bg-green-50 text-green-700 rounded text-xs">
                                {condition.label}
                            </span>
                        ))}
                    </div>
                </div>

                {/* Resolution Types */}
                <div className="bg-white border border-gray-200 rounded-lg p-4">
                    <h4 className="text-sm font-medium text-gray-700 mb-3">Resolutions</h4>
                    <div className="flex flex-wrap gap-1.5">
                        {config.resolutions.map((resolution) => (
                            <span key={resolution.value} className="px-2 py-0.5 bg-purple-50 text-purple-700 rounded text-xs">
                                {resolution.label}
                            </span>
                        ))}
                    </div>
                </div>

                {/* Refund Methods */}
                <div className="bg-white border border-gray-200 rounded-lg p-4">
                    <h4 className="text-sm font-medium text-gray-700 mb-3">Refund Methods</h4>
                    <div className="flex flex-wrap gap-1.5">
                        {config.refundMethods.map((method) => (
                            <span key={method.value} className="px-2 py-0.5 bg-indigo-50 text-indigo-700 rounded text-xs">
                                {method.label}
                            </span>
                        ))}
                    </div>
                </div>
            </div>

            {/* Non-Returnable Reasons */}
            <div className="bg-white border border-gray-200 rounded-lg p-4">
                <h4 className="text-sm font-medium text-gray-700 mb-3">Non-Returnable Product Reasons</h4>
                <div className="flex flex-wrap gap-1.5">
                    {config.nonReturnableReasons.map((reason) => (
                        <span key={reason.value} className="px-2 py-0.5 bg-red-50 text-red-700 rounded text-xs">
                            {reason.label}
                        </span>
                    ))}
                </div>
            </div>
        </div>
    );
}
