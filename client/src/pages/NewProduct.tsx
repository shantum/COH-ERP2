/**
 * NewProduct Page
 *
 * Full-page form for creating a new product with variations (colors)
 * and auto-generated SKUs. Creates the complete Product -> Variation -> SKU
 * hierarchy in a single server call.
 */

import { useState } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { useServerFn } from '@tanstack/react-start';
import { createProductDraft } from '../server/functions/productsMutations';
import { SIZE_ORDER } from '../constants/sizes';
import { PRODUCT_CATEGORIES, GENDERS } from '../components/products/types';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select';
import { ArrowLeft, Plus, X, Loader2 } from 'lucide-react';

// --- Constants ---

const DEFAULT_SIZES: string[] = ['XS', 'S', 'M', 'L', 'XL', '2XL', '3XL'];
const ALL_SIZES: string[] = [...SIZE_ORDER];

// --- Component ---

export default function NewProduct() {
    const navigate = useNavigate();
    const createDraftFn = useServerFn(createProductDraft);

    // Form state
    const [name, setName] = useState('');
    const [description, setDescription] = useState('');
    const [category, setCategory] = useState('');
    const [productType, setProductType] = useState('');
    const [gender, setGender] = useState('Women');
    const [mrp, setMrp] = useState<string>('');
    const [fabricConsumption, setFabricConsumption] = useState<string>('');
    const [sizes, setSizes] = useState<string[]>([...DEFAULT_SIZES]);
    const [variations, setVariations] = useState<
        Array<{ colorName: string; colorHex: string; hasLining: boolean }>
    >([{ colorName: '', colorHex: '#000000', hasLining: false }]);
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [error, setError] = useState<string | null>(null);

    // --- Size helpers ---

    const toggleSize = (size: string) => {
        setSizes((prev) =>
            prev.includes(size) ? prev.filter((s) => s !== size) : [...prev, size],
        );
    };

    const selectAllSizes = () => setSizes([...ALL_SIZES]);
    const deselectAllSizes = () => setSizes([]);

    // --- Variation helpers ---

    const addVariation = () => {
        setVariations((prev) => [
            ...prev,
            { colorName: '', colorHex: '#000000', hasLining: false },
        ]);
    };

    const removeVariation = (index: number) => {
        if (variations.length <= 1) return;
        setVariations((prev) => prev.filter((_, i) => i !== index));
    };

    const updateVariation = (
        index: number,
        field: string,
        value: string | boolean,
    ) => {
        setVariations((prev) =>
            prev.map((v, i) => (i === index ? { ...v, [field]: value } : v)),
        );
    };

    // --- Preview calculations ---

    const validVariations = variations.filter((v) => v.colorName.trim());
    const totalSkus = validVariations.length * sizes.length;

    // --- Submit ---

    const handleSubmit = async () => {
        if (!name.trim()) {
            setError('Product name is required');
            return;
        }
        if (!category) {
            setError('Category is required');
            return;
        }
        if (!productType.trim()) {
            setError('Product type is required');
            return;
        }
        if (!mrp || Number(mrp) <= 0) {
            setError('MRP must be greater than 0');
            return;
        }
        if (sizes.length === 0) {
            setError('Select at least one size');
            return;
        }
        if (validVariations.length === 0) {
            setError('Add at least one color with a name');
            return;
        }

        setError(null);
        setIsSubmitting(true);

        try {
            const result = await createDraftFn({
                data: {
                    name: name.trim(),
                    ...(description.trim()
                        ? { description: description.trim() }
                        : {}),
                    category,
                    productType: productType.trim(),
                    gender,
                    mrp: Number(mrp),
                    ...(fabricConsumption
                        ? { defaultFabricConsumption: Number(fabricConsumption) }
                        : {}),
                    sizes,
                    variations: validVariations.map((v) => ({
                        colorName: v.colorName.trim(),
                        ...(v.colorHex && v.colorHex !== '#000000'
                            ? { colorHex: v.colorHex }
                            : {}),
                        hasLining: v.hasLining,
                    })),
                },
            });

            if (result.success) {
                navigate({ to: '/products', search: { tab: 'products', view: 'tree' } });
            } else {
                setError(result.error?.message || 'Failed to create product');
            }
        } catch (err: unknown) {
            setError(err instanceof Error ? err.message : 'An error occurred');
        } finally {
            setIsSubmitting(false);
        }
    };

    // --- Render ---

    return (
        <div className="max-w-4xl mx-auto p-6 space-y-6">
            {/* Header */}
            <div className="flex items-center justify-between">
                <div className="space-y-1">
                    <button
                        type="button"
                        onClick={() => navigate({ to: '/products', search: { tab: 'products', view: 'tree' } })}
                        className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors"
                    >
                        <ArrowLeft className="h-4 w-4" />
                        Back to Products
                    </button>
                    <h1 className="text-2xl font-semibold">New Product</h1>
                </div>
                <Button onClick={handleSubmit} disabled={isSubmitting}>
                    {isSubmitting && (
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    )}
                    Create Product
                </Button>
            </div>

            {/* Error banner */}
            {error && (
                <div className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                    {error}
                </div>
            )}

            {/* Product Details */}
            <Card>
                <CardHeader>
                    <CardTitle>Product Details</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                    <div className="grid grid-cols-3 gap-4">
                        <div className="space-y-2">
                            <Label htmlFor="name">
                                Name <span className="text-red-500">*</span>
                            </Label>
                            <Input
                                id="name"
                                value={name}
                                onChange={(e) => setName(e.target.value)}
                                placeholder="e.g. Floral Kurti"
                            />
                        </div>

                        <div className="space-y-2">
                            <Label htmlFor="category">
                                Category <span className="text-red-500">*</span>
                            </Label>
                            <Select value={category} onValueChange={setCategory}>
                                <SelectTrigger id="category">
                                    <SelectValue placeholder="Select category" />
                                </SelectTrigger>
                                <SelectContent>
                                    {PRODUCT_CATEGORIES.map((cat) => (
                                        <SelectItem key={cat} value={cat}>
                                            {cat}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>

                        <div className="space-y-2">
                            <Label htmlFor="productType">
                                Product Type{' '}
                                <span className="text-red-500">*</span>
                            </Label>
                            <Input
                                id="productType"
                                value={productType}
                                onChange={(e) => setProductType(e.target.value)}
                                placeholder="e.g. Regular, Premium"
                            />
                        </div>

                        <div className="space-y-2">
                            <Label htmlFor="gender">Gender</Label>
                            <Select value={gender} onValueChange={setGender}>
                                <SelectTrigger id="gender">
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                    {GENDERS.map((g) => (
                                        <SelectItem key={g} value={g}>
                                            {g}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>

                        <div className="space-y-2">
                            <Label htmlFor="mrp">
                                MRP <span className="text-red-500">*</span>
                            </Label>
                            <Input
                                id="mrp"
                                type="number"
                                min="0"
                                step="1"
                                value={mrp}
                                onChange={(e) => setMrp(e.target.value)}
                                placeholder="0"
                            />
                        </div>

                        <div className="space-y-2">
                            <Label htmlFor="fabricConsumption">
                                Default Fabric Consumption
                            </Label>
                            <Input
                                id="fabricConsumption"
                                type="number"
                                min="0"
                                step="0.01"
                                value={fabricConsumption}
                                onChange={(e) =>
                                    setFabricConsumption(e.target.value)
                                }
                                placeholder="meters"
                            />
                            <p className="text-xs text-muted-foreground">
                                In meters (optional)
                            </p>
                        </div>
                    </div>

                    <div className="space-y-2">
                        <Label htmlFor="description">Description</Label>
                        <Textarea
                            id="description"
                            value={description}
                            onChange={(e) => setDescription(e.target.value)}
                            placeholder="Optional product description..."
                            rows={3}
                        />
                    </div>
                </CardContent>
            </Card>

            {/* Sizes */}
            <Card>
                <CardHeader>
                    <div className="flex items-center justify-between">
                        <CardTitle>Sizes</CardTitle>
                        <div className="flex gap-2 text-sm">
                            <button
                                type="button"
                                onClick={selectAllSizes}
                                className="text-primary hover:underline"
                            >
                                Select All
                            </button>
                            <span className="text-muted-foreground">/</span>
                            <button
                                type="button"
                                onClick={deselectAllSizes}
                                className="text-primary hover:underline"
                            >
                                Deselect All
                            </button>
                        </div>
                    </div>
                </CardHeader>
                <CardContent>
                    <div className="flex flex-wrap gap-4">
                        {ALL_SIZES.map((size) => (
                            <label
                                key={size}
                                className="flex items-center gap-2 cursor-pointer"
                            >
                                <Checkbox
                                    checked={sizes.includes(size)}
                                    onCheckedChange={() => toggleSize(size)}
                                />
                                <span className="text-sm font-medium">
                                    {size}
                                </span>
                            </label>
                        ))}
                    </div>
                </CardContent>
            </Card>

            {/* Colors (Variations) */}
            <Card>
                <CardHeader>
                    <CardTitle>Colors (Variations)</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                    {variations.map((variation, index) => (
                        <div
                            key={index}
                            className="flex items-center gap-3 rounded-md border p-3"
                        >
                            <div className="flex-1 space-y-1">
                                <Label className="text-xs text-muted-foreground">
                                    Color Name
                                </Label>
                                <Input
                                    value={variation.colorName}
                                    onChange={(e) =>
                                        updateVariation(
                                            index,
                                            'colorName',
                                            e.target.value,
                                        )
                                    }
                                    placeholder="e.g. Navy Blue"
                                />
                            </div>

                            <div className="space-y-1">
                                <Label className="text-xs text-muted-foreground">
                                    Hex
                                </Label>
                                <input
                                    type="color"
                                    value={variation.colorHex}
                                    onChange={(e) =>
                                        updateVariation(
                                            index,
                                            'colorHex',
                                            e.target.value,
                                        )
                                    }
                                    className="h-9 w-12 cursor-pointer rounded border p-0.5"
                                />
                            </div>

                            <div className="flex items-end gap-2 pb-0.5">
                                <label className="flex items-center gap-2 cursor-pointer">
                                    <Checkbox
                                        checked={variation.hasLining}
                                        onCheckedChange={(checked) =>
                                            updateVariation(
                                                index,
                                                'hasLining',
                                                !!checked,
                                            )
                                        }
                                    />
                                    <span className="text-sm">Has Lining</span>
                                </label>
                            </div>

                            <Button
                                variant="ghost"
                                size="icon"
                                onClick={() => removeVariation(index)}
                                disabled={variations.length <= 1}
                                className="shrink-0"
                            >
                                <X className="h-4 w-4" />
                            </Button>
                        </div>
                    ))}

                    <Button
                        variant="outline"
                        size="sm"
                        onClick={addVariation}
                        className="mt-2"
                    >
                        <Plus className="mr-1 h-4 w-4" />
                        Add Color
                    </Button>
                </CardContent>
            </Card>

            {/* Preview */}
            <Card>
                <CardHeader>
                    <CardTitle>Preview</CardTitle>
                </CardHeader>
                <CardContent className="space-y-2">
                    <p className="text-sm text-muted-foreground">
                        {validVariations.length} color
                        {validVariations.length !== 1 ? 's' : ''} &times;{' '}
                        {sizes.length} size{sizes.length !== 1 ? 's' : ''} ={' '}
                        <span className="font-semibold text-foreground">
                            {totalSkus} SKUs
                        </span>{' '}
                        will be created
                    </p>

                    {validVariations.length > 0 && (
                        <ul className="space-y-1">
                            {validVariations.map((v, i) => (
                                <li
                                    key={i}
                                    className="flex items-center gap-2 text-sm"
                                >
                                    {v.colorHex && (
                                        <span
                                            className="inline-block h-3 w-3 rounded-full border"
                                            style={{
                                                backgroundColor: v.colorHex,
                                            }}
                                        />
                                    )}
                                    <span>{v.colorName.trim()}</span>
                                    <span className="text-muted-foreground">
                                        — {sizes.length} SKU
                                        {sizes.length !== 1 ? 's' : ''}
                                    </span>
                                </li>
                            ))}
                        </ul>
                    )}
                </CardContent>
            </Card>
        </div>
    );
}
