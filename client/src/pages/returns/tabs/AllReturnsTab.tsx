import { useState } from 'react';
import { X, Save, Pencil } from 'lucide-react';
import type { ActiveReturnLine } from '../types';
import { getStatusBadge, getResolutionBadge } from '../types';
import { RETURN_REASONS } from '@coh/shared/domain/returns';
import { ReturnTrackingStatus } from '../ReturnTrackingStatus';

export interface AllReturnsTabProps {
    returns: ActiveReturnLine[];
    loading: boolean;
    onViewCustomer: (customerId: string) => void;
    onCancel: (lineId: string) => void;
    onUpdateNotes: (lineId: string, notes: string) => void;
}

export function AllReturnsTab({ returns, loading, onViewCustomer, onCancel, onUpdateNotes }: AllReturnsTabProps) {
    const [statusFilter, setStatusFilter] = useState<string>('all');
    const [searchTerm, setSearchTerm] = useState('');
    const [editingNotesId, setEditingNotesId] = useState<string | null>(null);
    const [editingNotesValue, setEditingNotesValue] = useState('');

    const startEditNotes = (lineId: string, currentNotes: string | null) => {
        setEditingNotesId(lineId);
        setEditingNotesValue(currentNotes || '');
    };

    const saveNotes = (lineId: string) => {
        onUpdateNotes(lineId, editingNotesValue);
        setEditingNotesId(null);
        setEditingNotesValue('');
    };

    const cancelEditNotes = () => {
        setEditingNotesId(null);
        setEditingNotesValue('');
    };

    if (loading) {
        return <div className="text-center py-12">Loading returns...</div>;
    }

    const filteredReturns = returns.filter((ret) => {
        if (statusFilter !== 'all' && ret.returnStatus !== statusFilter) return false;
        if (searchTerm) {
            const term = searchTerm.toLowerCase();
            return (
                ret.orderNumber.toLowerCase().includes(term) ||
                ret.skuCode.toLowerCase().includes(term) ||
                ret.customerName.toLowerCase().includes(term) ||
                (ret.returnReasonDetail || '').toLowerCase().includes(term)
            );
        }
        return true;
    });

    return (
        <div>
            {/* Filters */}
            <div className="flex gap-4 mb-4">
                <input
                    type="text"
                    placeholder="Search order, SKU, customer..."
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    className="flex-1 px-4 py-2 border border-gray-300 rounded-lg"
                />
                <select
                    value={statusFilter}
                    onChange={(e) => setStatusFilter(e.target.value)}
                    className="px-4 py-2 border border-gray-300 rounded-lg"
                >
                    <option value="all">All Statuses</option>
                    <option value="requested">Requested</option>
                    <option value="pickup_scheduled">Pickup Scheduled</option>
                    <option value="in_transit">In Transit</option>
                    <option value="received">Received</option>
                </select>
            </div>

            {/* Table */}
            {filteredReturns.length === 0 ? (
                <div className="text-center py-12 text-gray-500">No returns found</div>
            ) : (
                <div className="border border-gray-200 rounded-lg overflow-hidden">
                    <table className="w-full">
                        <thead className="bg-gray-50">
                            <tr>
                                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Order</th>
                                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Product</th>
                                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Qty</th>
                                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Status</th>
                                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Resolution</th>
                                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Reason</th>
                                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">AWB / Tracking</th>
                                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Customer</th>
                                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Age</th>
                                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Notes</th>
                                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Actions</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-200">
                            {filteredReturns.map((ret) => (
                                <tr key={ret.id} className="hover:bg-gray-50">
                                    <td className="px-4 py-3 text-sm">{ret.orderNumber}</td>
                                    <td className="px-4 py-3 text-sm">
                                        <div>{ret.productName}</div>
                                        <div className="text-xs text-gray-500">
                                            {ret.colorName} - {ret.size} ({ret.skuCode})
                                        </div>
                                    </td>
                                    <td className="px-4 py-3 text-sm">{ret.returnQty}</td>
                                    <td className="px-4 py-3 text-sm">
                                        <span className={`px-2 py-1 text-xs rounded ${getStatusBadge(ret.returnStatus)}`}>
                                            {ret.returnStatus}
                                        </span>
                                    </td>
                                    <td className="px-4 py-3 text-sm">
                                        <span className={`px-2 py-1 text-xs rounded ${getResolutionBadge(ret.returnResolution).color}`}>
                                            {getResolutionBadge(ret.returnResolution).label}
                                        </span>
                                    </td>
                                    <td className="px-4 py-3 text-sm max-w-[220px]">
                                        {ret.returnReasonDetail ? (
                                            <div>
                                                <div className="text-gray-700 text-xs leading-snug" title={ret.returnReasonDetail}>
                                                    {ret.returnReasonDetail}
                                                </div>
                                                {ret.returnReasonCategory && ret.returnReasonCategory !== 'other' && (
                                                    <span className="text-[10px] text-gray-400 mt-0.5 inline-block">
                                                        {RETURN_REASONS[ret.returnReasonCategory as keyof typeof RETURN_REASONS] || ret.returnReasonCategory}
                                                    </span>
                                                )}
                                            </div>
                                        ) : ret.returnReasonCategory && ret.returnReasonCategory !== 'other' ? (
                                            <span className="text-xs text-gray-500">
                                                {RETURN_REASONS[ret.returnReasonCategory as keyof typeof RETURN_REASONS] || ret.returnReasonCategory}
                                            </span>
                                        ) : (
                                            <span className="text-gray-400">-</span>
                                        )}
                                    </td>
                                    <td className="px-4 py-3 text-sm">
                                        {ret.returnAwbNumber ? (
                                            <div>
                                                <div className="text-xs text-gray-600 font-mono">
                                                    {ret.returnAwbNumber}
                                                </div>
                                                <ReturnTrackingStatus awbNumber={ret.returnAwbNumber} />
                                            </div>
                                        ) : (
                                            <span className="text-gray-400">-</span>
                                        )}
                                    </td>
                                    <td className="px-4 py-3 text-sm">
                                        <button
                                            onClick={() => ret.customerId && onViewCustomer(ret.customerId)}
                                            className="text-blue-600 hover:underline"
                                        >
                                            {ret.customerName}
                                        </button>
                                    </td>
                                    <td className="px-4 py-3 text-sm text-gray-500">{ret.ageDays}d</td>
                                    <td className="px-4 py-3 text-sm max-w-[200px]">
                                        {editingNotesId === ret.id ? (
                                            <div className="flex gap-1">
                                                <input
                                                    type="text"
                                                    value={editingNotesValue}
                                                    onChange={(e) => setEditingNotesValue(e.target.value)}
                                                    className="flex-1 px-2 py-1 border border-gray-300 rounded text-sm min-w-0"
                                                    autoFocus
                                                    onKeyDown={(e) => {
                                                        if (e.key === 'Enter') saveNotes(ret.id);
                                                        if (e.key === 'Escape') cancelEditNotes();
                                                    }}
                                                />
                                                <button
                                                    onClick={() => saveNotes(ret.id)}
                                                    className="p-1 text-green-600 hover:bg-green-50 rounded"
                                                    title="Save"
                                                >
                                                    <Save size={14} />
                                                </button>
                                                <button
                                                    onClick={cancelEditNotes}
                                                    className="p-1 text-gray-400 hover:bg-gray-100 rounded"
                                                    title="Cancel"
                                                >
                                                    <X size={14} />
                                                </button>
                                            </div>
                                        ) : (
                                            <div className="flex items-center gap-1 group">
                                                <span className="truncate text-gray-600">
                                                    {ret.returnNotes || <span className="text-gray-400 italic">-</span>}
                                                </span>
                                                <button
                                                    onClick={() => startEditNotes(ret.id, ret.returnNotes)}
                                                    className="p-1 text-gray-400 hover:text-blue-600 opacity-0 group-hover:opacity-100 transition-opacity"
                                                    title="Edit notes"
                                                >
                                                    <Pencil size={12} />
                                                </button>
                                            </div>
                                        )}
                                    </td>
                                    <td className="px-4 py-3 text-sm">
                                        <button
                                            onClick={() => onCancel(ret.id)}
                                            className="text-red-600 hover:underline text-xs"
                                        >
                                            Cancel
                                        </button>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}
        </div>
    );
}
