/**
 * SidebarTab component
 * Admin UI for reordering sidebar sections
 *
 * Uses Server Functions for data fetching and mutations.
 */

import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { getSidebarOrder, updateSidebarOrder } from '../../../server/functions/admin';
import { useAuth } from '../../../hooks/useAuth';
import {
    DndContext,
    closestCenter,
    KeyboardSensor,
    PointerSensor,
    useSensor,
    useSensors,
    type DragEndEvent,
} from '@dnd-kit/core';
import {
    arrayMove,
    SortableContext,
    sortableKeyboardCoordinates,
    useSortable,
    verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { GripVertical, RotateCcw, Save, Loader2 } from 'lucide-react';

// Default sidebar section order (matches Layout.tsx)
const DEFAULT_ORDER = [
    '', // Dashboard/Search group
    'Orders',
    'Catalog',
    'Shipping & Returns',
    'Operations',
    'Counts',
    'Reports',
    'Admin',
];

// Display names for sections
const SECTION_DISPLAY_NAMES: Record<string, string> = {
    '': 'Dashboard & Search',
    'Orders': 'Orders',
    'Catalog': 'Catalog',
    'Shipping & Returns': 'Shipping & Returns',
    'Operations': 'Operations',
    'Counts': 'Counts',
    'Reports': 'Reports',
    'Admin': 'Admin',
};

interface SortableItemProps {
    id: string;
    displayName: string;
}

function SortableItem({ id, displayName }: SortableItemProps) {
    const {
        attributes,
        listeners,
        setNodeRef,
        transform,
        transition,
        isDragging,
    } = useSortable({ id });

    const style = {
        transform: CSS.Transform.toString(transform),
        transition,
    };

    return (
        <div
            ref={setNodeRef}
            style={style}
            className={`flex items-center gap-3 p-3 bg-white border rounded-lg ${
                isDragging ? 'shadow-lg border-primary-300 bg-primary-50' : 'border-gray-200'
            }`}
        >
            <button
                className="cursor-grab active:cursor-grabbing text-gray-400 hover:text-gray-600"
                {...attributes}
                {...listeners}
            >
                <GripVertical size={20} />
            </button>
            <span className="font-medium text-gray-700">{displayName}</span>
        </div>
    );
}

export function SidebarTab() {
    const queryClient = useQueryClient();
    const { user } = useAuth();
    const [order, setOrder] = useState<string[]>(DEFAULT_ORDER);
    const [hasChanges, setHasChanges] = useState(false);

    const sensors = useSensors(
        useSensor(PointerSensor),
        useSensor(KeyboardSensor, {
            coordinateGetter: sortableKeyboardCoordinates,
        })
    );

    const { data: savedOrder, isLoading } = useQuery({
        queryKey: ['sidebarOrder'],
        queryFn: async () => {
            const result = await getSidebarOrder();
            if (!result.success) {
                throw new Error(result.error?.message || 'Failed to fetch sidebar order');
            }
            return result.data;
        },
        enabled: user?.role === 'admin',
    });

    useEffect(() => {
        if (savedOrder) {
            // eslint-disable-next-line react-hooks/set-state-in-effect -- syncing local state from fetched order
            setOrder(savedOrder);
        }
    }, [savedOrder]);

    const saveMutation = useMutation({
        mutationFn: async (newOrder: string[]) => {
            const result = await updateSidebarOrder({ data: { order: newOrder } });
            if (!result.success) {
                throw new Error(result.error?.message || 'Failed to update sidebar order');
            }
            return result.data;
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['sidebarOrder'] });
            setHasChanges(false);
        },
    });

    const handleDragEnd = (event: DragEndEvent) => {
        const { active, over } = event;

        if (over && active.id !== over.id) {
            setOrder((items) => {
                const oldIndex = items.indexOf(active.id as string);
                const newIndex = items.indexOf(over.id as string);
                const newOrder = arrayMove(items, oldIndex, newIndex);
                setHasChanges(true);
                return newOrder;
            });
        }
    };

    const handleSave = () => {
        saveMutation.mutate(order);
    };

    const handleReset = () => {
        setOrder(DEFAULT_ORDER);
        setHasChanges(true);
    };

    if (user?.role !== 'admin') {
        return (
            <div className="p-6 text-center text-gray-500">
                Only admins can configure sidebar order.
            </div>
        );
    }

    if (isLoading) {
        return (
            <div className="flex items-center justify-center p-12">
                <Loader2 className="animate-spin text-primary-600" size={32} />
            </div>
        );
    }

    return (
        <div className="space-y-6">
            <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
                <div className="flex items-center justify-between mb-4">
                    <div>
                        <h3 className="text-lg font-semibold text-gray-900">Sidebar Section Order</h3>
                        <p className="text-sm text-gray-500 mt-1">
                            Drag sections to reorder. Changes apply to all users.
                        </p>
                    </div>
                    <div className="flex gap-2">
                        <button
                            onClick={handleReset}
                            className="px-3 py-2 text-sm border border-gray-300 rounded-lg hover:bg-gray-50 flex items-center gap-2"
                        >
                            <RotateCcw size={16} />
                            Reset to Default
                        </button>
                        <button
                            onClick={handleSave}
                            disabled={!hasChanges || saveMutation.isPending}
                            className="px-4 py-2 text-sm bg-primary-600 text-white rounded-lg hover:bg-primary-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
                        >
                            {saveMutation.isPending ? (
                                <Loader2 className="animate-spin" size={16} />
                            ) : (
                                <Save size={16} />
                            )}
                            Save Order
                        </button>
                    </div>
                </div>

                {saveMutation.isSuccess && (
                    <div className="mb-4 p-3 bg-green-50 border border-green-200 rounded-lg text-green-700 text-sm">
                        Sidebar order saved successfully! Refresh the page to see changes.
                    </div>
                )}

                {saveMutation.isError && (
                    <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
                        Failed to save sidebar order. Please try again.
                    </div>
                )}

                <DndContext
                    sensors={sensors}
                    collisionDetection={closestCenter}
                    onDragEnd={handleDragEnd}
                >
                    <SortableContext items={order} strategy={verticalListSortingStrategy}>
                        <div className="space-y-2">
                            {order.map((sectionLabel) => (
                                <SortableItem
                                    key={sectionLabel || '__dashboard__'}
                                    id={sectionLabel}
                                    displayName={SECTION_DISPLAY_NAMES[sectionLabel] || sectionLabel}
                                />
                            ))}
                        </div>
                    </SortableContext>
                </DndContext>

                {hasChanges && (
                    <p className="mt-4 text-sm text-amber-600">
                        You have unsaved changes.
                    </p>
                )}
            </div>
        </div>
    );
}
