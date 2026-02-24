/**
 * EditProduct Page
 *
 * Full-page editor for an existing product with its variations and SKUs.
 * Replaces the broken UnifiedProductEditModal dialog-stack approach.
 *
 * Structure:
 *   - Product Details Card (useProductEditForm)
 *   - Variation Cards (useVariationEditForm each)
 *     - Collapsible SKU table with inline editable rows (useSkuEditForm)
 */

import { useState, useMemo } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { useServerFn } from '@tanstack/react-start';
import { Route } from '../routes/_authenticated/products_/$productSlug/edit';
import { useProductEditForm } from '../components/products/unified-edit/hooks/useProductEditForm';
import { useVariationEditForm } from '../components/products/unified-edit/hooks/useVariationEditForm';
import { useSkuEditForm } from '../components/products/unified-edit/hooks/useSkuEditForm';
import { getCatalogFilters } from '../server/functions/products';
import type { ProductDetailData, VariationDetailData, SkuDetailData } from '../components/products/unified-edit/types';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select';
import {
    ArrowLeft,
    Loader2,
    Save,
    Undo2,
    ChevronDown,
    ChevronRight,
    Check,
    X,
} from 'lucide-react';

// ─── Main Page ───────────────────────────────────────────────

/** Extract UUID from slug: "the-chino-shorts--1950fd4a-606e-..." → "1950fd4a-606e-..." */
function extractProductId(slug: string): string {
    const sepIdx = slug.indexOf('--');
    return sepIdx !== -1 ? slug.slice(sepIdx + 2) : slug;
}

/** Build slug from product name + UUID: "The Chino Shorts" + id → "the-chino-shorts--1950fd4a-..." */
export function buildProductSlug(name: string, id: string): string {
    const nameSlug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    return `${nameSlug}--${id}`;
}

