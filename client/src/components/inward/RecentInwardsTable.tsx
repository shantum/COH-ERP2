/**
 * Reusable Recent Inwards Table Component
 * Shows recent inward transactions with undo and notes editing
 */

import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useServerFn } from '@tanstack/react-start';
import { getRecentInwards } from '../../server/functions/inventory';
import { editInward, undoTransaction } from '../../server/functions/inventoryMutations';
import { ClipboardList, Undo2 } from 'lucide-react';
import ConfirmModal from '@/components/common/ConfirmModal';
import type { RecentInwardItem } from '../../server/functions/inventory';

interface RecentInwardsTableProps {
    source: string;
    title?: string;
    onSuccess?: (message: string) => void;
    onError?: (message: string) => void;
}

// Notes Cell Component
function NotesCell({ transactionId, initialNotes, source }: { transactionId: string; initialNotes: string; source: string }) {
    const queryClient = useQueryClient();
    const editInwardFn = useServerFn(editInward);
    const [isEditing, setIsEditing] = useState(false);
    const [notes, setNotes] = useState(initialNotes);
    const [saving, setSaving] = useState(false);

    useEffect(() => {
        setNotes(initialNotes);
    }, [initialNotes]);

    const handleSave = async () => {
        if (notes === initialNotes) {
            setIsEditing(false);
            return;
        }
        setSaving(true);
        try {
            await editInwardFn({ data: { transactionId, notes: notes || undefined } });
            queryClient.invalidateQueries({ queryKey: ['recent-inwards', source] });
            setIsEditing(false);
        } catch {
            setNotes(initialNotes);
        } finally {
            setSaving(false);
        }
    };

    if (isEditing) {
        return (
            <input
                type="text"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                onBlur={handleSave}
                onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                        e.preventDefault();
                        handleSave();
                    } else if (e.key === 'Escape') {
                        setNotes(initialNotes);
                        setIsEditing(false);
                    }
                }}
                disabled={saving}
                className="w-full px-1 py-0.5 text-xs border rounded focus:outline-none focus:ring-1 focus:ring-blue-500"
                placeholder="Add note..."
                autoFocus
            />
        );
    }

    return (
        <button
            onClick={() => setIsEditing(true)}
            className={`text-xs truncate max-w-[100px] text-left rounded px-1 py-0.5 transition-colors ${
                notes
                    ? 'text-gray-600 hover:bg-gray-100'
                    : 'text-gray-400 hover:text-blue-600 hover:bg-blue-50 italic'
            }`}
            title={notes || 'Click to add note'}
        >
            {notes || '+ note'}
        </button>
    );
}

// Source label mapping
const getSourceLabel = (reason: string): string => {
    const labels: Record<string, string> = {
        production: 'Production',
        return_receipt: 'Return',
        rto_received: 'RTO',
        repack_complete: 'Repacking',
        adjustment: 'Adjustment',
        found_stock: 'Found Stock',
        correction: 'Correction',
        received: 'Received',
    };
    return labels[reason] || reason;
};

// Source color mapping
const getSourceColor = (reason: string): string => {
    const colors: Record<string, string> = {
        production: 'bg-blue-100 text-blue-700',
        return_receipt: 'bg-orange-100 text-orange-700',
        rto_received: 'bg-purple-100 text-purple-700',
        repack_complete: 'bg-green-100 text-green-700',
        adjustment: 'bg-gray-100 text-gray-700',
        found_stock: 'bg-yellow-100 text-yellow-700',
        correction: 'bg-gray-100 text-gray-700',
        received: 'bg-yellow-100 text-yellow-700',
    };
    return colors[reason] || 'bg-gray-100 text-gray-700';
};

