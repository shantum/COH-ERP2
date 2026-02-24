/**
 * Edit Product Route - /products/$productSlug/edit
 *
 * Slug format: "the-chino-shorts--1950fd4a-606e-4dbb-b716-1979f3b30931"
 * Human-readable name + "--" separator + UUID for lookup.
 */
import { createFileRoute } from '@tanstack/react-router';
import EditProduct from '../../../../pages/EditProduct';

export const Route = createFileRoute('/_authenticated/products_/$productSlug/edit')({
    component: EditProduct,
});