export default function EditProduct() {
    const { productSlug } = Route.useParams();
    const productId = extractProductId(productSlug);
    const navigate = useNavigate();

    const {
        form,
        product,
        isLoading,
        isSaving,
        isDirty,
        handleSubmit,
        reset,
    } = useProductEditForm({
        productId,
        onSuccess: () => {
            // Form auto-resets via react-query refetch
        },
    });

    // Fetch catalog filters for category/gender dropdowns
    const getCatalogFiltersFn = useServerFn(getCatalogFilters);
    const { data: catalogFilters } = useQuery({
        queryKey: ['products', 'catalogFilters'],
        queryFn: () => getCatalogFiltersFn(),
    });

    // Build dropdown options from DB values, always including the current value
    const categoryOptions = useMemo(() => {
        const currentVal = form.watch('category');
        const dbCategories = catalogFilters?.categories ?? [];
        const set = new Set(dbCategories);
        if (currentVal && !set.has(currentVal)) set.add(currentVal);
        return Array.from(set).sort((a, b) => a.localeCompare(b));
    }, [catalogFilters?.categories, form.watch('category')]);

    const genderOptions = useMemo(() => {
        const currentVal = form.watch('gender');
        const dbGenders = catalogFilters?.genders ?? [];
        const set = new Set(dbGenders);
        if (currentVal && !set.has(currentVal)) set.add(currentVal);
        return Array.from(set).sort((a, b) => a.localeCompare(b));
    }, [catalogFilters?.genders, form.watch('gender')]);

    if (isLoading) {
        return (
            <div className="flex items-center justify-center h-64">
                <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
        );
    }

    if (!product) {
        return (
            <div className="max-w-4xl mx-auto p-6">
                <p className="text-muted-foreground">Product not found.</p>
                <Button variant="ghost" className="mt-4" onClick={() => navigate({ to: '/products', search: { tab: 'products', view: 'tree' } })}>
                    <ArrowLeft className="mr-2 h-4 w-4" /> Back to Products
                </Button>
            </div>
        );
    }

    return (
        <div className="max-w-4xl mx-auto p-6 space-y-6">
            {/* Header */}
            <div className="flex items-center gap-3">
                <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => navigate({ to: '/products', search: { tab: 'products', view: 'tree' } })}
                >
                    <ArrowLeft className="h-4 w-4 mr-1" />
                    Products
                </Button>
                <div className="h-4 w-px bg-border" />
                <h1 className="text-xl font-semibold">
                    Edit: {product.name}
                </h1>
                {!product.isActive && (
                    <Badge variant="secondary">Inactive</Badge>
                )}
            </div>

            {/* Product Details Card */}
            <Card>
                <CardHeader className="pb-4">
                    <div className="flex items-center justify-between">
                        <CardTitle className="text-base">Product Details</CardTitle>
                        {isDirty && (
                            <div className="flex items-center gap-2">
                                <Button
                                    variant="ghost"
                                    size="sm"
                                    onClick={reset}
                                    disabled={isSaving}
                                >
                                    <Undo2 className="h-3.5 w-3.5 mr-1" />
                                    Discard
                                </Button>
                                <Button
                                    size="sm"
                                    onClick={handleSubmit}
                                    disabled={isSaving}
                                >
                                    {isSaving ? (
                                        <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />
                                    ) : (
                                        <Save className="h-3.5 w-3.5 mr-1" />
                                    )}
                                    Save
                                </Button>
                            </div>
                        )}
                    </div>
                </CardHeader>
                <CardContent>
                    <div className="grid grid-cols-2 gap-4">
                        {/* Name */}
                        <div className="col-span-2 sm:col-span-1">
                            <Label htmlFor="name">Name</Label>
                            <Input
                                id="name"
                                {...form.register('name')}
                            />
                        </div>

                        {/* Style Code */}
                        <div>
                            <Label htmlFor="styleCode">Style Code</Label>
                            <Input
                                id="styleCode"
                                {...form.register('styleCode')}
                            />
                        </div>

                        {/* Category */}
                        <div>
                            <Label>Category</Label>
                            <Select
                                value={form.watch('category')}
                                onValueChange={(v) => form.setValue('category', v, { shouldDirty: true })}
                            >
                                <SelectTrigger>
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                    {categoryOptions.map(c => (
                                        <SelectItem key={c} value={c}>{c}</SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>

                        {/* Gender */}
                        <div>
                            <Label>Gender</Label>
                            <Select
                                value={form.watch('gender')}
                                onValueChange={(v) => form.setValue('gender', v, { shouldDirty: true })}
                            >
                                <SelectTrigger>
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                    {genderOptions.map(g => (
                                        <SelectItem key={g} value={g}>{g}</SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>

                        {/* Default Fabric Consumption */}
                        <div>
                            <Label htmlFor="defaultFabricConsumption">Fabric Consumption (m)</Label>
                            <Input
                                id="defaultFabricConsumption"
                                type="number"
                                step="0.01"
                                {...form.register('defaultFabricConsumption', { valueAsNumber: true })}
                            />
                        </div>

                        {/* Active Toggle */}
                        <div className="flex items-center gap-3 pt-5">
                            <Switch
                                checked={form.watch('isActive')}
                                onCheckedChange={(v: boolean) => form.setValue('isActive', v, { shouldDirty: true })}
                            />
                            <Label>Active</Label>
                        </div>
                    </div>
                </CardContent>
            </Card>

            {/* Variations Section */}
            <div className="space-y-4">
                <h2 className="text-lg font-semibold">
                    Variations ({product.variations.length})
                </h2>
                {product.variations.map(variation => (
                    <VariationCard
                        key={variation.id}
                        variation={variation}
                        product={product}
                    />
                ))}
            </div>
        </div>
    );
}

// ─── Variation Card ──────────────────────────────────────────

function VariationCard({
    variation,
    product,
}: {
    variation: VariationDetailData;
    product: ProductDetailData;
}) {
    const [showSkus, setShowSkus] = useState(false);

    const {
        form,
        isSaving,
        isDirty,
        handleSubmit,
        reset,
    } = useVariationEditForm({
        variation,
        product,
    });

    return (
        <Card>
            <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                        {/* Color swatch */}
                        {variation.colorHex && (
                            <span
                                className="w-5 h-5 rounded-full border border-gray-300 flex-shrink-0"
                                style={{ backgroundColor: variation.colorHex }}
                            />
                        )}
                        <CardTitle className="text-sm font-medium">
                            {variation.colorName}
                        </CardTitle>
                        {!variation.isActive && (
                            <Badge variant="secondary" className="text-xs">Inactive</Badge>
                        )}
                        {variation.fabricColourName && (
                            <span className="text-xs text-muted-foreground">
                                {variation.materialName} / {variation.fabricName} / {variation.fabricColourName}
                            </span>
                        )}
                        {variation.bomCost != null && (
                            <Badge variant="outline" className="text-xs">
                                BOM: {variation.bomCost.toFixed(0)}
                            </Badge>
                        )}
                    </div>
                    <div className="flex items-center gap-2">
                        {isDirty && (
                            <>
                                <Button variant="ghost" size="sm" onClick={reset} disabled={isSaving}>
                                    <Undo2 className="h-3.5 w-3.5 mr-1" /> Discard
                                </Button>
                                <Button size="sm" onClick={handleSubmit} disabled={isSaving}>
                                    {isSaving ? (
                                        <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />
                                    ) : (
                                        <Save className="h-3.5 w-3.5 mr-1" />
                                    )}
                                    Save
                                </Button>
                            </>
                        )}
                        <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => setShowSkus(!showSkus)}
                        >
                            {showSkus ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                            <span className="ml-1 text-xs">{variation.skus.length} SKUs</span>
                        </Button>
                    </div>
                </div>
            </CardHeader>
            <CardContent className="pt-0">
                {/* Editable variation fields */}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                    <div>
                        <Label className="text-xs">Color Name</Label>
                        <Input
                            className="h-8 text-sm"
                            {...form.register('colorName')}
                        />
                    </div>
                    <div>
                        <Label className="text-xs">Color Hex</Label>
                        <div className="flex items-center gap-2">
                            <Input
                                className="h-8 text-sm flex-1"
                                {...form.register('colorHex')}
                                placeholder="#000000"
                            />
                            {form.watch('colorHex') && (
                                <span
                                    className="w-6 h-6 rounded border border-gray-300 flex-shrink-0"
                                    style={{ backgroundColor: form.watch('colorHex') || undefined }}
                                />
                            )}
                        </div>
                    </div>
                    <div className="flex items-center gap-2 pt-4">
                        <Switch
                            checked={form.watch('hasLining')}
                            onCheckedChange={(v: boolean) => form.setValue('hasLining', v, { shouldDirty: true })}
                        />
                        <Label className="text-xs">Has Lining</Label>
                    </div>
                    <div className="flex items-center gap-2 pt-4">
                        <Switch
                            checked={form.watch('isActive')}
                            onCheckedChange={(v: boolean) => form.setValue('isActive', v, { shouldDirty: true })}
                        />
                        <Label className="text-xs">Active</Label>
                    </div>
                </div>

                {/* Collapsible SKU table */}
                {showSkus && (
                    <div className="mt-4 border rounded-md overflow-hidden">
                        <table className="w-full text-sm">
                            <thead className="bg-muted/50">
                                <tr>
                                    <th className="text-left px-3 py-2 font-medium text-xs">SKU Code</th>
                                    <th className="text-left px-3 py-2 font-medium text-xs">Size</th>
                                    <th className="text-right px-3 py-2 font-medium text-xs">MRP</th>
                                    <th className="text-right px-3 py-2 font-medium text-xs">Target Qty</th>
                                    <th className="text-right px-3 py-2 font-medium text-xs">BOM Cost</th>
                                    <th className="text-right px-3 py-2 font-medium text-xs">Balance</th>
                                    <th className="text-right px-3 py-2 font-medium text-xs w-20">Actions</th>
                                </tr>
                            </thead>
                            <tbody>
                                {variation.skus.map(sku => (
                                    <SkuRow
                                        key={sku.id}
                                        sku={sku}
                                        variation={variation}
                                        product={product}
                                    />
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
            </CardContent>
        </Card>
    );
}

// ─── SKU Row (inline editable) ───────────────────────────────

function SkuRow({
    sku,
    variation,
    product,
}: {
    sku: SkuDetailData;
    variation: VariationDetailData;
    product: ProductDetailData;
}) {
    const {
        form,
        isSaving,
        isDirty,
        handleSubmit,
        reset,
    } = useSkuEditForm({ sku, variation, product });

    return (
        <tr className="border-t hover:bg-muted/30">
            <td className="px-3 py-1.5 font-mono text-xs text-muted-foreground">
                {sku.skuCode}
            </td>
            <td className="px-3 py-1.5 text-xs">{sku.size}</td>
            <td className="px-3 py-1.5 text-right">
                <Input
                    type="number"
                    className="h-7 w-20 text-xs text-right ml-auto"
                    {...form.register('mrp', { valueAsNumber: true })}
                />
            </td>
            <td className="px-3 py-1.5 text-right">
                <Input
                    type="number"
                    className="h-7 w-20 text-xs text-right ml-auto"
                    {...form.register('targetStockQty', { valueAsNumber: true })}
                />
            </td>
            <td className="px-3 py-1.5 text-right text-xs text-muted-foreground">
                {sku.bomCost != null ? `${sku.bomCost.toFixed(0)}` : '—'}
            </td>
            <td className="px-3 py-1.5 text-right text-xs">
                {sku.currentBalance}
            </td>
            <td className="px-3 py-1.5 text-right">
                {isDirty && (
                    <div className="flex items-center justify-end gap-1">
                        <Button
                            variant="ghost"
                            size="icon"
                            className="h-6 w-6"
                            onClick={reset}
                            disabled={isSaving}
                        >
                            <X className="h-3 w-3" />
                        </Button>
                        <Button
                            variant="ghost"
                            size="icon"
                            className="h-6 w-6 text-green-600"
                            onClick={handleSubmit}
                            disabled={isSaving}
                        >
                            {isSaving ? (
                                <Loader2 className="h-3 w-3 animate-spin" />
                            ) : (
                                <Check className="h-3 w-3" />
                            )}
                        </Button>
                    </div>
                )}
            </td>
        </tr>
    );
}
