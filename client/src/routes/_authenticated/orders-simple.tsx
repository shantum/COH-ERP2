import { createFileRoute } from '@tanstack/react-router';
import { OrdersSimplePage } from '../../pages/OrdersSimple';

export const Route = createFileRoute('/_authenticated/orders-simple')({
    component: OrdersSimplePage,
});
