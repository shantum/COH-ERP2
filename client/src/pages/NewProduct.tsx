/**
 * NewProduct Page
 *
 * Full-page form for creating a new product with variations (colors)
 * and auto-generated SKUs. Creates the complete Product -> Variation -> SKU
 * hierarchy in a single server call.
 */

import { useState, useMemo, useCallback, useRef } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { useServerFn } from '@tanstack/react-start';
import { useQuery } from '@tanstack/react-query';
import { createProductDraft, getNextSkuCode } from '../server/functions/productsMutations';
import { getCatalogFilters } from '../server/functions/products';
import { SIZE_ORDER } from '../constants/sizes';
import { PRODUCT_CATEGORIES, GENDERS, GENDER_LABELS } from '../components/products/types';

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
import { ArrowLeft, Plus, X, Loader2, ChevronsUpDown, Upload, Image as ImageIcon, Pencil, Trash2, Check } from 'lucide-react';

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

// --- Image Dropzone ---

function ImageDropzone({
    imageUrl,
    imagePreview,
    onFileSelect,
    onUrlChange,
    onClear,
}: {
    imageUrl: string;
    imagePreview: string;
    onFileSelect: (file: File) => void;
    onUrlChange: (url: string) => void;
    onClear: () => void;
}) {
    const fileInputRef = useRef<HTMLInputElement>(null);
    const [isDragging, setIsDragging] = useState(false);
    const [showUrlInput, setShowUrlInput] = useState(false);

    const displayImage = imagePreview || imageUrl;

    const handleDragOver = useCallback((e: React.DragEvent) => {
        e.preventDefault();
        e.stopPropagation();
        setIsDragging(true);
    }, []);

    const handleDragLeave = useCallback((e: React.DragEvent) => {
        e.preventDefault();
        e.stopPropagation();
        setIsDragging(false);
    }, []);

    const handleDrop = useCallback((e: React.DragEvent) => {
        e.preventDefault();
        e.stopPropagation();
        setIsDragging(false);
        const file = e.dataTransfer.files[0];
        if (file && file.type.startsWith('image/')) {
            onFileSelect(file);
        }
    }, [onFileSelect]);

    const handleFileChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (file) {
            onFileSelect(file);
        }
    }, [onFileSelect]);

    if (displayImage) {
        return (
            <div className="space-y-2">
                <Label>Product Image</Label>
                <div className="relative inline-block">
                    <img
                        src={displayImage}
                        alt="Product preview"
                        className="h-32 w-32 object-cover rounded-lg border"
                    />
                    <button
                        type="button"
                        onClick={onClear}
                        className="absolute -top-2 -right-2 h-6 w-6 rounded-full bg-red-500 text-white flex items-center justify-center hover:bg-red-600 shadow"
                    >
                        <X className="h-3 w-3" />
                    </button>
                </div>
            </div>
        );
    }

    return (
        <div className="space-y-2">
            <Label>Product Image</Label>
            <div
                onClick={() => fileInputRef.current?.click()}
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
                onDrop={handleDrop}
                className={`flex flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed p-6 cursor-pointer transition-colors ${
                    isDragging
                        ? 'border-primary bg-primary/5'
                        : 'border-muted-foreground/25 hover:border-muted-foreground/50'
                }`}
            >
                <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/*"
                    onChange={handleFileChange}
                    className="hidden"
                />
                <div className="flex items-center gap-2 text-muted-foreground">
                    <Upload className="h-5 w-5" />
                    <ImageIcon className="h-5 w-5" />
                </div>
                <p className="text-sm text-muted-foreground">
                    Drop image here or click to upload
                </p>
                <p className="text-xs text-muted-foreground">
                    JPG, PNG, WebP up to 5MB
                </p>
            </div>
            {showUrlInput ? (
                <div className="flex gap-2">
                    <Input
                        type="url"
                        value={imageUrl}
                        onChange={(e) => onUrlChange(e.target.value)}
                        placeholder="https://..."
                        className="text-sm"
                    />
                    <button
                        type="button"
                        onClick={() => setShowUrlInput(false)}
                        className="text-xs text-muted-foreground hover:text-foreground"
                    >
                        Cancel
                    </button>
                </div>
            ) : (
                <button
                    type="button"
                    onClick={() => setShowUrlInput(true)}
                    className="text-xs text-primary hover:underline"
                >
                    or paste image URL
                </button>
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

    // Next SKU code for preview
    const { data: skuCodeData } = useQuery({
        queryKey: ['products', 'nextSkuCode', 'getNextSkuCode'],
        queryFn: () => getNextSkuCode(),
    });

    // Derive unique materials from fabric colours
    const materials = useMemo(() => {
        if (!catalog?.fabricColours) return [];
        const seen = new Map<string, string>();
        for (const fc of catalog.fabricColours) {
            if (fc.materialId && !seen.has(fc.materialId)) {
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
    const [styleCode, setStyleCode] = useState('');
    const [description, setDescription] = useState('');
    const [imageUrl, setImageUrl] = useState('');
    const [imageFile, setImageFile] = useState<File | null>(null);
    const [imagePreview, setImagePreview] = useState('');
    const [category, setCategory] = useState('');
    const [gender, setGender] = useState('women');
    const [fabricType, setFabricType] = useState<'woven' | 'knit'>('woven');
    const [selectedMaterialId, setSelectedMaterialId] = useState('');
    const [mrp, setMrp] = useState<string>('');
    const [fabricConsumption, setFabricConsumption] = useState<string>('');
    const [sizes, setSizes] = useState<string[]>([...DEFAULT_SIZES]);
    const [variations, setVariations] = useState<
        Array<{ colorName: string; colorHex: string; hasLining: boolean; fabricColourId: string }>
    >([{ colorName: '', colorHex: '#000000', hasLining: false, fabricColourId: '' }]);
    const [notes, setNotes] = useState<Array<{ id: string; text: string; createdAt: string; updatedAt?: string }>>([]);
    const [newNote, setNewNote] = useState('');
    const [editingNoteId, setEditingNoteId] = useState<string | null>(null);
    const [editingNoteText, setEditingNoteText] = useState('');
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [error, setError] = useState<string | null>(null);

    // --- Image helpers ---

    const handleImageFileSelect = useCallback((file: File) => {
        setImageFile(file);
        setImagePreview(URL.createObjectURL(file));
        setImageUrl('');
    }, []);

    const handleImageUrlChange = useCallback((url: string) => {
        setImageUrl(url);
        setImageFile(null);
        if (imagePreview) {
            URL.revokeObjectURL(imagePreview);
            setImagePreview('');
        }
    }, [imagePreview]);

    const handleImageClear = useCallback(() => {
        setImageFile(null);
        setImageUrl('');
        if (imagePreview) {
            URL.revokeObjectURL(imagePreview);
            setImagePreview('');
        }
    }, [imagePreview]);

    // --- Note helpers ---

    const addNote = useCallback(() => {
        if (!newNote.trim()) return;
        const now = new Date().toISOString();
        setNotes(prev => [{
            id: crypto.randomUUID(),
            text: newNote.trim(),
            createdAt: now,
        }, ...prev]);
        setNewNote('');
    }, [newNote]);

    const deleteNote = useCallback((id: string) => {
        setNotes(prev => prev.filter(n => n.id !== id));
    }, []);

    const startEditNote = useCallback((note: { id: string; text: string }) => {
        setEditingNoteId(note.id);
        setEditingNoteText(note.text);
    }, []);

    const saveEditNote = useCallback(() => {
        if (!editingNoteId || !editingNoteText.trim()) return;
        setNotes(prev => prev.map(n =>
            n.id === editingNoteId
                ? { ...n, text: editingNoteText.trim(), updatedAt: new Date().toISOString() }
                : n
        ));
        setEditingNoteId(null);
        setEditingNoteText('');
    }, [editingNoteId, editingNoteText]);

    const cancelEditNote = useCallback(() => {
        setEditingNoteId(null);
        setEditingNoteText('');
    }, []);

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

    // Compute predicted SKU codes
    const skuPreview = useMemo(() => {
        if (!skuCodeData?.nextCode || validVariations.length === 0 || sizes.length === 0) {
            return [];
        }
        const items: Array<{ color: string; colorHex: string; size: string; code: string }> = [];
        let counter = skuCodeData.nextCode;
        for (const v of validVariations) {
            for (const size of sizes) {
                items.push({
                    color: v.colorName.trim(),
                    colorHex: v.colorHex,
                    size,
                    code: String(counter++).padStart(8, '0'),
                });
            }
        }
        return items;
    }, [skuCodeData?.nextCode, validVariations, sizes]);

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
            // Upload image file if selected
            let finalImageUrl = imageUrl.trim();
            if (imageFile) {
                const formData = new FormData();
                formData.append('image', imageFile);
                const uploadRes = await fetch('/api/uploads/images', {
                    method: 'POST',
                    body: formData,
                });
                if (!uploadRes.ok) {
                    const errData = await uploadRes.json().catch(() => ({ error: 'Upload failed' }));
                    throw new Error(errData.error || 'Image upload failed');
                }
                const uploadData = await uploadRes.json();
                finalImageUrl = uploadData.url;
            }

            const result = await createDraftFn({
                data: {
                    name: name.trim(),
                    ...(description.trim()
                        ? { description: description.trim() }
                        : {}),
                    ...(finalImageUrl
                        ? { imageUrl: finalImageUrl }
                        : {}),
                    ...(styleCode.trim()
                        ? { styleCode: styleCode.trim() }
                        : {}),
                    category,
                    gender,
                    ...(mrp ? { mrp: Number(mrp) } : {}),
                    ...(fabricConsumption
                        ? { defaultFabricConsumption: Number(fabricConsumption) }
                        : {}),
                    ...(notes.length > 0 ? { notes } : {}),
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

    // --- Fabric consumption label/placeholder based on fabric type ---
    const fabricConsumptionLabel = fabricType === 'knit'
        ? 'Default Fabric Consumption (kg)'
        : 'Default Fabric Consumption (m)';
    const fabricConsumptionPlaceholder = fabricType === 'knit' ? 'kg' : 'meters';
    const fabricConsumptionHint = fabricType === 'knit'
        ? 'In kilograms (optional)'
        : 'In meters (optional)';

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
                            />
                        </div>

                        <div className="space-y-2">
                            <Label htmlFor="styleCode">Style Code</Label>
                            <Input
                                id="styleCode"
                                value={styleCode}
                                onChange={(e) => setStyleCode(e.target.value)}
                                placeholder="e.g. SC-001"
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
                            <Label htmlFor="gender">Gender</Label>
                            <Select value={gender} onValueChange={setGender}>
                                <SelectTrigger id="gender">
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                    {GENDERS.map((g) => (
                                        <SelectItem key={g} value={g}>
                                            {GENDER_LABELS[g]}
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
                            <Label>Fabric Type</Label>
                            <div className="flex gap-1 rounded-lg border p-1">
                                <button
                                    type="button"
                                    onClick={() => setFabricType('woven')}
                                    className={`flex-1 rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
                                        fabricType === 'woven'
                                            ? 'bg-primary text-primary-foreground shadow-sm'
                                            : 'text-muted-foreground hover:text-foreground'
                                    }`}
                                >
                                    Woven
                                </button>
                                <button
                                    type="button"
                                    onClick={() => setFabricType('knit')}
                                    className={`flex-1 rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
                                        fabricType === 'knit'
                                            ? 'bg-primary text-primary-foreground shadow-sm'
                                            : 'text-muted-foreground hover:text-foreground'
                                    }`}
                                >
                                    Knit
                                </button>
                            </div>
                        </div>

                        <div className="space-y-2">
                            <Label htmlFor="mrp">MRP</Label>
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
                                {fabricConsumptionLabel}
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
                                placeholder={fabricConsumptionPlaceholder}
                            />
                            <p className="text-xs text-muted-foreground">
                                {fabricConsumptionHint}
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

                    <ImageDropzone
                        imageUrl={imageUrl}
                        imagePreview={imagePreview}
                        onFileSelect={handleImageFileSelect}
                        onUrlChange={handleImageUrlChange}
                        onClear={handleImageClear}
                    />
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

            {/* Notes */}
            <Card>
                <CardHeader>
                    <CardTitle>Notes</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                    {/* Add note input */}
                    <div className="flex gap-2">
                        <Textarea
                            value={newNote}
                            onChange={(e) => setNewNote(e.target.value)}
                            placeholder="Add a note..."
                            rows={2}
                            className="flex-1"
                            onKeyDown={(e) => {
                                if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                                    addNote();
                                }
                            }}
                        />
                        <Button
                            variant="outline"
                            size="sm"
                            onClick={addNote}
                            disabled={!newNote.trim()}
                            className="self-end"
                        >
                            <Plus className="mr-1 h-4 w-4" />
                            Add
                        </Button>
                    </div>

                    {/* Notes timeline */}
                    {notes.length > 0 && (
                        <div className="relative space-y-0">
                            {/* Timeline line */}
                            {notes.length > 1 && (
                                <div className="absolute left-[7px] top-3 bottom-3 w-px bg-border" />
                            )}
                            {notes.map((note) => (
                                <div key={note.id} className="relative flex gap-3 py-2">
                                    {/* Timeline dot */}
                                    <div className="relative z-10 mt-1.5 h-[9px] w-[9px] rounded-full bg-primary border-2 border-background ring-2 ring-border flex-shrink-0" />

                                    <div className="flex-1 min-w-0">
                                        {editingNoteId === note.id ? (
                                            <div className="flex gap-2">
                                                <Textarea
                                                    value={editingNoteText}
                                                    onChange={(e) => setEditingNoteText(e.target.value)}
                                                    rows={2}
                                                    className="flex-1 text-sm"
                                                    autoFocus
                                                    onKeyDown={(e) => {
                                                        if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                                                            saveEditNote();
                                                        }
                                                        if (e.key === 'Escape') {
                                                            cancelEditNote();
                                                        }
                                                    }}
                                                />
                                                <div className="flex flex-col gap-1 self-end">
                                                    <Button variant="ghost" size="icon" className="h-7 w-7" onClick={saveEditNote}>
                                                        <Check className="h-3.5 w-3.5" />
                                                    </Button>
                                                    <Button variant="ghost" size="icon" className="h-7 w-7" onClick={cancelEditNote}>
                                                        <X className="h-3.5 w-3.5" />
                                                    </Button>
                                                </div>
                                            </div>
                                        ) : (
                                            <>
                                                <p className="text-sm whitespace-pre-wrap">{note.text}</p>
                                                <div className="flex items-center gap-2 mt-1">
                                                    <span className="text-xs text-muted-foreground">
                                                        {new Date(note.createdAt).toLocaleString('en-IN', {
                                                            day: 'numeric', month: 'short', year: 'numeric',
                                                            hour: '2-digit', minute: '2-digit',
                                                        })}
                                                    </span>
                                                    {note.updatedAt && (
                                                        <span className="text-xs text-muted-foreground italic">(edited)</span>
                                                    )}
                                                    <button
                                                        type="button"
                                                        onClick={() => startEditNote(note)}
                                                        className="text-muted-foreground hover:text-foreground"
                                                    >
                                                        <Pencil className="h-3 w-3" />
                                                    </button>
                                                    <button
                                                        type="button"
                                                        onClick={() => deleteNote(note.id)}
                                                        className="text-muted-foreground hover:text-red-500"
                                                    >
                                                        <Trash2 className="h-3 w-3" />
                                                    </button>
                                                </div>
                                            </>
                                        )}
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </CardContent>
            </Card>

            {/* Preview */}
            <Card>
                <CardHeader>
                    <CardTitle>Preview</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
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

                    {/* SKU Code Preview */}
                    {skuPreview.length > 0 && (
                        <div className="space-y-2">
                            <h4 className="text-sm font-medium">Predicted SKU Codes</h4>
                            <div className="rounded-md border overflow-hidden">
                                <table className="w-full text-sm">
                                    <thead>
                                        <tr className="bg-muted/50">
                                            <th className="px-3 py-1.5 text-left font-medium">Color</th>
                                            <th className="px-3 py-1.5 text-left font-medium">Size</th>
                                            <th className="px-3 py-1.5 text-left font-medium">SKU Code</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {skuPreview.map((item, i) => (
                                            <tr key={i} className="border-t">
                                                <td className="px-3 py-1 flex items-center gap-1.5">
                                                    {item.colorHex && (
                                                        <span
                                                            className="inline-block h-2.5 w-2.5 rounded-full border flex-shrink-0"
                                                            style={{ backgroundColor: item.colorHex }}
                                                        />
                                                    )}
                                                    {item.color}
                                                </td>
                                                <td className="px-3 py-1">{item.size}</td>
                                                <td className="px-3 py-1 font-mono text-xs">{item.code}</td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    )}
                </CardContent>
            </Card>
        </div>
    );
}
