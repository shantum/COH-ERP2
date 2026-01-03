/**
 * NotesModal component
 * Modal for editing internal order notes
 */

import { X, StickyNote } from 'lucide-react';

interface NotesModalProps {
    order: any;
    notesText: string;
    onNotesChange: (text: string) => void;
    onSave: () => void;
    onClose: () => void;
    isSaving: boolean;
}

export function NotesModal({
    order,
    notesText,
    onNotesChange,
    onSave,
    onClose,
    isSaving,
}: NotesModalProps) {
    return (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
            <div className="bg-white rounded-xl p-6 w-full max-w-md">
                <div className="flex items-center justify-between mb-4">
                    <div>
                        <h2 className="text-lg font-semibold flex items-center gap-2">
                            <StickyNote size={18} className="text-yellow-500" />
                            Order Notes
                        </h2>
                        <p className="text-sm text-gray-500">
                            {order.orderNumber} • {order.customerName}
                        </p>
                    </div>
                    <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
                        <X size={20} />
                    </button>
                </div>

                <form
                    onSubmit={(e) => {
                        e.preventDefault();
                        onSave();
                    }}
                    className="space-y-4"
                >
                    <div>
                        <label className="text-xs text-gray-500 mb-1 block">Internal Notes</label>
                        <textarea
                            className="input text-sm h-32 resize-none"
                            value={notesText}
                            onChange={(e) => onNotesChange(e.target.value)}
                            placeholder="Add internal notes about this order..."
                            autoFocus
                        />
                    </div>
                    <div className="flex gap-3 pt-2">
                        <button
                            type="button"
                            onClick={onClose}
                            className="btn-secondary flex-1 text-sm"
                        >
                            Cancel
                        </button>
                        <button
                            type="submit"
                            className="btn-primary flex-1 text-sm"
                            disabled={isSaving}
                        >
                            {isSaving ? 'Saving...' : 'Save Notes'}
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
}

export default NotesModal;