export default function RecentInwardsTable({ source, title, onSuccess, onError }: RecentInwardsTableProps) {
    const queryClient = useQueryClient();
    const getRecentInwardsFn = useServerFn(getRecentInwards);
    const undoTransactionFn = useServerFn(undoTransaction);

    // Fetch recent inwards filtered by source
    const { data: recentInwards = [], isLoading } = useQuery<RecentInwardItem[]>({
        queryKey: ['recent-inwards', source],
        queryFn: async () => {
            // Map source to the expected enum value
            const sourceParam = source === 'all' ? undefined : source as 'production' | 'returns' | 'rto' | 'repacking' | 'adjustments' | 'received' | 'adjustment';
            return getRecentInwardsFn({ data: { limit: 50, source: sourceParam } });
        },
        refetchInterval: 15000,
    });

    // Undo mutation
    const undoMutation = useMutation({
        mutationFn: async (id: string) => {
            return undoTransactionFn({ data: { transactionId: id } });
        },
        onMutate: async (id: string) => {
            await queryClient.cancelQueries({ queryKey: ['recent-inwards', source] });
            const previousRecent = queryClient.getQueryData<RecentInwardItem[]>(['recent-inwards', source]);

            queryClient.setQueryData<RecentInwardItem[]>(['recent-inwards', source], (old) =>
                old ? old.filter(item => item.id !== id) : []
            );

            return { previousRecent };
        },
        onError: (error: unknown, _, context) => {
            if (context?.previousRecent) {
                queryClient.setQueryData(['recent-inwards', source], context.previousRecent);
            }
            const errorMsg = error instanceof Error ? error.message : 'Failed to undo transaction';
            onError?.(errorMsg);
        },
        onSuccess: () => {
            onSuccess?.('Transaction undone');
        },
        onSettled: () => {
            queryClient.invalidateQueries({ queryKey: ['recent-inwards', source] });
            queryClient.invalidateQueries({ queryKey: ['pending-sources'] });
            queryClient.invalidateQueries({ queryKey: ['pendingQueue'] });
        },
    });

    const [undoConfirmId, setUndoConfirmId] = useState<string | null>(null);

    const handleUndo = (id: string) => {
        setUndoConfirmId(id);
    };

    const displayTitle = title || `Recent ${getSourceLabel(source)} Inwards`;

    return (
        <div className="card">
            <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2">
                    <ClipboardList size={20} className="text-gray-500" />
                    <h3 className="text-lg font-semibold">{displayTitle}</h3>
                </div>
                <span className="text-sm text-gray-500">
                    {recentInwards.length} transactions
                </span>
            </div>

            {isLoading ? (
                <div className="flex justify-center py-8">
                    <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-blue-600"></div>
                </div>
            ) : recentInwards.length === 0 ? (
                <p className="text-gray-500 text-center py-8">No recent transactions</p>
            ) : (
                <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                        <thead className="bg-gray-50">
                            <tr>
                                <th className="px-3 py-2 text-left font-medium text-gray-600 w-16">ID</th>
                                <th className="px-3 py-2 text-left font-medium text-gray-600 w-20">Time</th>
                                <th className="px-3 py-2 text-left font-medium text-gray-600 w-24">SKU</th>
                                <th className="px-3 py-2 text-left font-medium text-gray-600">Product</th>
                                <th className="px-3 py-2 text-center font-medium text-gray-600 w-12">Qty</th>
                                <th className="px-3 py-2 text-left font-medium text-gray-600 w-24">Source</th>
                                <th className="px-3 py-2 text-left font-medium text-gray-600 w-32">Notes</th>
                                <th className="px-3 py-2 text-center font-medium text-gray-600 w-16">Undo</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y">
                            {recentInwards.map((txn) => {
                                const isToday = new Date(txn.createdAt).toDateString() === new Date().toDateString();
                                return (
                                    <tr
                                        key={txn.id}
                                        className={`hover:bg-gray-50 transition-colors ${
                                            undoMutation.isPending && undoMutation.variables === txn.id
                                                ? 'opacity-50'
                                                : ''
                                        }`}
                                    >
                                        <td className="px-3 py-2">
                                            <span
                                                className="font-mono text-xs text-gray-400 cursor-pointer hover:text-gray-600"
                                                title={txn.id}
                                                onClick={() => navigator.clipboard.writeText(txn.id)}
                                            >
                                                {txn.id.slice(0, 6)}
                                            </span>
                                        </td>
                                        <td className="px-3 py-2 text-gray-600 whitespace-nowrap">
                                            {isToday
                                                ? new Date(txn.createdAt).toLocaleTimeString('en-IN', {
                                                    hour: '2-digit',
                                                    minute: '2-digit',
                                                })
                                                : new Date(txn.createdAt).toLocaleDateString('en-IN', {
                                                    day: '2-digit',
                                                    month: 'short',
                                                    hour: '2-digit',
                                                    minute: '2-digit',
                                                })
                                            }
                                        </td>
                                        <td className="px-3 py-2 font-mono text-xs">{txn.skuCode}</td>
                                        <td className="px-3 py-2">
                                            {txn.productName} - {txn.colorName} / {txn.size}
                                        </td>
                                        <td className="px-3 py-2 text-center">
                                            <span className="text-green-600 font-semibold">+{txn.qty}</span>
                                        </td>
                                        <td className="px-3 py-2">
                                            <span className={`px-2 py-0.5 rounded text-xs font-medium ${getSourceColor(txn.reason)}`}>
                                                {getSourceLabel(txn.reason)}
                                            </span>
                                        </td>
                                        <td className="px-3 py-2">
                                            <NotesCell
                                                transactionId={txn.id}
                                                initialNotes={txn.notes || ''}
                                                source={source}
                                            />
                                        </td>
                                        <td className="px-3 py-2 text-center">
                                            <button
                                                onClick={() => handleUndo(txn.id)}
                                                disabled={undoMutation.isPending}
                                                className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded transition-colors"
                                                title="Undo"
                                            >
                                                <Undo2 size={16} />
                                            </button>
                                        </td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                </div>
            )}

            <ConfirmModal
                isOpen={!!undoConfirmId}
                onClose={() => setUndoConfirmId(null)}
                onConfirm={() => {
                    if (undoConfirmId) undoMutation.mutate(undoConfirmId);
                }}
                title="Undo Inward"
                message="Are you sure you want to undo this inward? The stock change will be reversed."
                confirmText="Undo"
                confirmVariant="danger"
            />
        </div>
    );
}
