/**
 * Edit Product Route - /products/$productSlug/edit
 *
 * Slug format: "the-chino-shorts--1950fd4a-606e-4dbb-b716-1979f3b30931"
 * Human-readable name + "--" separator + UUID for lookup.
 */
import { createFileRoute, redirect } from '@tanstack/react-router';
import EditProduct from '../../../../pages/EditProduct';
import { isAdminUser, type AuthUser } from '../../../../types';

export const Route = createFileRoute('/_authenticated/products_/$productSlug/edit')({
    beforeLoad: ({ context }) => {
        if (!isAdminUser((context as { user?: AuthUser }).user)) {
            throw redirect({ to: '/' });
        }
    },
    component: EditProduct,
});
