/**
 * TrimsTable - TanStack Table based table for Trims catalog
 *
 * Features:
 * - Sortable columns
 * - Search filtering
 * - Actions (view, edit)
 *
 * Uses Server Functions for data fetching instead of REST API.
 */

import { useMemo } from 'react';
import { type ColumnDef } from '@tanstack/react-table';
import { Eye, Pencil, Plus, RefreshCw } from 'lucide-react';
import { useServerFn } from '@tanstack/react-start';
import { useQuery } from '@tanstack/react-query';

import { DataTable } from '@/components/ui/data-table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { getTrims } from '@/server/functions/materials';

interface Trim {
    id: string;
    code: string;
    name: string;
    category: string;
    description?: string | null;
    costPerUnit?: number | null;
    unit: string;
    supplierId?: string | null;
    supplierName?: string | null;
    leadTimeDays?: number | null;
    minOrderQty?: number | null;
    usageCount?: number;
    isActive: boolean;
}

interface TrimsTableProps {
    onEdit: (trim: Trim) => void;
    onViewDetails: (trim: Trim) => void;
    onAdd: () => void;
}

export function TrimsTable({ onEdit, onViewDetails, onAdd }: TrimsTableProps) {
    // Server Function hook
    const getTrimsFn = useServerFn(getTrims);

    // Fetch trims data using Server Function
    const { data, isLoading, refetch, isFetching } = useQuery({
        queryKey: ['trimsCatalog'],
        queryFn: () => getTrimsFn({ data: {} }),
    });

    const items: Trim[] = data?.items || [];

    // Column definitions
    const columns = useMemo<ColumnDef<Trim>[]>(() => [
        {
            accessorKey: 'code',
            header: 'Code',
            cell: ({ row }) => (
                <span className="font-mono text-xs">{row.original.code}</span>
            ),
        },
        {
            accessorKey: 'name',
            header: 'Name',
            cell: ({ row }) => (
                <span className="font-medium">{row.original.name}</span>
            ),
        },
        {
            accessorKey: 'category',
            header: 'Category',
            cell: ({ row }) => (
                <Badge variant="secondary" className="capitalize">
                    {row.original.category}
                </Badge>
            ),
        },
        {
            accessorKey: 'costPerUnit',
            header: 'Cost/Unit',
            cell: ({ row }) => (
                <span className="text-right tabular-nums">
                    {row.original.costPerUnit != null ? `₹${row.original.costPerUnit}` : '-'}
                </span>
            ),
        },
        {
            accessorKey: 'unit',
            header: 'Unit',
            cell: ({ row }) => (
                <span className="text-xs capitalize text-muted-foreground">
                    {row.original.unit}
                </span>
            ),
        },
        {
            accessorKey: 'supplierName',
            header: 'Supplier',
            cell: ({ row }) => (
                <span className="text-xs text-muted-foreground">
                    {row.original.supplierName || '-'}
                </span>
            ),
        },
        {
            accessorKey: 'leadTimeDays',
            header: 'Lead Time',
            cell: ({ row }) => (
                <span className="text-xs text-right tabular-nums">
                    {row.original.leadTimeDays != null ? `${row.original.leadTimeDays}d` : '-'}
                </span>
            ),
        },
        {
            accessorKey: 'minOrderQty',
            header: 'Min Order',
            cell: ({ row }) => (
                <span className="text-xs text-right tabular-nums">
                    {row.original.minOrderQty || '-'}
                </span>
            ),
        },
        {
            accessorKey: 'usageCount',
            header: 'Used In',
            cell: ({ row }) => (
                <span className="text-xs font-medium text-blue-600">
                    {row.original.usageCount || 0} BOMs
                </span>
            ),
        },
        {
            accessorKey: 'isActive',
            header: 'Status',
            cell: ({ row }) => (
                <Badge variant={row.original.isActive ? 'success' : 'secondary'}>
                    {row.original.isActive ? 'Active' : 'Inactive'}
                </Badge>
            ),
        },
        {
            id: 'actions',
            header: '',
            cell: ({ row }) => (
                <div className="flex items-center gap-1">
                    <button
                        onClick={(e) => {
                            e.stopPropagation();
                            onViewDetails(row.original);
                        }}
                        className="p-1 rounded hover:bg-gray-100 text-gray-500 hover:text-gray-700"
                        title="View details"
                    >
                        <Eye size={14} />
                    </button>
                    <button
                        onClick={(e) => {
                            e.stopPropagation();
                            onEdit(row.original);
                        }}
                        className="p-1 rounded hover:bg-blue-100 text-gray-500 hover:text-blue-600"
                        title="Edit trim"
                    >
                        <Pencil size={14} />
                    </button>
                </div>
            ),
        },
    ], [onEdit, onViewDetails]);

    return (
        <div className="space-y-4">
            <DataTable
                columns={columns}
                data={items}
                searchKey="name"
                searchPlaceholder="Search trims..."
                isLoading={isLoading}
                pageSize={50}
                emptyMessage="No trims found. Add your first trim to get started."
                toolbarRight={
                    <div className="flex items-center gap-2">
                        <Button
                            variant="outline"
                            size="sm"
                            onClick={() => refetch()}
                            disabled={isFetching}
                        >
                            <RefreshCw className={`h-4 w-4 ${isFetching ? 'animate-spin' : ''}`} />
                        </Button>
                        <Button size="sm" onClick={onAdd}>
                            <Plus className="h-4 w-4 mr-1" />
                            Add Trim
                        </Button>
                    </div>
                }
            />
        </div>
    );
}
