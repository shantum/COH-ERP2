/**
 * Order ship mutations
 * Handles shipping orders and line-level shipping operations
 */

import { useMutation } from '@tanstack/react-query';
import { ordersApi } from '../../services/api';
import { trpc } from '../../services/trpc';
import { useOrderInvalidation } from './orderMutationUtils';

export interface UseOrderShipMutationsOptions {
    onShipSuccess?: () => void;
}

export function useOrderShipMutations(options: UseOrderShipMutationsOptions = {}) {
    const { invalidateOpenOrders, invalidateShippedOrders } = useOrderInvalidation();

    const ship = useMutation({
        mutationFn: ({ id, data }: { id: string; data: { awbNumber: string; courier: string } }) =>
            ordersApi.ship(id, data),
        onSuccess: () => {
            invalidateOpenOrders();
            invalidateShippedOrders();
            options.onShipSuccess?.();
        },
        onError: (err: any) => {
            const errorData = err.response?.data;
            if (errorData?.details && Array.isArray(errorData.details)) {
                const messages = errorData.details.map((d: any) => d.message).join('\n');
                alert(`Validation failed:\n${messages}`);
            } else {
                alert(errorData?.error || 'Failed to ship order');
            }
        }
    });

    const shipLines = trpc.orders.ship.useMutation({
        onSuccess: () => {
            invalidateOpenOrders();
            invalidateShippedOrders();
            options.onShipSuccess?.();
        },
        onError: (err) => {
            const errorMsg = err.message || '';
            if (errorMsg.includes('not packed')) {
                alert(`Cannot ship: Some lines are not packed yet`);
            } else if (errorMsg.includes('validation')) {
                alert(`Validation failed: ${errorMsg}`);
            } else {
                alert(errorMsg || 'Failed to ship lines');
            }
        }
    });

    const forceShip = useMutation({
        mutationFn: ({ id, data }: { id: string; data: { awbNumber: string; courier: string } }) =>
            ordersApi.forceShip(id, data),
        onSuccess: () => {
            invalidateOpenOrders();
            invalidateShippedOrders();
            options.onShipSuccess?.();
        },
        onError: (err: any) => {
            alert(err.response?.data?.error || 'Failed to force ship order');
        }
    });

    const unship = useMutation({
        mutationFn: (id: string) => ordersApi.unship(id),
        onSuccess: () => {
            invalidateOpenOrders();
            invalidateShippedOrders();
        },
        onError: (err: any) => alert(err.response?.data?.error || 'Failed to unship order')
    });

    const markShippedLine = useMutation({
        mutationFn: ({ lineId, data }: { lineId: string; data?: { awbNumber?: string; courier?: string } }) =>
            ordersApi.setLineStatus(lineId, 'shipped', data),
        onSuccess: () => {
            invalidateOpenOrders();
            invalidateShippedOrders();
        },
        onError: (err: any) => {
            alert(err.response?.data?.error || 'Failed to ship line');
        }
    });

    const unmarkShippedLine = useMutation({
        mutationFn: (lineId: string) => ordersApi.setLineStatus(lineId, 'packed'),
        onSuccess: () => {
            invalidateOpenOrders();
            invalidateShippedOrders();
        },
        onError: (err: any) => {
            alert(err.response?.data?.error || 'Failed to unship line');
        }
    });

    const updateLineTracking = useMutation({
        mutationFn: ({ lineId, data }: { lineId: string; data: { awbNumber?: string; courier?: string } }) =>
            ordersApi.updateLine(lineId, data),
        onSuccess: () => {
            invalidateOpenOrders();
            invalidateShippedOrders();
        },
        onError: (err: any) => {
            console.error('Tracking update failed:', err.response?.data?.error || err.message);
        }
    });

    return {
        ship,
        shipLines,
        forceShip,
        unship,
        markShippedLine,
        unmarkShippedLine,
        updateLineTracking,
    };
}
