/**
 * EditProduct Page
 *
 * Comprehensive product detail + edit page.
 * Shows all available product data: image, attributes, measurements, variations, SKUs.
 *
 * Structure:
 *   - Header (name, status, style code)
 *   - Overview Card (image + metadata + attributes)
 *   - Editable Details Card
 *   - Size Guide (from StyleMeasurement)
 *   - Variation Cards (with images, fabric, BOM, SKUs)
 */

import { useState, useMemo, useCallback } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useServerFn } from '@tanstack/react-start';
import { Route } from '../routes/_authenticated/products_/$productSlug/edit';
import { useProductEditForm } from '../components/products/unified-edit/hooks/useProductEditForm';
import { useVariationEditForm } from '../components/products/unified-edit/hooks/useVariationEditForm';
import { useSkuEditForm } from '../components/products/unified-edit/hooks/useSkuEditForm';
import { getCatalogFilters } from '../server/functions/products';
import { updateProduct } from '../server/functions/productsMutations';
import { getResolvedBomForVariation, type ResolvedBomLine } from '../server/functions/bomQueries';
import type { ProductDetailData, VariationDetailData, SkuDetailData, MeasurementData, ShopifyProductData } from '../components/products/unified-edit/types';
import { GARMENT_GROUP_LABELS, getGoogleCategoryPath, type GarmentGroup } from '@coh/shared/config/productTaxonomy';
import { SIZE_ORDER } from '@coh/shared/config/product';

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
    Pencil,
    Ruler,
    ImageIcon,
    ExternalLink,
    History,
    Search,
    Globe,
} from 'lucide-react';

// ─── Attribute Labels ───────────────────────────────────────

const ATTRIBUTE_LABELS: Record<string, Record<string, string>> = {
    constructionType: { knit: 'Knit', woven: 'Woven' },
    fit: { slim: 'Slim Fit', regular: 'Regular Fit', relaxed: 'Relaxed Fit', oversized: 'Oversized' },
    sleeveType: { sleeveless: 'Sleeveless', 'short-sleeve': 'Short Sleeve', 'three-quarter': '3/4 Sleeve', 'long-sleeve': 'Long Sleeve' },
    neckline: { crew: 'Crew Neck', 'v-neck': 'V-Neck', polo: 'Polo', henley: 'Henley', collar: 'Collar', 'band-collar': 'Band Collar', 'notched-collar': 'Notched Collar', hoodie: 'Hoodie', scoop: 'Scoop Neck', square: 'Square Neck' },
    closure: { pullover: 'Pullover', 'button-front': 'Button Front', 'half-button': 'Half Button', zip: 'Zip', elastic: 'Elastic Waist', drawstring: 'Drawstring', wrap: 'Wrap' },
    garmentLength: { cropped: 'Cropped', regular: 'Regular Length', midi: 'Midi', maxi: 'Maxi' },
};

function getAttributeLabel(key: string, value: string): string {
    return ATTRIBUTE_LABELS[key]?.[value] ?? value;
}

// ─── Helpers ────────────────────────────────────────────────

/** Extract UUID from slug: "the-chino-shorts--1950fd4a-606e-..." → "1950fd4a-606e-..." */
function extractProductId(slug: string): string {
    const sepIdx = slug.indexOf('--');
    return sepIdx !== -1 ? slug.slice(sepIdx + 2) : slug;
}

/** Build slug from product name + UUID */
export function buildProductSlug(name: string, id: string): string {
    const nameSlug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    return `${nameSlug}--${id}`;
}

function capitalize(s: string): string {
    return s.charAt(0).toUpperCase() + s.slice(1);
}

// ─── ERP Description Card with Version History ─────────────

