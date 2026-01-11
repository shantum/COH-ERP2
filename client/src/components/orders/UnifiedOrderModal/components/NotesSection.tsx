/**
 * NotesSection - Customer notes (read-only) and internal notes (editable)
 */

import { useState } from 'react';
import { MessageSquare, User, FileText, ChevronDown, ChevronUp } from 'lucide-react';
import type { Order } from '../../../../types';
import type { ModalMode } from '../types';

interface NotesSectionProps {
  order: Order;
  mode: ModalMode;
  internalNotes: string;
  onNotesChange: (notes: string) => void;
}

export function NotesSection({
  order,
  mode,
  internalNotes,
  onNotesChange,
}: NotesSectionProps) {
  const [isExpanded, setIsExpanded] = useState(true);

  const customerNotes = order.shopifyCache?.customerNotes;
  const hasCustomerNotes = customerNotes && customerNotes.trim();
  const hasInternalNotes = internalNotes && internalNotes.trim();
  const isEditing = mode === 'edit';

  // Don't show section if no notes and not in edit mode
  if (!hasCustomerNotes && !hasInternalNotes && !isEditing) {
    return null;
  }

  return (
    <div className="bg-white rounded-xl border border-slate-200/80 overflow-hidden">
      <button
        type="button"
        onClick={() => setIsExpanded(!isExpanded)}
        className="w-full px-4 py-3 border-b border-slate-100 bg-gradient-to-r from-slate-50 to-white flex items-center justify-between"
      >
        <div className="flex items-center gap-2">
          <div className="p-1.5 bg-slate-100 rounded-lg">
            <MessageSquare size={14} className="text-slate-500" />
          </div>
          <h3 className="text-sm font-semibold text-slate-700">Notes</h3>
          {(hasCustomerNotes || hasInternalNotes) && (
            <span className="px-2 py-0.5 bg-amber-100 text-amber-700 text-xs font-medium rounded-full">
              {hasCustomerNotes && hasInternalNotes ? '2' : '1'}
            </span>
          )}
        </div>
        {isExpanded ? <ChevronUp size={16} className="text-slate-400" /> : <ChevronDown size={16} className="text-slate-400" />}
      </button>

      {isExpanded && (
        <div className="p-4 space-y-4">
          {/* Customer Notes (read-only) */}
          {hasCustomerNotes && (
            <div className="p-3 bg-sky-50/50 rounded-lg border border-sky-100">
              <div className="flex items-center gap-2 mb-2">
                <User size={14} className="text-sky-600" />
                <span className="text-xs font-medium text-sky-700">Customer Note</span>
              </div>
              <p className="text-sm text-slate-700 whitespace-pre-wrap leading-relaxed">
                {customerNotes}
              </p>
            </div>
          )}

          {/* Internal Notes */}
          <div>
            <div className="flex items-center gap-2 mb-2">
              <FileText size={14} className="text-slate-500" />
              <span className="text-xs font-medium text-slate-600">Internal Notes</span>
              {isEditing && (
                <span className="text-xs text-slate-400">(only visible to team)</span>
              )}
            </div>

            {isEditing ? (
              <textarea
                value={internalNotes}
                onChange={(e) => onNotesChange(e.target.value)}
                placeholder="Add internal notes about this order..."
                rows={3}
                className="w-full px-3 py-2.5 text-sm border border-slate-200 rounded-lg focus:border-sky-400 focus:ring-2 focus:ring-sky-100 outline-none transition-all resize-none placeholder:text-slate-400"
              />
            ) : hasInternalNotes ? (
              <div className="p-3 bg-slate-50 rounded-lg border border-slate-100">
                <p className="text-sm text-slate-700 whitespace-pre-wrap leading-relaxed">
                  {internalNotes}
                </p>
              </div>
            ) : (
              <p className="text-sm text-slate-400 italic py-2">
                No internal notes
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
