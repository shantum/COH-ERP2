/**
 * New Product Route - /products/new
 *
 * Full-page form for creating a new product with variations and auto-generated SKUs.
 * Uses pathless layout escape (products_) to avoid nesting under the products layout.
 */
import { createFileRoute, redirect } from '@tanstack/react-router';
import NewProduct from '../../pages/NewProduct';
import { isAdminUser, type AuthUser } from '../../types';

export const Route = createFileRoute('/_authenticated/products_/new')({
    beforeLoad: ({ context }) => {
        if (!isAdminUser((context as { user?: AuthUser }).user)) {
            throw redirect({ to: '/' });
        }
    },
    component: NewProduct,
});
