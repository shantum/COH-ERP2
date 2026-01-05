import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { ordersApi } from '../services/api';
import { useState } from 'react';
import { Check } from 'lucide-react';

export default function Picklist() {
    const queryClient = useQueryClient();
    const [pickingLines, setPickingLines] = useState<Set<string>>(new Set());

    const { data: openOrders, isLoading } = useQuery({
        queryKey: ['openOrders'],
        queryFn: () => ordersApi.getOpen().then(r => r.data.orders || r.data)
    });

    const pickLine = useMutation({
        mutationFn: (lineId: string) => ordersApi.pickLine(lineId),
        onMutate: (lineId) => setPickingLines(p => new Set(p).add(lineId)),
        onSettled: (_, __, lineId) => {
            setPickingLines(p => { const n = new Set(p); n.delete(lineId); return n; });
            queryClient.invalidateQueries({ queryKey: ['openOrders'] });
        }
    });

    const unpickLine = useMutation({
        mutationFn: (lineId: string) => ordersApi.unpickLine(lineId),
        onMutate: (lineId) => setPickingLines(p => new Set(p).add(lineId)),
        onSettled: (_, __, lineId) => {
            setPickingLines(p => { const n = new Set(p); n.delete(lineId); return n; });
            queryClient.invalidateQueries({ queryKey: ['openOrders'] });
        }
    });

    // Get all allocated and picked lines from orders
    const allocatedLines: any[] = [];
    openOrders?.forEach((order: any) => {
        order.orderLines?.forEach((line: any) => {
            if (line.lineStatus === 'allocated' || line.lineStatus === 'picked') {
                allocatedLines.push({
                    ...line,
                    orderNumber: order.orderNumber,
                    customerName: order.customerName,
                    orderDate: order.orderDate,
                });
            }
        });
    });

    // Sort by order date (oldest first)
    allocatedLines.sort((a, b) => new Date(a.orderDate).getTime() - new Date(b.orderDate).getTime());

    const formatDate = (dateStr: string) => {
        const d = new Date(dateStr);
        return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
    };

    return (
        <div className="space-y-4">
            <div className="flex items-center justify-between">
                <h1 className="text-2xl font-bold text-gray-900">Picklist</h1>
                <div className="text-sm text-gray-500">
                    {allocatedLines.filter(l => l.lineStatus === 'picked').length} / {allocatedLines.length} picked
                </div>
            </div>

            {isLoading && (
                <div className="flex justify-center p-8">
                    <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-gray-400"></div>
                </div>
            )}

            {!isLoading && allocatedLines.length === 0 && (
                <div className="text-center text-gray-400 py-12">No items to pick</div>
            )}

            {!isLoading && allocatedLines.length > 0 && (
                <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                        <thead>
                            <tr className="border-b text-left text-gray-500 text-xs uppercase tracking-wide">
                                <th className="pb-2 pr-3 font-medium">Date</th>
                                <th className="pb-2 pr-3 font-medium">Order #</th>
                                <th className="pb-2 pr-3 font-medium">Customer</th>
                                <th className="pb-2 pr-3 font-medium">SKU</th>
                                <th className="pb-2 pr-3 font-medium">Item</th>
                                <th className="pb-2 pr-3 font-medium text-center">Qty</th>
                                <th className="pb-2 pr-3 font-medium text-center w-16">Picked</th>
                            </tr>
                        </thead>
                        <tbody>
                            {allocatedLines.map((line) => {
                                const isPicked = line.lineStatus === 'picked';
                                const isToggling = pickingLines.has(line.id);

                                return (
                                    <tr
                                        key={line.id}
                                        className={`border-b border-gray-100 ${isPicked ? 'bg-green-50' : 'hover:bg-gray-50'}`}
                                    >
                                        <td className="py-2 pr-3 text-gray-600">{formatDate(line.orderDate)}</td>
                                        <td className="py-2 pr-3 font-mono text-xs text-gray-600">{line.orderNumber}</td>
                                        <td className="py-2 pr-3 text-gray-900">{line.customerName}</td>
                                        <td className="py-2 pr-3 font-mono text-xs text-gray-500">{line.sku?.skuCode}</td>
                                        <td className="py-2 pr-3 text-gray-700">
                                            {line.sku?.variation?.product?.name} - {line.sku?.variation?.colorName} - {line.sku?.size}
                                        </td>
                                        <td className="py-2 pr-3 text-center">{line.qty}</td>
                                        <td className="py-2 pr-3 text-center">
                                            <button
                                                onClick={() => isPicked ? unpickLine.mutate(line.id) : pickLine.mutate(line.id)}
                                                disabled={isToggling}
                                                className={`w-6 h-6 rounded flex items-center justify-center transition-colors ${
                                                    isPicked
                                                        ? 'bg-green-500 text-white hover:bg-green-600'
                                                        : 'border-2 border-gray-300 hover:border-green-400 hover:bg-green-50'
                                                }`}
                                            >
                                                {isToggling ? (
                                                    <span className="animate-spin text-xs">...</span>
                                                ) : isPicked ? (
                                                    <Check size={14} />
                                                ) : null}
                                            </button>
                                        </td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                </div>
            )}
        </div>
    );
}