function ErpDescriptionCard({ description, history }: {
    description: string;
    history: Array<{version: number; text: string; createdAt: string; source: string}> | null;
}) {
    const [showHistory, setShowHistory] = useState(false);
    const currentVersion = history?.length ?? 1;

    return (
        <Card>
            <CardHeader className="pb-2">
                <div className="flex items-center justify-between">
                    <CardTitle className="text-base">ERP Description</CardTitle>
                    <div className="flex items-center gap-2">
                        <Badge variant="secondary" className="text-xs font-normal">
                            v{currentVersion}
                        </Badge>
                        {history && history.length > 1 && (
                            <button
                                onClick={() => setShowHistory(!showHistory)}
                                className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
                            >
                                <History className="h-3 w-3" />
                                {showHistory ? 'Hide' : 'History'}
                            </button>
                        )}
                    </div>
                </div>
            </CardHeader>
            <CardContent className="space-y-3">
                <p className="text-sm leading-relaxed">{description}</p>

                {showHistory && history && history.length > 1 && (
                    <div className="border-t pt-3 space-y-3">
                        <p className="text-xs font-medium text-muted-foreground">Previous Versions</p>
                        {history
                            .slice()
                            .sort((a, b) => b.version - a.version)
                            .slice(1)
                            .map((entry) => (
                                <div key={entry.version} className="rounded-md bg-muted/50 p-3 space-y-1">
                                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                                        <span className="font-medium">v{entry.version}</span>
                                        <span>&middot;</span>
                                        <span>{new Date(entry.createdAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}</span>
                                        <span>&middot;</span>
                                        <span>{entry.source}</span>
                                    </div>
                                    <p className="text-sm leading-relaxed text-muted-foreground">
                                        {entry.text}
                                    </p>
                                </div>
                            ))
                        }
                    </div>
                )}
            </CardContent>
        </Card>
    );
}

// ─── SEO Card with Google Preview ───────────────────────────

function SeoCard({ productId, seoTitle, seoDescription, shopifyHandle }: {
    productId: string;
    seoTitle: string | null;
    seoDescription: string | null;
    shopifyHandle: string | null;
}) {
    const queryClient = useQueryClient();
    const updateProductFn = useServerFn(updateProduct);
    const [isEditing, setIsEditing] = useState(false);
    const [title, setTitle] = useState(seoTitle ?? '');
    const [description, setDescription] = useState(seoDescription ?? '');

    const saveMutation = useMutation({
        mutationFn: async () => {
            const result = await updateProductFn({
                data: {
                    id: productId,
                    erpSeoTitle: title || null,
                    erpSeoDescription: description || null,
                },
            });
            if (!result.success) throw new Error(result.error?.message ?? 'Failed to save');
            return result.data;
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['product', productId] });
            setIsEditing(false);
        },
    });

    const handleCancel = useCallback(() => {
        setTitle(seoTitle ?? '');
        setDescription(seoDescription ?? '');
        setIsEditing(false);
    }, [seoTitle, seoDescription]);

    const titleLen = title.length;
    const descLen = description.length;
    const previewUrl = shopifyHandle
        ? `www.creaturesofhabit.in › products › ${shopifyHandle}`
        : 'www.creaturesofhabit.in › products › ...';

    return (
        <Card>
            <CardHeader className="pb-2">
                <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                        <Globe className="h-4 w-4 text-muted-foreground" />
                        <CardTitle className="text-base">SEO</CardTitle>
                    </div>
                    {!isEditing ? (
                        <Button variant="ghost" size="sm" onClick={() => setIsEditing(true)}>
                            <Pencil className="h-3.5 w-3.5 mr-1" /> Edit
                        </Button>
                    ) : (
                        <div className="flex items-center gap-2">
                            <Button variant="ghost" size="sm" onClick={handleCancel} disabled={saveMutation.isPending}>
                                Cancel
                            </Button>
                            <Button size="sm" onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending}>
                                {saveMutation.isPending ? (
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
            <CardContent className="space-y-4">
                {isEditing ? (
                    <>
                        <div>
                            <div className="flex items-center justify-between mb-1">
                                <Label htmlFor="seoTitle" className="text-xs">Meta Title</Label>
                                <span className={`text-xs ${titleLen > 60 ? 'text-red-500 font-medium' : titleLen > 50 ? 'text-amber-500' : 'text-muted-foreground'}`}>
                                    {titleLen}/60
                                </span>
                            </div>
                            <Input
                                id="seoTitle"
                                value={title}
                                onChange={(e) => setTitle(e.target.value)}
                                placeholder="e.g. Organic Cotton T-Shirt - Relaxed Fit | Creatures of Habit"
                                className="text-sm"
                            />
                        </div>
                        <div>
                            <div className="flex items-center justify-between mb-1">
                                <Label htmlFor="seoDesc" className="text-xs">Meta Description</Label>
                                <span className={`text-xs ${descLen > 160 ? 'text-red-500 font-medium' : descLen > 140 ? 'text-amber-500' : 'text-muted-foreground'}`}>
                                    {descLen}/160
                                </span>
                            </div>
                            <textarea
                                id="seoDesc"
                                value={description}
                                onChange={(e) => setDescription(e.target.value)}
                                placeholder="e.g. Handcrafted organic cotton tee in a relaxed fit. Made sustainably in Goa. Shop conscious everyday wear."
                                rows={3}
                                className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                            />
                        </div>
                    </>
                ) : (
                    !title && !description ? (
                        <p className="text-sm text-muted-foreground italic">No SEO metadata set yet. Click Edit to add.</p>
                    ) : null
                )}

                {/* Google Preview */}
                {(title || description) && (
                    <div className="rounded-lg border bg-white p-4 space-y-1">
                        <p className="text-xs text-muted-foreground mb-2 flex items-center gap-1">
                            <Search className="h-3 w-3" /> Google Preview
                        </p>
                        <p className="text-xs text-green-700 truncate">{previewUrl}</p>
                        <p className="text-[#1a0dab] text-base leading-snug hover:underline cursor-default truncate">
                            {title || 'No title set'}
                        </p>
                        <p className="text-xs text-[#545454] leading-relaxed line-clamp-2">
                            {description || 'No description set'}
                        </p>
                    </div>
                )}
            </CardContent>
        </Card>
    );
}

// ─── Main Page ──────────────────────────────────────────────

export default function EditProduct() {
    const { productSlug } = Route.useParams();
    const productId = extractProductId(productSlug);
    const navigate = useNavigate();
    const [showEditForm, setShowEditForm] = useState(false);

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
        onSuccess: () => { /* Form auto-resets via react-query refetch */ },
    });

    // Fetch catalog filters for category/gender dropdowns
    const getCatalogFiltersFn = useServerFn(getCatalogFilters);
    const { data: catalogFilters } = useQuery({
        queryKey: ['products', 'catalogFilters'],
        queryFn: () => getCatalogFiltersFn(),
    });

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
            <div className="max-w-6xl mx-auto p-6">
                <p className="text-muted-foreground">Product not found.</p>
                <Button variant="ghost" className="mt-4" onClick={() => navigate({ to: '/products', search: { tab: 'products', view: 'tree' } })}>
                    <ArrowLeft className="mr-2 h-4 w-4" /> Back to Products
                </Button>
            </div>
        );
    }

    const attrs = product.attributes;
    const totalStock = product.variations.reduce(
        (sum, v) => sum + v.skus.reduce((s, sk) => s + sk.currentBalance, 0),
        0
    );
    const totalSkus = product.variations.reduce((sum, v) => sum + v.skus.length, 0);

    return (
        <div className="max-w-6xl mx-auto p-6 space-y-6">
            {/* ── Header ── */}
            <div className="flex items-center justify-between">
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
                    <h1 className="text-xl font-semibold">{product.name}</h1>
                    <Badge variant={product.isActive ? 'default' : 'secondary'}>
                        {product.isActive ? 'Active' : 'Inactive'}
                    </Badge>
                    {product.styleCode && (
                        <Badge variant="outline" className="font-mono text-xs">
                            {product.styleCode}
                        </Badge>
                    )}
                </div>
                <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setShowEditForm(!showEditForm)}
                >
                    <Pencil className="h-3.5 w-3.5 mr-1" />
                    Edit
                </Button>
            </div>

            {/* ── Two-column layout: Main + Shopify Sidebar ── */}
            <div className="grid grid-cols-1 lg:grid-cols-[1fr_280px] gap-6">
                {/* ── Left Column: Main Content ── */}
                <div className="space-y-6 min-w-0">
                    {/* Overview Card */}
                    <Card>
                        <CardContent className="pt-6">
                            <div className="flex gap-6">
                                {/* Product Image */}
                                <div className="flex-shrink-0">
                                    {product.imageUrl ? (
                                        <img
                                            src={product.imageUrl}
                                            alt={product.name}
                                            className="w-48 h-48 rounded-lg object-cover border bg-muted"
                                            loading="lazy"
                                        />
                                    ) : (
                                        <div className="w-48 h-48 rounded-lg border bg-muted flex items-center justify-center">
                                            <ImageIcon className="h-12 w-12 text-muted-foreground/30" />
                                        </div>
                                    )}
                                </div>

                                {/* Product Metadata */}
                                <div className="flex-1 min-w-0">
                                    <div className="grid grid-cols-2 gap-x-8 gap-y-2 text-sm">
                                        <MetadataRow label="Category" value={capitalize(product.category)} />
                                        <MetadataRow
                                            label="Garment Group"
                                            value={GARMENT_GROUP_LABELS[product.garmentGroup as GarmentGroup] ?? product.garmentGroup}
                                        />
                                        <MetadataRow label="Gender" value={capitalize(product.gender)} />
                                        {product.googleProductCategoryId && (
                                            <MetadataRow
                                                label="Google Category"
                                                value={getGoogleCategoryPath(product.googleProductCategoryId)}
                                            />
                                        )}
                                        {product.hsnCode && (
                                            <MetadataRow label="HSN Code" value={product.hsnCode} />
                                        )}
                                        {product.defaultFabricConsumption != null && (
                                            <MetadataRow label="Fabric Consumption" value={`${product.defaultFabricConsumption} m`} />
                                        )}
                                        <MetadataRow
                                            label="Variations / SKUs / Stock"
                                            value={`${product.variations.length} / ${totalSkus} / ${totalStock}`}
                                        />
                                        {!product.isReturnable && (
                                            <MetadataRow label="Returnable" value="No" />
                                        )}
                                        {(product.returnCount > 0 || product.exchangeCount > 0) && (
                                            <MetadataRow
                                                label="Returns / Exchanges"
                                                value={`${product.returnCount} / ${product.exchangeCount}`}
                                            />
                                        )}
                                    </div>

                                    {/* Attributes as pills */}
                                    {attrs && Object.keys(attrs).length > 0 && (
                                        <div className="mt-4">
                                            <div className="flex flex-wrap gap-1.5">
                                                {(['constructionType', 'fit', 'neckline', 'sleeveType', 'closure', 'garmentLength'] as const).map(key => {
                                                    const val = attrs[key];
                                                    if (!val || typeof val !== 'string') return null;
                                                    return (
                                                        <Badge key={key} variant="secondary" className="text-xs font-normal">
                                                            {getAttributeLabel(key, val)}
                                                        </Badge>
                                                    );
                                                })}
                                                {attrs.fabricComposition && (
                                                    <Badge variant="secondary" className="text-xs font-normal">
                                                        {attrs.fabricComposition}
                                                    </Badge>
                                                )}
                                                {attrs.fabricWeight && (
                                                    <Badge variant="secondary" className="text-xs font-normal">
                                                        {attrs.fabricWeight} gsm
                                                    </Badge>
                                                )}
                                                {attrs.season && (
                                                    <Badge variant="secondary" className="text-xs font-normal">
                                                        {attrs.season}
                                                    </Badge>
                                                )}
                                            </div>
                                        </div>
                                    )}
                                </div>
                            </div>
                        </CardContent>
                    </Card>

                    {/* Editable Details (collapsible) */}
                    {(showEditForm || isDirty) && (
                        <Card>
                            <CardHeader className="pb-4">
                                <div className="flex items-center justify-between">
                                    <CardTitle className="text-base">Edit Details</CardTitle>
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
                                        {!isDirty && (
                                            <Button variant="ghost" size="sm" onClick={() => setShowEditForm(false)}>
                                                <X className="h-3.5 w-3.5" />
                                            </Button>
                                        )}
                                    </div>
                                </div>
                            </CardHeader>
                            <CardContent>
                                <div className="grid grid-cols-2 gap-4">
                                    <div className="col-span-2 sm:col-span-1">
                                        <Label htmlFor="name">Name</Label>
                                        <Input id="name" {...form.register('name')} />
                                    </div>
                                    <div>
                                        <Label htmlFor="styleCode">Style Code</Label>
                                        <Input id="styleCode" {...form.register('styleCode')} />
                                    </div>
                                    <div>
                                        <Label>Category</Label>
                                        <Select
                                            value={form.watch('category')}
                                            onValueChange={(v) => form.setValue('category', v, { shouldDirty: true })}
                                        >
                                            <SelectTrigger><SelectValue /></SelectTrigger>
                                            <SelectContent>
                                                {categoryOptions.map(c => (
                                                    <SelectItem key={c} value={c}>{c}</SelectItem>
                                                ))}
                                            </SelectContent>
                                        </Select>
                                    </div>
                                    <div>
                                        <Label>Gender</Label>
                                        <Select
                                            value={form.watch('gender')}
                                            onValueChange={(v) => form.setValue('gender', v, { shouldDirty: true })}
                                        >
                                            <SelectTrigger><SelectValue /></SelectTrigger>
                                            <SelectContent>
                                                {genderOptions.map(g => (
                                                    <SelectItem key={g} value={g}>{g}</SelectItem>
                                                ))}
                                            </SelectContent>
                                        </Select>
                                    </div>
                                    <div>
                                        <Label htmlFor="defaultFabricConsumption">Fabric Consumption (m)</Label>
                                        <Input
                                            id="defaultFabricConsumption"
                                            type="number"
                                            step="0.01"
                                            {...form.register('defaultFabricConsumption', { valueAsNumber: true })}
                                        />
                                    </div>
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
                    )}

                    {/* Style Description (stylist-written) */}
                    {product.description && (
                        <Card>
                            <CardHeader className="pb-2">
                                <CardTitle className="text-base">Style Description</CardTitle>
                            </CardHeader>
                            <CardContent>
                                <p className="text-sm leading-relaxed italic">
                                    {product.description}
                                </p>
                            </CardContent>
                        </Card>
                    )}

                    {/* ERP Description with version history */}
                    {product.erpDescription && (
                        <ErpDescriptionCard
                            description={product.erpDescription}
                            history={product.erpDescriptionHistory}
                        />
                    )}

                    {/* Shopify Description (marketing copy) */}
                    {product.shopify?.bodyHtml && (
                        <Card>
                            <CardHeader className="pb-2">
                                <CardTitle className="text-base">Description</CardTitle>
                            </CardHeader>
                            <CardContent>
                                <div
                                    className="text-sm text-muted-foreground leading-relaxed prose prose-sm max-w-none [&_p]:mb-2 [&_ul]:mb-2 [&_li]:text-muted-foreground"
                                    dangerouslySetInnerHTML={{ __html: product.shopify.bodyHtml }}
                                />
                            </CardContent>
                        </Card>
                    )}

                    {/* SEO Metadata */}
                    <SeoCard
                        productId={product.id}
                        seoTitle={product.erpSeoTitle}
                        seoDescription={product.erpSeoDescription}
                        shopifyHandle={product.shopify?.handle ?? null}
                    />

                    {/* Pricing Summary */}
                    <PricingSummaryCard product={product} />

                    {/* Inventory Summary */}
                    <InventorySummaryCard product={product} />
                </div>

                {/* ── Right Column: Shopify Sidebar ── */}
                <div className="space-y-4">
                    {product.shopify ? (
                        <ShopifySidebar shopify={product.shopify} />
                    ) : (
                        <Card>
                            <CardContent className="pt-6">
                                <p className="text-xs text-muted-foreground text-center">Not linked to Shopify</p>
                            </CardContent>
                        </Card>
                    )}
                </div>
            </div>

            {/* ── Size Guide (full width) ── */}
            {product.measurements && (
                <SizeGuideCard measurements={product.measurements} product={product} />
            )}

            {/* ── Variations Section ── */}
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

