/**
 * ActionCard — Confirmation card for pending mutating actions.
 * Shows what the agent wants to do and lets the user approve or cancel.
 */

import { useState } from 'react';
import { Check, X, Loader2 } from 'lucide-react';
import { confirmAction } from './chatApi';

interface PendingAction {
    actionId: string;
    toolName: string;
    toolInput: Record<string, unknown>;
    description: string;
}

interface ActionCardProps {
    action: PendingAction;
    onResult: (message: string) => void;
}

/** Human-readable label for tool names */
function toolLabel(name: string): string {
    const labels: Record<string, string> = {
        add_fabric_inward: 'Add Fabric Inward',
        add_inventory_inward: 'Add Inventory',
        add_inventory_outward: 'Remove Inventory',
        adjust_inventory: 'Adjust Inventory',
    };
    return labels[name] ?? name;
}

/** Extract key details from tool input for display */
function toolDetails(_toolName: string, input: Record<string, unknown>): string[] {
    const details: string[] = [];

    if (input.qty != null) {
        const unit = input.unit ? ` ${input.unit}` : ' units';
        details.push(`Quantity: ${input.qty}${unit}`);
    }
    if (input.newBalance != null) {
        details.push(`New balance: ${input.newBalance}`);
    }
    if (input.reason) {
        details.push(`Reason: ${String(input.reason)}`);
    }
    if (input.costPerUnit != null) {
        details.push(`Cost: ₹${input.costPerUnit}/unit`);
    }
    if (input.notes) {
        details.push(`Notes: ${String(input.notes)}`);
    }

    return details;
}

export function ActionCard({ action, onResult }: ActionCardProps) {
    const [status, setStatus] = useState<'pending' | 'confirming' | 'done' | 'cancelled'>('pending');

    const handleConfirm = async () => {
        setStatus('confirming');
        try {
            const result = await confirmAction(action.actionId, action.toolName, action.toolInput);
            setStatus('done');
            if (result.success && result.data && typeof result.data === 'object' && 'message' in result.data) {
                onResult(String((result.data as { message: string }).message));
            } else if (result.success) {
                onResult('Action completed successfully.');
            } else {
                onResult(`Failed: ${result.error ?? 'Unknown error'}`);
            }
        } catch (error: unknown) {
            setStatus('done');
            onResult(`Error: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    };

    const handleCancel = () => {
        setStatus('cancelled');
        onResult('Action cancelled.');
    };

    const details = toolDetails(action.toolName, action.toolInput);

    return (
        <div className="my-2 rounded-lg border border-amber-200 bg-amber-50 p-3">
            <div className="text-sm font-medium text-amber-900">
                {toolLabel(action.toolName)}
            </div>
            <div className="mt-1 text-sm text-amber-800">
                {action.description}
            </div>
            {details.length > 0 && (
                <ul className="mt-1.5 space-y-0.5">
                    {details.map((d, i) => (
                        <li key={i} className="text-xs text-amber-700">{d}</li>
                    ))}
                </ul>
            )}

            {status === 'pending' && (
                <div className="mt-2.5 flex gap-2">
                    <button
                        onClick={handleCancel}
                        className="inline-flex items-center gap-1 rounded-md border border-gray-300 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50 transition-colors"
                    >
                        <X size={14} />
                        Cancel
                    </button>
                    <button
                        onClick={handleConfirm}
                        className="inline-flex items-center gap-1 rounded-md bg-green-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-green-700 transition-colors"
                    >
                        <Check size={14} />
                        Confirm
                    </button>
                </div>
            )}

            {status === 'confirming' && (
                <div className="mt-2.5 flex items-center gap-1.5 text-xs text-amber-700">
                    <Loader2 size={14} className="animate-spin" />
                    Executing...
                </div>
            )}

            {status === 'done' && (
                <div className="mt-2 text-xs text-green-700 font-medium">Completed</div>
            )}

            {status === 'cancelled' && (
                <div className="mt-2 text-xs text-gray-500">Cancelled</div>
            )}
        </div>
    );
}
