/**
 * ActionsCell - Row action buttons (edit, add child, view, inward)
 */

import { Pencil, Plus, Eye, Package } from 'lucide-react';
import type { MaterialNode } from '../types';

interface ActionsCellProps {
    node: MaterialNode;
    onEdit: (node: MaterialNode) => void;
    onAddChild?: (node: MaterialNode) => void;
    onViewDetails?: (node: MaterialNode) => void;
    onAddInward?: (node: MaterialNode) => void;
}

export function ActionsCell({
    node,
    onEdit,
    onAddChild,
    onViewDetails,
    onAddInward,
}: ActionsCellProps) {
    const canAddChild = node.type !== 'colour';
    const showInward = node.type === 'colour';

    return (
        <div className="flex items-center gap-1">
            {onViewDetails && (
                <button
                    type="button"
                    onClick={() => onViewDetails(node)}
                    className="p-1 rounded hover:bg-gray-100 text-gray-500 hover:text-gray-700"
                    title="View details"
                >
                    <Eye size={14} />
                </button>
            )}
            <button
                type="button"
                onClick={() => onEdit(node)}
                className="p-1 rounded hover:bg-blue-100 text-gray-500 hover:text-blue-600"
                title={`Edit ${node.type}`}
            >
                <Pencil size={14} />
            </button>
            {canAddChild && onAddChild && (
                <button
                    type="button"
                    onClick={() => onAddChild(node)}
                    className="p-1 rounded hover:bg-green-100 text-gray-500 hover:text-green-600"
                    title={node.type === 'material' ? 'Add fabric' : 'Add colour'}
                >
                    <Plus size={14} />
                </button>
            )}
            {showInward && onAddInward && (
                <button
                    type="button"
                    onClick={() => onAddInward(node)}
                    className="p-1 rounded hover:bg-green-100 text-green-500 hover:text-green-700"
                    title="Add inward"
                >
                    <Package size={14} />
                </button>
            )}
        </div>
    );
}
