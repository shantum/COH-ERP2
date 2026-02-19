import { X } from 'lucide-react';
import type { QueueItem as RepackingQueueItem } from '../../../server/functions/repacking';
import { WRITE_OFF_REASONS } from '../types';

export interface QcModalProps {
    item: RepackingQueueItem;
    action: 'ready' | 'write_off';
    setAction: (action: 'ready' | 'write_off') => void;
    comments: string;
    setComments: (val: string) => void;
    writeOffReason: string;
    setWriteOffReason: (val: string) => void;
    onProcess: () => void;
    onClose: () => void;
}

export function QcModal({
    item,
    action,
    setAction,
    comments,
    setComments,
    writeOffReason,
    setWriteOffReason,
    onProcess,
    onClose,
}: QcModalProps) {
    return (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
            <div className="bg-white rounded-lg max-w-lg w-full">
                <div className="p-6 border-b border-gray-200 flex items-center justify-between">
                    <h2 className="text-xl font-bold">Quality Check</h2>
                    <button onClick={onClose} className="text-gray-500 hover:text-gray-700">
                        <X size={24} />
                    </button>
                </div>

                <div className="p-6 space-y-4">
                    <div>
                        <div className="font-medium">{item.productName}</div>
                        <div className="text-sm text-gray-500">
                            {item.colorName} - {item.size} ({item.skuCode})
                        </div>
                        <div className="text-sm text-gray-500">Qty: {item.qty}</div>
                    </div>

                    <div>
                        <label className="block text-sm font-medium mb-2">Decision</label>
                        <div className="flex gap-2">
                            <button
                                onClick={() => setAction('ready')}
                                className={`flex-1 px-4 py-2 rounded-lg border ${
                                    action === 'ready'
                                        ? 'border-green-600 bg-green-50 text-green-700'
                                        : 'border-gray-300'
                                }`}
                            >
                                Ready to Sell
                            </button>
                            <button
                                onClick={() => setAction('write_off')}
                                className={`flex-1 px-4 py-2 rounded-lg border ${
                                    action === 'write_off'
                                        ? 'border-red-600 bg-red-50 text-red-700'
                                        : 'border-gray-300'
                                }`}
                            >
                                Write Off
                            </button>
                        </div>
                    </div>

                    {action === 'write_off' && (
                        <div>
                            <label className="block text-sm font-medium mb-2">Write-off Reason</label>
                            <select
                                value={writeOffReason}
                                onChange={(e) => setWriteOffReason(e.target.value)}
                                className="w-full px-4 py-2 border border-gray-300 rounded-lg"
                            >
                                <option value="">Select reason...</option>
                                {WRITE_OFF_REASONS.map((r) => (
                                    <option key={r.value} value={r.value}>
                                        {r.label}
                                    </option>
                                ))}
                            </select>
                        </div>
                    )}

                    <div>
                        <label className="block text-sm font-medium mb-2">QC Comments (Optional)</label>
                        <textarea
                            value={comments}
                            onChange={(e) => setComments(e.target.value)}
                            className="w-full px-4 py-2 border border-gray-300 rounded-lg"
                            rows={3}
                        />
                    </div>
                </div>

                <div className="p-6 border-t border-gray-200 flex justify-end gap-2">
                    <button onClick={onClose} className="px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50">
                        Cancel
                    </button>
                    <button
                        onClick={onProcess}
                        className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
                    >
                        Process
                    </button>
                </div>
            </div>
        </div>
    );
}
