/**
 * NewProduct Page
 *
 * Full-page form for creating a new product with variations (colors)
 * and auto-generated SKUs. Creates the complete Product -> Variation -> SKU
 * hierarchy in a single server call.
 */

import { useState, useMemo } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { useServerFn } from '@tanstack/react-start';
import { useQuery } from '@tanstack/react-query';
import { createProductDraft } from '../server/functions/productsMutations';
import { getCatalogFilters } from '../server/functions/products';
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
import { ArrowLeft, Plus, X, Loader2, ChevronsUpDown } from 'lucide-react';

// --- Constants ---

const DEFAULT_SIZES: string[] = ['XS', 'S', 'M', 'L', 'XL', '2XL', '3XL'];
const ALL_SIZES: string[] = [...SIZE_ORDER];

// --- Fabric Colour Picker ---

function FabricColourPicker({
    fabricColours,
    materialId,
    value,
    onChange,
}: {
    fabricColours: Array<{
        id: string;
        code: string | null;
        name: string;
        hex: string | null;
        fabricId: string;
        fabricName: string;
        materialId: string;
        materialName: string;
        costPerUnit: number | null;
    }>;
    materialId: string;
    value: string;
    onChange: (id: string) => void;
}) {
    const [isOpen, setIsOpen] = useState(false);
    const [search, setSearch] = useState('');

    const filtered = useMemo(() => {
        let list = fabricColours;
        if (materialId) {
            list = list.filter(fc => fc.materialId === materialId);
        }
        if (search.trim()) {
            const q = search.toLowerCase();
            list = list.filter(fc =>
                fc.name.toLowerCase().includes(q) ||
                fc.fabricName.toLowerCase().includes(q) ||
                fc.materialName.toLowerCase().includes(q) ||
                (fc.code && fc.code.toLowerCase().includes(q))
            );
        }
        return list;
    }, [fabricColours, materialId, search]);

    const selected = fabricColours.find(fc => fc.id === value);

    return (
        <div className="relative flex-1">
            <Label className="text-xs text-muted-foreground">Fabric Colour</Label>
            <button
                type="button"
                onClick={() => setIsOpen(!isOpen)}
                className="w-full flex items-center justify-between gap-1 px-2 py-1.5 border rounded-md text-sm text-left h-9"
            >
                {selected ? (
                    <span className="flex items-center gap-1 truncate">
                        {selected.hex && (
                            <span
                                className="inline-block h-3 w-3 rounded-full border flex-shrink-0"
                                style={{ backgroundColor: selected.hex }}
                            />
                        )}
                        <span className="truncate">{selected.name}</span>
                    </span>
                ) : (
                    <span className="text-muted-foreground">Optional</span>
                )}
                <ChevronsUpDown className="h-3 w-3 text-muted-foreground flex-shrink-0" />
            </button>
            {isOpen && (
                <>
                    <div className="fixed inset-0 z-40" onClick={() => { setIsOpen(false); setSearch(''); }} />
                    <div className="absolute z-50 w-72 mt-1 bg-white border rounded-lg shadow-lg">
                        <div className="p-2 border-b">
                            <Input
                                value={search}
                                onChange={(e) => setSearch(e.target.value)}
                                placeholder="Search fabrics..."
                                className="h-7 text-xs"
                                autoFocus
                            />
                        </div>
                        <div className="max-h-48 overflow-y-auto">
                            {value && (
                                <button
                                    type="button"
                                    onClick={() => { onChange(''); setIsOpen(false); setSearch(''); }}
                                    className="w-full px-3 py-1.5 text-xs text-muted-foreground hover:bg-red-50 hover:text-red-600 text-left border-b"
                                >
                                    Clear selection
                                </button>
                            )}
                            {filtered.length === 0 ? (
                                <div className="px-3 py-3 text-xs text-muted-foreground text-center">
                                    No fabric colours found
                                </div>
                            ) : (
                                filtered.map((fc) => (
                                    <button
                                        key={fc.id}
                                        type="button"
                                        onClick={() => { onChange(fc.id); setIsOpen(false); setSearch(''); }}
                                        className={`w-full flex items-center gap-2 px-3 py-1.5 text-xs text-left hover:bg-gray-50 ${value === fc.id ? 'bg-blue-50' : ''}`}
                                    >
                                        {fc.hex && (
                                            <span
                                                className="inline-block h-3 w-3 rounded-full border flex-shrink-0"
                                                style={{ backgroundColor: fc.hex }}
                                            />
                                        )}
                                        <span className="flex-1 min-w-0">
                                            <span className="font-medium truncate block">{fc.name}</span>
                                            <span className="text-muted-foreground truncate block">
                                                {fc.materialName} &rarr; {fc.fabricName}
                                                {fc.costPerUnit != null && ` · ₹${fc.costPerUnit}/m`}
                                            </span>
                                        </span>
                                    </button>
                                ))
                            )}
                        </div>
                    </div>
                </>
            )}
        </div>
    );
}

