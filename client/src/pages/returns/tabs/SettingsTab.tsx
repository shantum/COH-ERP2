import { useState, useEffect, useRef } from 'react';
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

    // Editable state — policy
    const [windowDays, setWindowDays] = useState(config?.windowDays ?? 14);
    const [windowWarningDays, setWindowWarningDays] = useState(config?.windowWarningDays ?? 12);
    const [autoRejectAfterDays, setAutoRejectAfterDays] = useState<number | null>(config?.autoRejectAfterDays ?? null);
    const [allowExpiredOverride, setAllowExpiredOverride] = useState(config?.allowExpiredOverride ?? true);

    // Editable state — fees
    const [returnShippingFee, setReturnShippingFee] = useState<number | null>(config?.returnShippingFee ?? null);
    const [restockingFeeType, setRestockingFeeType] = useState<'flat' | 'percent' | null>(config?.restockingFeeType ?? null);
    const [restockingFeeValue, setRestockingFeeValue] = useState<number | null>(config?.restockingFeeValue ?? null);

    const [hasChanges, setHasChanges] = useState(false);

    // Sync local state when config actually changes from server
    const prevConfigRef = useRef<string>('');
    useEffect(() => {
        if (!config) return;
        const configKey = JSON.stringify({
            w: config.windowDays,
            ww: config.windowWarningDays,
            ar: config.autoRejectAfterDays,
            ae: config.allowExpiredOverride,
            rsf: config.returnShippingFee,
            rft: config.restockingFeeType,
            rfv: config.restockingFeeValue,
        });
        if (configKey !== prevConfigRef.current) {
            prevConfigRef.current = configKey;
            if (!hasChanges) {
                setWindowDays(config.windowDays);
                setWindowWarningDays(config.windowWarningDays);
                setAutoRejectAfterDays(config.autoRejectAfterDays);
                setAllowExpiredOverride(config.allowExpiredOverride ?? true);
                setReturnShippingFee(config.returnShippingFee);
                setRestockingFeeType(config.restockingFeeType);
                setRestockingFeeValue(config.restockingFeeValue);
            }
        }
    }, [config, hasChanges]);

    const saveMutation = useMutation({
        mutationFn: () => updateSettingsFn({
            data: {
                windowDays,
                windowWarningDays,
                autoRejectAfterDays,
                allowExpiredOverride,
                returnShippingFee,
                restockingFeeType,
                restockingFeeValue,
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
            setReturnShippingFee(config.returnShippingFee);
            setRestockingFeeType(config.restockingFeeType);
            setRestockingFeeValue(config.restockingFeeValue);
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
            {/* Save Bar */}
            {hasChanges && (
                <div className="sticky top-0 z-10 bg-blue-50 border border-blue-200 rounded-lg p-3 flex items-center justify-between">
                    <span className="text-sm text-blue-700">You have unsaved changes</span>
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
                            className="px-4 py-1.5 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                            {saveMutation.isPending ? 'Saving...' : 'Save Changes'}
                        </button>
                    </div>
                </div>
            )}

            {/* Return Policy */}
            <div className="bg-white border border-gray-200 rounded-lg p-6">
                <h3 className="text-lg font-semibold mb-4">Return Policy</h3>

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
            </div>

            {/* Fees & Deductions */}
            <div className="bg-white border border-gray-200 rounded-lg p-6">
                <h3 className="text-lg font-semibold mb-1">Fees & Deductions</h3>
                <p className="text-sm text-gray-500 mb-4">
                    Auto-applied when processing refunds. Staff can override per return.
                </p>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    {/* Return Shipping Fee */}
                    <div className="border border-gray-100 rounded-lg p-4 bg-gray-50">
                        <label className="block text-sm font-medium text-gray-700 mb-1">
                            Return Shipping Fee
                        </label>
                        <p className="text-xs text-gray-500 mb-3">
                            Flat fee deducted from refund to cover reverse logistics
                        </p>
                        <div className="flex items-center gap-2">
                            <span className="text-sm text-gray-500">₹</span>
                            <input
                                type="number"
                                value={returnShippingFee ?? ''}
                                onChange={(e) => handleChange(
                                    setReturnShippingFee,
                                    e.target.value ? Number(e.target.value) : null
                                )}
                                placeholder="0"
                                min={0}
                                step={10}
                                className="w-28 px-3 py-2 border border-gray-300 rounded-lg text-sm"
                            />
                        </div>
                        {returnShippingFee ? (
                            <p className="text-xs text-green-600 mt-2">
                                ₹{returnShippingFee} will be deducted from every refund
                            </p>
                        ) : (
                            <p className="text-xs text-gray-400 mt-2">No shipping fee charged</p>
                        )}
                    </div>

                    {/* Restocking Fee */}
                    <div className="border border-gray-100 rounded-lg p-4 bg-gray-50">
                        <label className="block text-sm font-medium text-gray-700 mb-1">
                            Restocking Fee
                        </label>
                        <p className="text-xs text-gray-500 mb-3">
                            Fee for processing and repackaging returned items
                        </p>

                        {/* Type selector */}
                        <div className="flex items-center gap-2 mb-3">
                            <button
                                onClick={() => {
                                    handleChange(setRestockingFeeType, restockingFeeType === 'flat' ? null : 'flat');
                                    if (restockingFeeType === 'flat') handleChange(setRestockingFeeValue, null);
                                }}
                                className={`px-3 py-1.5 text-xs rounded-lg border ${
                                    restockingFeeType === 'flat'
                                        ? 'border-blue-600 bg-blue-50 text-blue-700'
                                        : 'border-gray-300 hover:border-gray-400'
                                }`}
                            >
                                Flat (₹)
                            </button>
                            <button
                                onClick={() => {
                                    handleChange(setRestockingFeeType, restockingFeeType === 'percent' ? null : 'percent');
                                    if (restockingFeeType === 'percent') handleChange(setRestockingFeeValue, null);
                                }}
                                className={`px-3 py-1.5 text-xs rounded-lg border ${
                                    restockingFeeType === 'percent'
                                        ? 'border-blue-600 bg-blue-50 text-blue-700'
                                        : 'border-gray-300 hover:border-gray-400'
                                }`}
                            >
                                Percentage (%)
                            </button>
                        </div>

                        {restockingFeeType && (
                            <div className="flex items-center gap-2">
                                {restockingFeeType === 'flat' && <span className="text-sm text-gray-500">₹</span>}
                                <input
                                    type="number"
                                    value={restockingFeeValue ?? ''}
                                    onChange={(e) => handleChange(
                                        setRestockingFeeValue,
                                        e.target.value ? Number(e.target.value) : null
                                    )}
                                    placeholder="0"
                                    min={0}
                                    max={restockingFeeType === 'percent' ? 100 : undefined}
                                    step={restockingFeeType === 'percent' ? 5 : 10}
                                    className="w-28 px-3 py-2 border border-gray-300 rounded-lg text-sm"
                                />
                                {restockingFeeType === 'percent' && <span className="text-sm text-gray-500">%</span>}
                            </div>
                        )}

                        {restockingFeeType && restockingFeeValue ? (
                            <p className="text-xs text-green-600 mt-2">
                                {restockingFeeType === 'flat'
                                    ? `₹${restockingFeeValue} per return`
                                    : `${restockingFeeValue}% of gross refund amount`
                                }
                            </p>
                        ) : (
                            <p className="text-xs text-gray-400 mt-2">No restocking fee charged</p>
                        )}
                    </div>
                </div>

                {/* Example calculation */}
                {(returnShippingFee || (restockingFeeType && restockingFeeValue)) && (
                    <div className="mt-4 p-3 bg-purple-50 border border-purple-100 rounded-lg">
                        <p className="text-xs font-medium text-purple-700 mb-1">Example: ₹2,000 item refund</p>
                        <div className="text-xs text-purple-600 space-y-0.5">
                            <div className="flex justify-between">
                                <span>Gross amount</span>
                                <span>₹2,000</span>
                            </div>
                            {returnShippingFee ? (
                                <div className="flex justify-between text-red-600">
                                    <span>Return shipping</span>
                                    <span>- ₹{returnShippingFee}</span>
                                </div>
                            ) : null}
                            {restockingFeeType && restockingFeeValue ? (
                                <div className="flex justify-between text-red-600">
                                    <span>Restocking fee{restockingFeeType === 'percent' ? ` (${restockingFeeValue}%)` : ''}</span>
                                    <span>- ₹{restockingFeeType === 'flat' ? restockingFeeValue : Math.round(2000 * restockingFeeValue / 100)}</span>
                                </div>
                            ) : null}
                            <div className="flex justify-between font-medium border-t border-purple-200 pt-1 mt-1">
                                <span>Net refund</span>
                                <span>₹{2000 - (returnShippingFee ?? 0) - (restockingFeeType === 'flat' ? (restockingFeeValue ?? 0) : Math.round(2000 * (restockingFeeValue ?? 0) / 100))}</span>
                            </div>
                        </div>
                    </div>
                )}
            </div>

            {saveMutation.isError && (
                <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
                    {(saveMutation.error as Error)?.message || 'Failed to save settings'}
                </div>
            )}

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