// ─── Shopify Sidebar ────────────────────────────────────────

function ShopifySidebar({ shopify }: { shopify: ShopifyProductData }) {
    const statusColor = shopify.status === 'active' ? 'text-green-600' : shopify.status === 'draft' ? 'text-yellow-600' : 'text-muted-foreground';

    return (
        <>
            {/* Status & Links */}
            <Card>
                <CardHeader className="pb-2">
                    <div className="flex items-center justify-between">
                        <CardTitle className="text-sm">Shopify</CardTitle>
                        <span className={`text-xs font-medium capitalize ${statusColor}`}>
                            {shopify.status}
                        </span>
                    </div>
                </CardHeader>
                <CardContent className="space-y-3">
                    <div className="flex flex-col gap-1.5">
                        {shopify.storefrontUrl && (
                            <a
                                href={shopify.storefrontUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-xs text-blue-600 hover:underline flex items-center gap-1"
                            >
                                <ExternalLink className="h-3 w-3" />
                                View on store
                            </a>
                        )}
                        <a
                            href={shopify.adminUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-xs text-blue-600 hover:underline flex items-center gap-1"
                        >
                            <ExternalLink className="h-3 w-3" />
                            Shopify Admin
                        </a>
                    </div>

                    {shopify.productType && (
                        <div>
                            <p className="text-xs text-muted-foreground mb-0.5">Product Type</p>
                            <p className="text-xs font-medium">{shopify.productType}</p>
                        </div>
                    )}

                    {shopify.publishedAt && (
                        <div>
                            <p className="text-xs text-muted-foreground mb-0.5">Published</p>
                            <p className="text-xs font-medium">
                                {new Date(shopify.publishedAt).toLocaleDateString('en-IN', {
                                    year: 'numeric', month: 'short', day: 'numeric'
                                })}
                            </p>
                        </div>
                    )}
                </CardContent>
            </Card>

            {/* Tags */}
            {shopify.tags.length > 0 && (
                <Card>
                    <CardHeader className="pb-2">
                        <CardTitle className="text-sm">Tags</CardTitle>
                    </CardHeader>
                    <CardContent>
                        <div className="flex flex-wrap gap-1">
                            {shopify.tags.map(tag => (
                                <Badge key={tag} variant="outline" className="text-[10px] font-normal">
                                    {tag}
                                </Badge>
                            ))}
                        </div>
                    </CardContent>
                </Card>
            )}

            {/* Shopify Images */}
            {shopify.images.length > 0 && (
                <Card>
                    <CardHeader className="pb-2">
                        <CardTitle className="text-sm">
                            Media ({shopify.images.length})
                        </CardTitle>
                    </CardHeader>
                    <CardContent>
                        <div className="grid grid-cols-3 gap-1.5">
                            {shopify.images.slice(0, 9).map((img, i) => (
                                <img
                                    key={i}
                                    src={img.src}
                                    alt={img.alt ?? ''}
                                    className="w-full aspect-square rounded object-cover border bg-muted"
                                    loading="lazy"
                                />
                            ))}
                            {shopify.images.length > 9 && (
                                <div className="w-full aspect-square rounded border bg-muted flex items-center justify-center">
                                    <span className="text-xs text-muted-foreground">
                                        +{shopify.images.length - 9}
                                    </span>
                                </div>
                            )}
                        </div>
                    </CardContent>
                </Card>
            )}
        </>
    );
}

// ─── Metadata Row ───────────────────────────────────────────

function MetadataRow({ label, value }: { label: string; value: string }) {
    return (
        <div className="flex items-baseline gap-2">
            <span className="text-muted-foreground text-xs whitespace-nowrap w-32 flex-shrink-0">{label}</span>
            <span className="font-medium text-sm truncate">{value}</span>
        </div>
    );
}

// ─── Pricing Summary Card ───────────────────────────────────

function PricingSummaryCard({ product }: { product: ProductDetailData }) {
    // Compute pricing stats across all SKUs
    const allSkus = product.variations.flatMap(v => v.skus);
    if (allSkus.length === 0) return null;

    const mrps = allSkus.map(s => s.mrp).filter((v): v is number => v != null);
    const sellingPrices = allSkus.map(s => s.sellingPrice).filter((v): v is number => v != null);
    const bomCosts = allSkus.map(s => s.bomCost).filter((v): v is number => v != null);

    const mrpRange = mrps.length > 0 ? { min: Math.min(...mrps), max: Math.max(...mrps) } : null;
    const sellingRange = sellingPrices.length > 0 ? { min: Math.min(...sellingPrices), max: Math.max(...sellingPrices) } : null;
    const bomRange = bomCosts.length > 0 ? { min: Math.min(...bomCosts), max: Math.max(...bomCosts) } : null;

    const avgMargin = mrpRange && bomRange
        ? Math.round((1 - (bomRange.min + bomRange.max) / 2 / ((mrpRange.min + mrpRange.max) / 2)) * 100)
        : null;

    const formatRange = (range: { min: number; max: number }) =>
        range.min === range.max ? `₹${range.min.toLocaleString('en-IN')}` : `₹${range.min.toLocaleString('en-IN')} – ₹${range.max.toLocaleString('en-IN')}`;

    return (
        <Card>
            <CardHeader className="pb-2">
                <CardTitle className="text-base">Pricing</CardTitle>
            </CardHeader>
            <CardContent>
                <div className="space-y-2 text-sm">
                    {mrpRange && (
                        <div className="flex justify-between">
                            <span className="text-muted-foreground">MRP</span>
                            <span className="font-medium tabular-nums">{formatRange(mrpRange)}</span>
                        </div>
                    )}
                    {sellingRange && (
                        <div className="flex justify-between">
                            <span className="text-muted-foreground">Selling Price</span>
                            <span className="font-medium tabular-nums text-green-600">{formatRange(sellingRange)}</span>
                        </div>
                    )}
                    {bomRange && (
                        <div className="flex justify-between">
                            <span className="text-muted-foreground">BOM Cost</span>
                            <span className="font-medium tabular-nums">{formatRange(bomRange)}</span>
                        </div>
                    )}
                    {avgMargin != null && (
                        <div className="flex justify-between pt-1 border-t">
                            <span className="text-muted-foreground">Gross Margin</span>
                            <span className="font-semibold tabular-nums">{avgMargin}%</span>
                        </div>
                    )}
                </div>
            </CardContent>
        </Card>
    );
}

// ─── Inventory Summary Card ─────────────────────────────────

function InventorySummaryCard({ product }: { product: ProductDetailData }) {
    const variations = product.variations;
    if (variations.length === 0) return null;

    const totalStock = variations.reduce(
        (sum, v) => sum + v.skus.reduce((s, sk) => s + sk.currentBalance, 0), 0
    );

    return (
        <Card>
            <CardHeader className="pb-2">
                <div className="flex items-center justify-between">
                    <CardTitle className="text-base">Inventory</CardTitle>
                    <span className="text-sm font-semibold tabular-nums">{totalStock} total</span>
                </div>
            </CardHeader>
            <CardContent>
                <div className="space-y-1.5">
                    {variations.map(v => {
                        const stock = v.skus.reduce((s, sk) => s + sk.currentBalance, 0);
                        const sizes = v.skus
                            .filter(sk => sk.currentBalance > 0)
                            .map(sk => `${sk.size}(${sk.currentBalance})`)
                            .join(' ');
                        return (
                            <div key={v.id} className="flex items-center justify-between text-sm">
                                <div className="flex items-center gap-2 min-w-0">
                                    {v.colorHex && (
                                        <span
                                            className="w-3 h-3 rounded-full border border-gray-300 flex-shrink-0"
                                            style={{ backgroundColor: v.colorHex }}
                                        />
                                    )}
                                    <span className="truncate text-muted-foreground">{v.colorName}</span>
                                </div>
                                <div className="flex items-center gap-2 flex-shrink-0">
                                    {sizes && (
                                        <span className="text-xs text-muted-foreground tabular-nums">{sizes}</span>
                                    )}
                                    <span className={`font-medium tabular-nums w-8 text-right ${stock === 0 ? 'text-red-500' : ''}`}>
                                        {stock}
                                    </span>
                                </div>
                            </div>
                        );
                    })}
                </div>
            </CardContent>
        </Card>
    );
}

// ─── Size Guide Card ────────────────────────────────────────

/**
 * Key measurement patterns per garment group.
 * These are the measurements customers actually care about — ordered by importance.
 * Each entry: [display label, regex to match measurement key]
 */
const KEY_MEASUREMENTS: Record<string, Array<[string, RegExp]>> = {
    tops: [
        ['Chest', /^(Chest|Bust)$/i],
        ['Shoulder', /^(Shoulder|Across Shoulder)/i],
        ['Length', /^(Front & Back Length|Full Length|Length)$/i],
        ['Sleeve', /^(Sleeve Length|Sleeve length|Full Sleeve Length)$/i],
    ],
    bottoms: [
        ['Waist', /^Waist(\s|$)/i],
        ['Hip', /^(Hip|Hips)$/i],
        ['Length', /^(Full Length)/i],
        ['Thigh', /^Thigh$/i],
        ['Inseam', /^(Inseam|Inside Leg)/i],
    ],
    dresses: [
        ['Chest', /^(Chest|Bust)$/i],
        ['Waist', /^Waist(\s|$)/i],
        ['Hip', /^(Hip|Hips)$/i],
        ['Length', /^(Full Length|Length Front)/i],
        ['Shoulder', /^(Shoulder|Across Shoulder)/i],
    ],
    sets: [
        ['Chest', /^(Chest|Bust)$/i],
        ['Waist', /^Waist(\s|$)/i],
        ['Length', /^(Full Length|Front & Back Length)/i],
    ],
};

/**
 * Find the first matching measurement key in a size's data for a given pattern.
 */
function findMeasurementKey(sizeMap: Record<string, number>, pattern: RegExp): string | null {
    for (const key of Object.keys(sizeMap)) {
        if (pattern.test(key.replace(/\n/g, ' '))) return key;
    }
    return null;
}

function SizeGuideCard({ measurements, product }: { measurements: MeasurementData; product: ProductDetailData }) {
    const sizeData = measurements.measurements;
    const sizeKeys = Object.keys(sizeData);
    if (sizeKeys.length === 0) return null;

    const [showFullSpec, setShowFullSpec] = useState(false);
    const equiv = measurements.sizeEquivalents;

    // Order sizes according to SIZE_ORDER
    const orderedSizes = [...sizeKeys].sort((a, b) => {
        const idxA = SIZE_ORDER.indexOf(a as (typeof SIZE_ORDER)[number]);
        const idxB = SIZE_ORDER.indexOf(b as (typeof SIZE_ORDER)[number]);
        if (idxA !== -1 && idxB !== -1) return idxA - idxB;
        if (idxA === -1 && idxB !== -1) return 1;
        if (idxA !== -1 && idxB === -1) return -1;
        return a.localeCompare(b);
    });

    // Collect all unique measurement points, cleaning up newlines
    const measurementPoints = new Set<string>();
    for (const sizeMap of Object.values(sizeData)) {
        for (const key of Object.keys(sizeMap)) {
            measurementPoints.add(key.replace(/\n/g, ' '));
        }
    }
    const allColumns = Array.from(measurementPoints);

    const isWomen = product.gender === 'women' || product.gender === 'unisex';

    // Resolve key measurements for the customer-facing table
    const keyPatterns = KEY_MEASUREMENTS[product.garmentGroup] ?? KEY_MEASUREMENTS.tops;
    const referenceSizeMap = sizeData[orderedSizes[0]] ?? {};
    const resolvedKeyMeasurements = useMemo(() => {
        const result: Array<{ label: string; key: string }> = [];
        for (const [label, pattern] of keyPatterns) {
            const key = findMeasurementKey(referenceSizeMap, pattern);
            if (key) result.push({ label, key });
        }
        return result;
    }, [keyPatterns, referenceSizeMap]);

    return (
        <Card>
            <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                        <Ruler className="h-4 w-4 text-muted-foreground" />
                        <CardTitle className="text-base">Size Guide</CardTitle>
                    </div>
                    <div className="flex items-center gap-2">
                        <Badge variant="outline" className="text-xs">
                            {measurements.unit}
                        </Badge>
                        {measurements.sampleSize && (
                            <span className="text-xs text-muted-foreground">
                                Sample: {measurements.sampleSize}
                            </span>
                        )}
                        {measurements.isFullyGraded && (
                            <Badge variant="secondary" className="text-xs">
                                Fully Graded
                            </Badge>
                        )}
                    </div>
                </div>
            </CardHeader>
            <CardContent className="pt-0 space-y-4">
                {/* Combined: International Sizes + Key Measurements */}
                <div className="overflow-x-auto -mx-6 px-6">
                    <table className="w-full text-sm">
                        <thead>
                            <tr className="border-b">
                                <th className="text-left px-3 py-2 font-medium text-xs text-muted-foreground sticky left-0 bg-background min-w-[80px]">
                                    COH Size
                                </th>
                                {orderedSizes.map(size => {
                                    const isSample = size === measurements.sampleSize;
                                    return (
                                        <th key={size} className={`text-center px-3 py-2 font-semibold text-xs min-w-[60px] ${isSample ? 'bg-primary/5' : ''}`}>
                                            {size}
                                            {isSample && <span className="text-primary ml-0.5">*</span>}
                                        </th>
                                    );
                                })}
                            </tr>
                        </thead>
                        <tbody>
                            {/* International size rows */}
                            {equiv && (
                                <>
                                    <tr className="border-b bg-muted/30">
                                        <td className="px-3 py-1.5 text-xs font-medium text-muted-foreground sticky left-0 bg-muted/30">
                                            {isWomen ? 'UK' : 'UK Chest'}
                                        </td>
                                        {orderedSizes.map(size => (
                                            <td key={size} className="px-3 py-1.5 text-xs text-center tabular-nums bg-muted/30">
                                                {equiv[size] ? (isWomen ? `UK ${equiv[size].uk}` : `${equiv[size].uk}"`) : '—'}
                                            </td>
                                        ))}
                                    </tr>
                                    <tr className="border-b bg-muted/30">
                                        <td className="px-3 py-1.5 text-xs font-medium text-muted-foreground sticky left-0 bg-muted/30">US</td>
                                        {orderedSizes.map(size => (
                                            <td key={size} className="px-3 py-1.5 text-xs text-center tabular-nums bg-muted/30">
                                                {equiv[size] ? (isWomen ? `US ${equiv[size].us}` : `${equiv[size].us}`) : '—'}
                                            </td>
                                        ))}
                                    </tr>
                                    <tr className="border-b bg-muted/30">
                                        <td className="px-3 py-1.5 text-xs font-medium text-muted-foreground sticky left-0 bg-muted/30">EU</td>
                                        {orderedSizes.map(size => (
                                            <td key={size} className="px-3 py-1.5 text-xs text-center tabular-nums bg-muted/30">
                                                {equiv[size] ? `EU ${equiv[size].eu}` : '—'}
                                            </td>
                                        ))}
                                    </tr>
                                </>
                            )}
                            {/* Key measurement rows */}
                            {resolvedKeyMeasurements.map(({ label, key }) => (
                                <tr key={key} className="border-b last:border-0">
                                    <td className="px-3 py-1.5 text-xs font-medium sticky left-0 bg-background">{label}</td>
                                    {orderedSizes.map(size => {
                                        const values = sizeData[size] ?? {};
                                        const val = values[key] ?? values[Object.keys(values).find(k => k.replace(/\n/g, ' ') === key.replace(/\n/g, ' ')) ?? ''];
                                        return (
                                            <td key={size} className="px-3 py-1.5 text-xs text-center tabular-nums">
                                                {val != null ? val : '—'}
                                            </td>
                                        );
                                    })}
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>

                {/* Fit comments */}
                {measurements.fitComments.length > 0 && (
                    <div className="pt-2 border-t">
                        <p className="text-xs font-medium text-muted-foreground mb-1">Fit Notes</p>
                        <ul className="text-xs text-muted-foreground space-y-0.5">
                            {measurements.fitComments.map((comment, i) => (
                                <li key={i}>{comment}</li>
                            ))}
                        </ul>
                    </div>
                )}

                {/* Full spec (collapsible) */}
                {allColumns.length > resolvedKeyMeasurements.length && (
                    <div className="pt-2 border-t">
                        <button
                            onClick={() => setShowFullSpec(!showFullSpec)}
                            className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1"
                        >
                            <ChevronDown className={`h-3 w-3 transition-transform ${showFullSpec ? 'rotate-180' : ''}`} />
                            {showFullSpec ? 'Hide' : 'Show'} full garment spec ({allColumns.length} measurements)
                        </button>
                        {showFullSpec && (
                            <div className="overflow-x-auto -mx-6 px-6 mt-2">
                                <table className="w-full text-sm">
                                    <thead>
                                        <tr className="border-b">
                                            <th className="text-left px-3 py-2 font-medium text-xs text-muted-foreground sticky left-0 bg-background">
                                                Size
                                            </th>
                                            {allColumns.map(col => (
                                                <th key={col} className="text-right px-3 py-2 font-medium text-xs text-muted-foreground whitespace-nowrap">
                                                    {col}
                                                </th>
                                            ))}
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {orderedSizes.map(size => {
                                            const isSample = size === measurements.sampleSize;
                                            const values = sizeData[size] ?? {};
                                            return (
                                                <tr
                                                    key={size}
                                                    className={`border-b last:border-0 ${isSample ? 'bg-primary/5 font-medium' : ''}`}
                                                >
                                                    <td className={`px-3 py-1.5 text-xs sticky left-0 ${isSample ? 'bg-primary/5 font-semibold' : 'bg-background'}`}>
                                                        {size}
                                                        {isSample && <span className="text-primary ml-1">*</span>}
                                                    </td>
                                                    {allColumns.map(col => {
                                                        const cleanCol = col.replace(/\n/g, ' ');
                                                        const val = values[col] ?? values[Object.keys(values).find(k => k.replace(/\n/g, ' ') === cleanCol) ?? ''];
                                                        return (
                                                            <td key={col} className="px-3 py-1.5 text-xs text-right tabular-nums">
                                                                {val != null ? val : '—'}
                                                            </td>
                                                        );
                                                    })}
                                                </tr>
                                            );
                                        })}
                                    </tbody>
                                </table>
                            </div>
                        )}
                    </div>
                )}
            </CardContent>
        </Card>
    );
}

// ─── Variation Card ─────────────────────────────────────────

function VariationCard({
    variation,
    product,
}: {
    variation: VariationDetailData;
    product: ProductDetailData;
}) {
    const [showSkus, setShowSkus] = useState(false);
    const [showBom, setShowBom] = useState(false);
    const [showEditFields, setShowEditFields] = useState(false);

    const {
        form,
        isSaving,
        isDirty,
        handleSubmit,
        reset,
    } = useVariationEditForm({ variation, product });

    // Fetch resolved BOM
    const getResolvedBomFn = useServerFn(getResolvedBomForVariation);
    const { data: bomResult, isLoading: bomLoading } = useQuery({
        queryKey: ['bom', 'resolved', variation.id],
        queryFn: () => getResolvedBomFn({ data: { variationId: variation.id } }),
        enabled: showBom,
    });

    const variationStock = variation.skus.reduce((sum, s) => sum + s.currentBalance, 0);
    const hasShopify = !!variation.shopifySourceProductId;

    return (
        <Card>
            <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                        {/* Variation image thumbnail */}
                        {variation.imageUrl ? (
                            <img
                                src={variation.imageUrl}
                                alt={variation.colorName}
                                className="w-10 h-10 rounded object-cover border flex-shrink-0"
                                loading="lazy"
                            />
                        ) : variation.colorHex ? (
                            <span
                                className="w-10 h-10 rounded border border-gray-300 flex-shrink-0"
                                style={{ backgroundColor: variation.colorHex }}
                            />
                        ) : (
                            <div className="w-10 h-10 rounded border bg-muted flex-shrink-0" />
                        )}

                        <div>
                            <div className="flex items-center gap-2">
                                <CardTitle className="text-sm font-medium">
                                    {variation.colorName}
                                </CardTitle>
                                {!variation.isActive && (
                                    <Badge variant="secondary" className="text-xs">Inactive</Badge>
                                )}
                                {hasShopify && (
                                    <Badge variant="outline" className="text-xs gap-1">
                                        <ExternalLink className="h-2.5 w-2.5" />
                                        Shopify
                                    </Badge>
                                )}
                            </div>
                            <div className="flex items-center gap-2 mt-0.5">
                                {variation.fabricColourName && (
                                    <span className="text-xs text-muted-foreground">
                                        {variation.materialName} / {variation.fabricName} / {variation.fabricColourName}
                                    </span>
                                )}
                            </div>
                        </div>
                    </div>

                    <div className="flex items-center gap-3">
                        {/* Stock & BOM summary */}
                        <div className="flex items-center gap-2 text-xs text-muted-foreground">
                            <span className="tabular-nums">{variationStock} in stock</span>
                            {variation.bomCost != null && (
                                <>
                                    <span className="text-border">|</span>
                                    <span className="tabular-nums">BOM: ₹{variation.bomCost.toFixed(0)}</span>
                                </>
                            )}
                        </div>

                        <div className="flex items-center gap-1">
                            <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => setShowEditFields(!showEditFields)}
                            >
                                <Pencil className="h-3.5 w-3.5" />
                            </Button>
                            <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => setShowBom(!showBom)}
                            >
                                {showBom ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                                <span className="ml-1 text-xs">BOM</span>
                            </Button>
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
                </div>
            </CardHeader>

            <CardContent className="pt-0">
                {/* Editable variation fields */}
                {(showEditFields || isDirty) && (
                    <div className="mb-4 p-3 border rounded-md bg-muted/20">
                        <div className="flex items-center justify-between mb-3">
                            <span className="text-xs font-medium text-muted-foreground">Edit Variation</span>
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
                                {!isDirty && (
                                    <Button variant="ghost" size="sm" onClick={() => setShowEditFields(false)}>
                                        <X className="h-3.5 w-3.5" />
                                    </Button>
                                )}
                            </div>
                        </div>
                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                            <div>
                                <Label className="text-xs">Color Name</Label>
                                <Input className="h-8 text-sm" {...form.register('colorName')} />
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
                    </div>
                )}

                {/* Collapsible BOM cost breakdown */}
                {showBom && (
                    <BomTable bomResult={bomResult} bomLoading={bomLoading} />
                )}

                {/* Collapsible SKU table */}
                {showSkus && (
                    <SkuTable variation={variation} product={product} />
                )}
            </CardContent>
        </Card>
    );
}

// ─── BOM Table ──────────────────────────────────────────────

function BomTable({
    bomResult,
    bomLoading,
}: {
    bomResult: { success: boolean; data?: { lines: ResolvedBomLine[]; totalCost: number } } | undefined;
    bomLoading: boolean;
}) {
    return (
        <div className="mb-4 border rounded-md overflow-hidden">
            {bomLoading ? (
                <div className="flex items-center justify-center py-4">
                    <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                </div>
            ) : bomResult?.success && bomResult.data && bomResult.data.lines.length > 0 ? (
                <table className="w-full text-sm">
                    <thead className="bg-muted/50">
                        <tr>
                            <th className="text-left px-3 py-2 font-medium text-xs">Type</th>
                            <th className="text-left px-3 py-2 font-medium text-xs">Role</th>
                            <th className="text-left px-3 py-2 font-medium text-xs">Component</th>
                            <th className="text-right px-3 py-2 font-medium text-xs">Qty</th>
                            <th className="text-right px-3 py-2 font-medium text-xs">Wastage</th>
                            <th className="text-right px-3 py-2 font-medium text-xs">Eff. Qty</th>
                            <th className="text-right px-3 py-2 font-medium text-xs">Unit Cost</th>
                            <th className="text-right px-3 py-2 font-medium text-xs">Line Total</th>
                        </tr>
                    </thead>
                    <tbody>
                        {bomResult.data.lines.map((line: ResolvedBomLine) => (
                            <tr key={line.roleId} className="border-t">
                                <td className="px-3 py-1.5 text-xs">
                                    <Badge variant="outline" className="text-[10px] font-normal">
                                        {line.typeCode}
                                    </Badge>
                                </td>
                                <td className="px-3 py-1.5 text-xs">{line.roleName}</td>
                                <td className="px-3 py-1.5 text-xs">
                                    {line.componentName ? (
                                        <span className="flex items-center gap-1.5">
                                            {line.colourHex && (
                                                <span
                                                    className="w-3 h-3 rounded-full border border-gray-300 flex-shrink-0"
                                                    style={{ backgroundColor: line.colourHex }}
                                                />
                                            )}
                                            {line.componentName}
                                        </span>
                                    ) : (
                                        <span className="text-muted-foreground italic">Not set</span>
                                    )}
                                </td>
                                <td className="px-3 py-1.5 text-xs text-right tabular-nums">
                                    {line.skuRange
                                        ? (line.skuRange.minQty === line.skuRange.maxQty
                                            ? `${line.skuRange.minQty} ${line.unit}`
                                            : `${line.skuRange.minQty}–${line.skuRange.maxQty} ${line.unit}`)
                                        : `${line.quantity} ${line.unit}`
                                    }
                                    {line.skuRange && line.skuRange.minQty !== line.skuRange.maxQty && (
                                        <span className="text-muted-foreground ml-1">(by size)</span>
                                    )}
                                </td>
                                <td className="px-3 py-1.5 text-xs text-right tabular-nums">
                                    {line.wastagePercent > 0 ? `${line.wastagePercent}%` : '—'}
                                </td>
                                <td className="px-3 py-1.5 text-xs text-right tabular-nums">
                                    {line.skuRange ? '(avg)' : line.effectiveQty.toFixed(2)}
                                </td>
                                <td className="px-3 py-1.5 text-xs text-right tabular-nums">
                                    {line.unitCost != null ? `₹${line.unitCost.toFixed(0)}` : '—'}
                                </td>
                                <td className="px-3 py-1.5 text-xs text-right tabular-nums font-medium">
                                    {line.lineCost != null ? `₹${line.lineCost.toFixed(0)}` : '—'}
                                    {line.skuRange && (
                                        <span className="text-muted-foreground font-normal ml-1">(avg)</span>
                                    )}
                                </td>
                            </tr>
                        ))}
                    </tbody>
                    <tfoot>
                        <tr className="border-t bg-muted/30">
                            <td colSpan={7} className="px-3 py-2 text-xs font-semibold text-right">
                                Total BOM Cost
                            </td>
                            <td className="px-3 py-2 text-xs font-semibold text-right tabular-nums">
                                ₹{bomResult.data.totalCost.toFixed(0)}
                            </td>
                        </tr>
                    </tfoot>
                </table>
            ) : (
                <div className="px-3 py-4 text-xs text-muted-foreground text-center">
                    No BOM template defined for this product.
                </div>
            )}
        </div>
    );
}

// ─── SKU Table ──────────────────────────────────────────────

function SkuTable({
    variation,
    product,
}: {
    variation: VariationDetailData;
    product: ProductDetailData;
}) {
    return (
        <div className="border rounded-md overflow-hidden">
            <table className="w-full text-sm">
                <thead className="bg-muted/50">
                    <tr>
                        <th className="text-left px-3 py-2 font-medium text-xs">SKU Code</th>
                        <th className="text-left px-3 py-2 font-medium text-xs">Size</th>
                        <th className="text-right px-3 py-2 font-medium text-xs">MRP</th>
                        <th className="text-right px-3 py-2 font-medium text-xs">Selling</th>
                        <th className="text-right px-3 py-2 font-medium text-xs">BOM</th>
                        <th className="text-right px-3 py-2 font-medium text-xs">Balance</th>
                        <th className="text-center px-3 py-2 font-medium text-xs">Shopify</th>
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
    );
}

// ─── SKU Row (inline editable) ──────────────────────────────

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

    const hasDiscount = sku.sellingPrice != null && sku.mrp != null && sku.sellingPrice < sku.mrp;

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
            <td className="px-3 py-1.5 text-right text-xs tabular-nums">
                {sku.sellingPrice != null ? (
                    <span className={hasDiscount ? 'text-green-600 font-medium' : ''}>
                        ₹{sku.sellingPrice.toFixed(0)}
                        {hasDiscount && sku.mrp != null && (
                            <span className="text-muted-foreground font-normal ml-1">
                                ({Math.round((1 - sku.sellingPrice / sku.mrp) * 100)}% off)
                            </span>
                        )}
                    </span>
                ) : (
                    <span className="text-muted-foreground">—</span>
                )}
            </td>
            <td className="px-3 py-1.5 text-right text-xs text-muted-foreground tabular-nums">
                {sku.bomCost != null ? `₹${sku.bomCost.toFixed(0)}` : '—'}
            </td>
            <td className="px-3 py-1.5 text-right text-xs tabular-nums">
                {sku.currentBalance}
            </td>
            <td className="px-3 py-1.5 text-center">
                {sku.shopifyVariantId ? (
                    <Badge variant="outline" className="text-[10px]">Linked</Badge>
                ) : (
                    <span className="text-xs text-muted-foreground">—</span>
                )}
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