// --- Component ---

export default function NewProduct() {
    const navigate = useNavigate();
    const createDraftFn = useServerFn(createProductDraft);

    // Catalog data for dropdowns
    const { data: catalog } = useQuery({
        queryKey: ['products', 'catalogFilters', 'getCatalogFilters'],
        queryFn: () => getCatalogFilters(),
    });

    // Derive unique materials from fabric colours
    const materials = useMemo(() => {
        if (!catalog?.fabricColours) return [];
        const seen = new Map<string, string>();
        for (const fc of catalog.fabricColours) {
            if (!seen.has(fc.materialId)) {
                seen.set(fc.materialId, fc.materialName);
            }
        }
        return Array.from(seen.entries()).map(([id, name]) => ({ id, name }));
    }, [catalog?.fabricColours]);

    // Merge static + DB categories, deduplicated
    const allCategories = useMemo(() => {
        const set = new Set<string>([...PRODUCT_CATEGORIES]);
        if (catalog?.categories) {
            catalog.categories.forEach(c => set.add(c));
        }
        return Array.from(set).sort();
    }, [catalog?.categories]);

    // Form state
    const [name, setName] = useState('');
    const [description, setDescription] = useState('');
    const [imageUrl, setImageUrl] = useState('');
    const [category, setCategory] = useState('');
    const [productType, setProductType] = useState('');
    const [gender, setGender] = useState('Women');
    const [selectedMaterialId, setSelectedMaterialId] = useState('');
    const [mrp, setMrp] = useState<string>('');
    const [fabricConsumption, setFabricConsumption] = useState<string>('');
    const [sizes, setSizes] = useState<string[]>([...DEFAULT_SIZES]);
    const [variations, setVariations] = useState<
        Array<{ colorName: string; colorHex: string; hasLining: boolean; fabricColourId: string }>
    >([{ colorName: '', colorHex: '#000000', hasLining: false, fabricColourId: '' }]);
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
            { colorName: '', colorHex: '#000000', hasLining: false, fabricColourId: '' },
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
                    ...(imageUrl.trim()
                        ? { imageUrl: imageUrl.trim() }
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
                        ...(v.fabricColourId
                            ? { fabricColourId: v.fabricColourId }
                            : {}),
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
                            <Input
                                id="category"
                                list="category-options"
                                value={category}
                                onChange={(e) => setCategory(e.target.value)}
                                placeholder="Select or type category"
                            />
                            <datalist id="category-options">
                                {allCategories.map((cat) => (
                                    <option key={cat} value={cat} />
                                ))}
                            </datalist>
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
                            <Label htmlFor="material">Material</Label>
                            <Select
                                value={selectedMaterialId || '__all__'}
                                onValueChange={(v) => setSelectedMaterialId(v === '__all__' ? '' : v)}
                            >
                                <SelectTrigger id="material">
                                    <SelectValue placeholder="All materials" />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="__all__">All materials</SelectItem>
                                    {materials.map((m) => (
                                        <SelectItem key={m.id} value={m.id}>
                                            {m.name}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                            <p className="text-xs text-muted-foreground">
                                Filters fabric colours below
                            </p>
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

                    <div className="space-y-2">
                        <Label htmlFor="imageUrl">Sample Image URL</Label>
                        <Input
                            id="imageUrl"
                            type="url"
                            value={imageUrl}
                            onChange={(e) => setImageUrl(e.target.value)}
                            placeholder="https://..."
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

                            {catalog?.fabricColours && (
                                <FabricColourPicker
                                    fabricColours={catalog.fabricColours}
                                    materialId={selectedMaterialId}
                                    value={variation.fabricColourId}
                                    onChange={(id) => updateVariation(index, 'fabricColourId', id)}
                                />
                            )}

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
                                    {v.fabricColourId && catalog?.fabricColours && (
                                        <span className="text-muted-foreground text-xs">
                                            ({catalog.fabricColours.find(fc => fc.id === v.fabricColourId)?.name})
                                        </span>
                                    )}
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
