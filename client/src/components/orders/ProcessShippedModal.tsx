/**
 * ProcessShippedModal component
 * Modal for batch processing all marked_shipped lines
 * Shows validation summary and requires confirmation before processing
 */

import { useState, useMemo } from 'react';
import { X, Truck, CheckCircle, AlertCircle, AlertTriangle, Package } from 'lucide-react';

interface ProcessShippedModalProps {
    orders: any[];
    onProcess: (data?: { comment?: string }) => void;
    onClose: () => void;
    isProcessing: boolean;
}

interface LineInfo {
    lineId: string;
    orderId: string;
    orderNumber: string;
    sku: string;
    qty: number;
    lineAwb: string;
    lineCourier: string;
    expectedAwb: string;
    matchStatus: 'match' | 'mismatch' | 'missing' | 'no_expected';
}

export function ProcessShippedModal({
    orders,
    onProcess,
    onClose,
    isProcessing,
}: ProcessShippedModalProps) {
    const [comment, setComment] = useState('');

    // Analyze all marked_shipped lines
    const { lines, summary } = useMemo(() => {
        const lineInfos: LineInfo[] = [];

        for (const order of orders) {
            const orderLines = order.orderLines || [];
            const expectedAwb = order.shopifyCache?.trackingNumber || '';

            for (const line of orderLines) {
                if (line.lineStatus !== 'marked_shipped') continue;

                const lineAwb = line.awbNumber || '';
                let matchStatus: LineInfo['matchStatus'];

                if (!expectedAwb) {
                    matchStatus = 'no_expected';
                } else if (!lineAwb) {
                    matchStatus = 'missing';
                } else if (lineAwb.toLowerCase() === expectedAwb.toLowerCase()) {
                    matchStatus = 'match';
                } else {
                    matchStatus = 'mismatch';
                }

                lineInfos.push({
                    lineId: line.id,
                    orderId: order.id,
                    orderNumber: order.orderNumber,
                    sku: line.sku?.skuCode || line.skuId,
                    qty: line.qty,
                    lineAwb,
                    lineCourier: line.courier || '',
                    expectedAwb,
                    matchStatus,
                });
            }
        }

        const summary = {
            total: lineInfos.length,
            match: lineInfos.filter(l => l.matchStatus === 'match').length,
            mismatch: lineInfos.filter(l => l.matchStatus === 'mismatch').length,
            missing: lineInfos.filter(l => l.matchStatus === 'missing').length,
            noExpected: lineInfos.filter(l => l.matchStatus === 'no_expected').length,
            uniqueOrders: new Set(lineInfos.map(l => l.orderId)).size,
        };

        return { lines: lineInfos, summary };
    }, [orders]);

    const mismatchLines = lines.filter(l => l.matchStatus === 'mismatch');
    const missingLines = lines.filter(l => l.matchStatus === 'missing');

    // Require comment if there are issues
    const hasIssues = summary.mismatch > 0 || summary.missing > 0;
    const canProcess = summary.total > 0 && (!hasIssues || comment.trim().length > 0);

    const handleProcess = () => {
        if (!canProcess) return;
        onProcess(comment.trim() ? { comment: comment.trim() } : undefined);
    };

    return (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
            <div className="bg-white rounded-xl w-full max-w-lg shadow-2xl overflow-hidden max-h-[90vh] flex flex-col">
                {/* Header */}
                <div className="px-6 py-4 bg-gradient-to-r from-emerald-600 to-emerald-700 text-white flex-shrink-0">
                    <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                            <div className="p-2 bg-white/20 rounded-lg">
                                <Truck size={24} />
                            </div>
                            <div>
                                <h2 className="text-lg font-semibold">Process Shipped Orders</h2>
                                <p className="text-emerald-100 text-sm">
                                    {summary.total} lines across {summary.uniqueOrders} orders
                                </p>
                            </div>
                        </div>
                        <button
                            onClick={onClose}
                            className="p-2 hover:bg-white/20 rounded-lg transition-colors"
                        >
                            <X size={20} />
                        </button>
                    </div>
                </div>

                <div className="p-6 space-y-5 overflow-y-auto flex-1">
                    {/* Summary */}
                    <div className="grid grid-cols-2 gap-3">
                        <div className="p-3 bg-green-50 border border-green-200 rounded-lg">
                            <div className="flex items-center gap-2 text-green-700">
                                <CheckCircle size={16} />
                                <span className="text-sm font-medium">AWB Match</span>
                            </div>
                            <div className="text-2xl font-bold text-green-800 mt-1">
                                {summary.match}
                            </div>
                        </div>
                        <div className="p-3 bg-gray-50 border border-gray-200 rounded-lg">
                            <div className="flex items-center gap-2 text-gray-600">
                                <Package size={16} />
                                <span className="text-sm font-medium">No Shopify AWB</span>
                            </div>
                            <div className="text-2xl font-bold text-gray-700 mt-1">
                                {summary.noExpected}
                            </div>
                        </div>
                        {summary.mismatch > 0 && (
                            <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg">
                                <div className="flex items-center gap-2 text-amber-700">
                                    <AlertCircle size={16} />
                                    <span className="text-sm font-medium">AWB Mismatch</span>
                                </div>
                                <div className="text-2xl font-bold text-amber-800 mt-1">
                                    {summary.mismatch}
                                </div>
                            </div>
                        )}
                        {summary.missing > 0 && (
                            <div className="p-3 bg-red-50 border border-red-200 rounded-lg">
                                <div className="flex items-center gap-2 text-red-700">
                                    <AlertTriangle size={16} />
                                    <span className="text-sm font-medium">Missing AWB</span>
                                </div>
                                <div className="text-2xl font-bold text-red-800 mt-1">
                                    {summary.missing}
                                </div>
                            </div>
                        )}
                    </div>

                    {/* Mismatch Details */}
                    {mismatchLines.length > 0 && (
                        <div className="space-y-2">
                            <div className="text-sm font-medium text-amber-700 flex items-center gap-2">
                                <AlertCircle size={14} />
                                AWB Mismatch Details
                            </div>
                            <div className="max-h-32 overflow-y-auto space-y-1">
                                {mismatchLines.map(line => (
                                    <div key={line.lineId} className="p-2 bg-amber-50 border border-amber-100 rounded text-xs">
                                        <div className="flex justify-between items-center">
                                            <span className="font-medium">#{line.orderNumber}</span>
                                            <span className="text-amber-600">{line.sku}</span>
                                        </div>
                                        <div className="mt-1 text-amber-600">
                                            <span className="font-mono">{line.lineAwb}</span>
                                            <span className="text-amber-400 mx-1">vs</span>
                                            <span className="font-mono text-gray-500">{line.expectedAwb}</span>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}

                    {/* Missing AWB Details */}
                    {missingLines.length > 0 && (
                        <div className="space-y-2">
                            <div className="text-sm font-medium text-red-700 flex items-center gap-2">
                                <AlertTriangle size={14} />
                                Missing AWB
                            </div>
                            <div className="max-h-32 overflow-y-auto space-y-1">
                                {missingLines.map(line => (
                                    <div key={line.lineId} className="p-2 bg-red-50 border border-red-100 rounded text-xs">
                                        <div className="flex justify-between items-center">
                                            <span className="font-medium">#{line.orderNumber}</span>
                                            <span className="text-red-600">{line.sku}</span>
                                        </div>
                                        <div className="mt-1 text-red-500">
                                            Expected: <span className="font-mono">{line.expectedAwb}</span>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}

                    {/* Comment field (required if issues) */}
                    {hasIssues && (
                        <div className="space-y-2">
                            <label className="text-sm font-medium text-gray-700">
                                Comment <span className="text-red-500">*</span>
                                <span className="font-normal text-gray-500 ml-1">(required for exceptions)</span>
                            </label>
                            <textarea
                                value={comment}
                                onChange={(e) => setComment(e.target.value)}
                                placeholder="Explain why these exceptions are being processed..."
                                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm resize-none focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500"
                                rows={2}
                            />
                        </div>
                    )}

                    {/* Info box */}
                    <div className="p-3 bg-blue-50 border border-blue-200 rounded-lg text-sm text-blue-700">
                        <div className="font-medium">What happens on process:</div>
                        <ul className="mt-1 text-xs space-y-1 text-blue-600">
                            <li>• Inventory will be released for all lines</li>
                            <li>• Sale transactions will be recorded</li>
                            <li>• Lines will move to Shipped tab</li>
                        </ul>
                    </div>
                </div>

                {/* Actions */}
                <div className="px-6 py-4 bg-gray-50 border-t border-gray-200 flex gap-3 flex-shrink-0">
                    <button
                        type="button"
                        onClick={onClose}
                        className="btn-secondary flex-1"
                    >
                        Cancel
                    </button>
                    <button
                        onClick={handleProcess}
                        disabled={isProcessing || !canProcess}
                        className={`flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg font-medium transition-all ${
                            canProcess
                                ? 'bg-emerald-600 hover:bg-emerald-700 text-white shadow-lg shadow-emerald-200'
                                : 'bg-gray-300 text-gray-500 cursor-not-allowed'
                        } disabled:opacity-50`}
                    >
                        <Truck size={18} />
                        {isProcessing
                            ? 'Processing...'
                            : `Process ${summary.total} Lines`
                        }
                    </button>
                </div>
            </div>
        </div>
    );
}

export default ProcessShippedModal;
