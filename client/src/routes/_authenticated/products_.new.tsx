/**
 * New Product Route - /products/new
 *
 * Full-page form for creating a new product with variations and auto-generated SKUs.
 * Uses pathless layout escape (products_) to avoid nesting under the products layout.
 */
import { createFileRoute } from '@tanstack/react-router';
import NewProduct from '../../pages/NewProduct';

export const Route = createFileRoute('/_authenticated/products_/new')({
    component: NewProduct,
});
