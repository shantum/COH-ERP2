/**
 * ColumnVisibilityDropdown - Dropdown menu to toggle column visibility and reorder columns
 */

import { useState, useMemo } from 'react';
import {
    DndContext,
    closestCenter,
    PointerSensor,
    useSensor,
    useSensors,
    type DragEndEvent,
} from '@dnd-kit/core';
import {
    arrayMove,
    SortableContext,
    useSortable,
    verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuLabel,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from '../../../ui/dropdown-menu';
import { Button } from '../../../ui/button';
import { Checkbox } from '../../../ui/checkbox';
import { Columns3, GripVertical, RotateCcw, Save } from 'lucide-react';
import { toast } from 'sonner';
import type { VisibilityState } from '@tanstack/react-table';

interface ColumnVisibilityDropdownProps {
    visibleColumns: VisibilityState;
    onToggleColumn: (colId: string) => void;
    onResetAll: () => void;
    columnIds: string[];
    columnOrder: string[];
    onReorderColumns: (newOrder: string[]) => void;
    columnHeaders: Record<string, string>;
    // Admin-only
    isManager?: boolean;
    onSaveAsDefaults?: () => Promise<boolean>;
}

// Sortable item for each column
function SortableColumnItem({
    colId,
    isVisible,
    label,
    onToggle,
}: {
    colId: string;
    isVisible: boolean;
    label: string;
    onToggle: () => void;
}) {
    const {
        attributes,
        listeners,
        setNodeRef,
        transform,
        transition,
        isDragging,
    } = useSortable({ id: colId });

    const style: React.CSSProperties = {
        transform: CSS.Transform.toString(transform),
        transition,
        opacity: isDragging ? 0.5 : 1,
        zIndex: isDragging ? 1 : 0,
    };

    return (
        <div
            ref={setNodeRef}
            style={style}
            className="flex items-center gap-2 px-2 py-1.5 hover:bg-gray-100 rounded-sm"
        >
            <div
                {...attributes}
                {...listeners}
                className="p-0.5 text-gray-400 hover:text-gray-600 cursor-grab active:cursor-grabbing"
            >
                <GripVertical size={12} />
            </div>
            <Checkbox
                checked={isVisible}
                onCheckedChange={onToggle}
                className="h-4 w-4"
            />
            <span className="text-xs flex-1">{label}</span>
        </div>
    );
}

export function ColumnVisibilityDropdown({
    visibleColumns,
    onToggleColumn,
    onResetAll,
    columnIds,
    columnOrder,
    onReorderColumns,
    columnHeaders,
    isManager,
    onSaveAsDefaults,
}: ColumnVisibilityDropdownProps) {
    const [open, setOpen] = useState(false);
    const [isSaving, setIsSaving] = useState(false);

    const handleSaveAsDefaults = async () => {
        if (!onSaveAsDefaults) return;
        setIsSaving(true);
        const success = await onSaveAsDefaults();
        setIsSaving(false);
        if (success) {
            toast.success('Column defaults saved for all users');
        } else {
            toast.error('Failed to save defaults');
        }
    };

    // Memoize sensors to prevent recreation on every render
    const sensors = useSensors(
        useSensor(PointerSensor, {
            activationConstraint: {
                distance: 5,
            },
        })
    );

    const handleDragEnd = (event: DragEndEvent) => {
        const { active, over } = event;
        if (over && active.id !== over.id) {
            const oldIndex = columnOrder.indexOf(active.id as string);
            const newIndex = columnOrder.indexOf(over.id as string);
            if (oldIndex !== -1 && newIndex !== -1) {
                const newOrder = arrayMove(columnOrder, oldIndex, newIndex);
                onReorderColumns(newOrder);
            }
        }
    };

    const visibleCount = useMemo(
        () => Object.values(visibleColumns).filter(Boolean).length,
        [visibleColumns]
    );
    const totalCount = columnIds.length;

    // Use columnOrder for display order
    const orderedColumnIds = useMemo(
        () => (columnOrder.length > 0 ? columnOrder : columnIds),
        [columnOrder, columnIds]
    );

    return (
        <DropdownMenu open={open} onOpenChange={setOpen}>
            <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="sm" className="gap-0.5 h-5 px-1.5 text-[9px] text-gray-500 hover:text-gray-700">
                    <Columns3 size={11} />
                    <span>{visibleCount}/{totalCount}</span>
                </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56 max-h-96 overflow-y-auto">
                <DropdownMenuLabel className="text-xs flex items-center gap-2">
                    <GripVertical size={10} className="text-gray-400" />
                    Drag to reorder
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                {open && (
                    <DndContext
                        sensors={sensors}
                        collisionDetection={closestCenter}
                        onDragEnd={handleDragEnd}
                    >
                        <SortableContext
                            items={orderedColumnIds}
                            strategy={verticalListSortingStrategy}
                        >
                            <div className="py-1">
                                {orderedColumnIds.map((colId) => (
                                    <SortableColumnItem
                                        key={colId}
                                        colId={colId}
                                        isVisible={visibleColumns[colId] ?? false}
                                        label={columnHeaders[colId] || colId}
                                        onToggle={() => onToggleColumn(colId)}
                                    />
                                ))}
                            </div>
                        </SortableContext>
                    </DndContext>
                )}
                <DropdownMenuSeparator />
                <button
                    onClick={(e) => {
                        e.preventDefault();
                        onResetAll();
                    }}
                    className="flex items-center gap-2 px-2 py-1.5 w-full text-amber-600 hover:bg-amber-50 rounded-sm"
                >
                    <RotateCcw size={12} />
                    <span className="text-xs">Reset to Defaults</span>
                </button>
                {isManager && onSaveAsDefaults && (
                    <button
                        onClick={(e) => {
                            e.preventDefault();
                            handleSaveAsDefaults();
                        }}
                        disabled={isSaving}
                        className="flex items-center gap-2 px-2 py-1.5 w-full text-blue-600 hover:bg-blue-50 rounded-sm disabled:opacity-50"
                    >
                        <Save size={12} />
                        <span className="text-xs">{isSaving ? 'Saving...' : 'Save as Default'}</span>
                    </button>
                )}
            </DropdownMenuContent>
        </DropdownMenu>
    );
}
