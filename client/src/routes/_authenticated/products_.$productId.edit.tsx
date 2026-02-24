/**
 * Edit Product Route - /products/$productId/edit
 *
 * Full-page form for editing an existing product with variations and SKUs.
 * Uses pathless layout escape (products_) to avoid nesting under the products layout.
 */
import { createFileRoute } from '@tanstack/react-router';
import EditProduct from '../../pages/EditProduct';

export const Route = createFileRoute('/_authenticated/products_/$productId/edit')({
    component: EditProduct,
});
