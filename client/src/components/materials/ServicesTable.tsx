/**
 * ServicesTable - TanStack Table based table for Services catalog
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
import { getServices } from '@/server/functions/materials';

interface Service {
    id: string;
    code: string;
    name: string;
    category: string;
    description?: string | null;
    costPerJob?: number | null;
    costUnit: string;
    partyId?: string | null;
    partyName?: string | null;
    leadTimeDays?: number | null;
    usageCount?: number;
    isActive: boolean;
}

interface ServicesTableProps {
    onEdit?: (service: Service) => void;
    onViewDetails: (service: Service) => void;
    onAdd?: () => void;
}

function formatCostUnit(value: string | null | undefined): string {
    if (!value) return '-';
    if (value === 'per_piece') return '/pc';
    if (value === 'per_meter') return '/m';
    return value;
}

export function ServicesTable({ onEdit, onViewDetails, onAdd }: ServicesTableProps) {
    // Server Function hook
    const getServicesFn = useServerFn(getServices);

    // Fetch services data using Server Function
    const { data, isLoading, refetch, isFetching } = useQuery({
        queryKey: ['servicesCatalog'],
        queryFn: () => getServicesFn({ data: {} }),
    });

    const items: Service[] = data?.items || [];

    // Column definitions
    const columns = useMemo<ColumnDef<Service>[]>(() => [
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
                <Badge variant="info" className="capitalize">
                    {row.original.category}
                </Badge>
            ),
        },
        {
            accessorKey: 'costPerJob',
            header: 'Cost/Job',
            cell: ({ row }) => (
                <span className="text-right tabular-nums">
                    {row.original.costPerJob != null ? `₹${row.original.costPerJob}` : '-'}
                </span>
            ),
        },
        {
            accessorKey: 'costUnit',
            header: 'Cost Unit',
            cell: ({ row }) => (
                <span className="text-xs text-muted-foreground">
                    {formatCostUnit(row.original.costUnit)}
                </span>
            ),
        },
        {
            accessorKey: 'partyName',
            header: 'Vendor',
            cell: ({ row }) => (
                <span className="text-xs text-muted-foreground">
                    {row.original.partyName || '-'}
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
                    {onEdit && <button
                        onClick={(e) => {
                            e.stopPropagation();
                            onEdit(row.original);
                        }}
                        className="p-1 rounded hover:bg-blue-100 text-gray-500 hover:text-blue-600"
                        title="Edit service"
                    >
                        <Pencil size={14} />
                    </button>}
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
                searchPlaceholder="Search services..."
                isLoading={isLoading}
                pageSize={50}
                emptyMessage="No services found. Add your first service to get started."
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
                        {onAdd && <Button size="sm" onClick={onAdd}>
                            <Plus className="h-4 w-4 mr-1" />
                            Add Service
                        </Button>}
                    </div>
                }
            />
        </div>
    );
}
