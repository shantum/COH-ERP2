/**
 * NewOrder page - Full-page order creation form
 */

import { useQuery } from '@tanstack/react-query';
import { useServerFn } from '@tanstack/react-start';
import { useNavigate } from '@tanstack/react-router';
import { ArrowLeft, ShoppingCart } from 'lucide-react';
import { getChannels } from '../server/functions/admin';
import { useOrderCrudMutations } from '../hooks/orders/useOrderCrudMutations';
import { CreateOrderForm } from '../components/orders/CreateOrderForm';
import { Button } from '@/components/ui/button';
import { showSuccess } from '../utils/toast';

export default function NewOrder() {
    const navigate = useNavigate();

    // Fetch channels
    const getChannelsFn = useServerFn(getChannels);
    const { data: channels = [] } = useQuery({
        queryKey: ['orderChannels'],
        queryFn: async () => {
            const result = await getChannelsFn();
            if (!result.success) {
                throw new Error(result.error?.message || 'Failed to fetch channels');
            }
            return result.data;
        },
        staleTime: 300000,
    });

    // Create order mutation
    const { createOrder } = useOrderCrudMutations({
        onCreateSuccess: () => {
            showSuccess('Order created');
            navigate({ to: '/orders', search: { view: 'open', page: 1, limit: 250 } });
        },
    });

    return (
        <div className="max-w-lg mx-auto">
            {/* Header */}
            <div className="flex items-center gap-3 mb-6">
                <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => navigate({ to: '/orders', search: { view: 'open', page: 1, limit: 250 } })}
                    className="h-8 px-2"
                >
                    <ArrowLeft className="h-4 w-4" />
                </Button>
                <div>
                    <h1 className="text-lg font-semibold flex items-center gap-2">
                        <ShoppingCart className="h-5 w-5" />
                        New Order
                    </h1>
                    <p className="text-sm text-muted-foreground">Create a manual or exchange order</p>
                </div>
            </div>

            {/* Form */}
            <div className="border rounded-lg bg-card">
                <CreateOrderForm
                    channels={channels || []}
                    onCreate={(data) => createOrder.mutate(data)}
                    isCreating={createOrder.isPending}
                    onCancel={() => navigate({ to: '/orders', search: { view: 'open', page: 1, limit: 250 } })}
                    fullPage
                />
            </div>
        </div>
    );
}
