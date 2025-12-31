import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { productsApi, fabricsApi } from '../services/api';
import { useState } from 'react';
import { Plus, ChevronDown, ChevronRight, X, Pencil } from 'lucide-react';

export default function Products() {
    const queryClient = useQueryClient();
    const { data: products, isLoading } = useQuery({ queryKey: ['products'], queryFn: () => productsApi.getAll().then(r => r.data) });
    const { data: fabrics } = useQuery({ queryKey: ['fabrics'], queryFn: () => fabricsApi.getAll().then(r => r.data) });
    const [expandedProducts, setExpandedProducts] = useState<Set<string>>(new Set());
    const [filter, setFilter] = useState({ category: '', search: '' });
    const [showAddProduct, setShowAddProduct] = useState(false);
    const [showEditProduct, setShowEditProduct] = useState<any>(null);
    const [showAddVariation, setShowAddVariation] = useState<string | null>(null);
    const [showEditVariation, setShowEditVariation] = useState<any>(null);
    const [productForm, setProductForm] = useState({ name: '', category: 'dress', productType: 'basic', baseProductionTimeMins: 60 });
    const [variationForm, setVariationForm] = useState({ colorName: '', colorHex: '#6B8E9F', fabricId: '', sizes: ['XS', 'S', 'M', 'L', 'XL'], mrp: 2500, fabricConsumption: 1.5 });
    const [editVariationForm, setEditVariationForm] = useState<any>({ colorName: '', colorHex: '', fabricId: '', isActive: true, skus: [], newSkus: [] });
    const [newSkuSize, setNewSkuSize] = useState('');
    const [isSubmitting, setIsSubmitting] = useState(false);

    const allSizes = ['XS', 'S', 'M', 'L', 'XL', 'XXL', 'Free'];

    const createProduct = useMutation({
        mutationFn: (data: any) => productsApi.create(data),
        onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['products'] }); setShowAddProduct(false); setProductForm({ name: '', category: 'dress', productType: 'basic', baseProductionTimeMins: 60 }); }
    });

    const updateProduct = useMutation({
        mutationFn: ({ id, data }: { id: string; data: any }) => productsApi.update(id, data),
        onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['products'] }); setShowEditProduct(null); }
    });

    const openEditVariation = (variation: any) => {
        setEditVariationForm({
            colorName: variation.colorName,
            colorHex: variation.colorHex || '#6B8E9F',
            fabricId: variation.fabricId,
            isActive: variation.isActive,
            skus: variation.skus?.map((s: any) => ({ ...s })) || [],
            newSkus: []
        });
        setNewSkuSize('');
        setShowEditVariation(variation);
    };

    const getAvailableSizes = () => {
        const existingSizes = new Set([
            ...editVariationForm.skus.map((s: any) => s.size),
            ...editVariationForm.newSkus.map((s: any) => s.size)
        ]);
        return allSizes.filter(size => !existingSizes.has(size));
    };

    const addNewSku = () => {
        if (!newSkuSize) return;
        const defaultMrp = editVariationForm.skus[0]?.mrp || 2500;
        const defaultFabric = editVariationForm.skus[0]?.fabricConsumption || 1.5;
        setEditVariationForm((f: any) => ({
            ...f,
            newSkus: [...f.newSkus, {
                size: newSkuSize,
                mrp: defaultMrp,
                fabricConsumption: defaultFabric,
                barcode: '',
                isActive: true
            }]
        }));
        setNewSkuSize('');
    };

    const updateNewSkuInForm = (size: string, field: string, value: any) => {
        setEditVariationForm((f: any) => ({
            ...f,
            newSkus: f.newSkus.map((s: any) => s.size === size ? { ...s, [field]: value } : s)
        }));
    };

    const removeNewSku = (size: string) => {
        setEditVariationForm((f: any) => ({
            ...f,
            newSkus: f.newSkus.filter((s: any) => s.size !== size)
        }));
    };

    const handleEditVariation = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!showEditVariation) return;

        setIsSubmitting(true);
        try {
            // Update the variation
            await productsApi.updateVariation(showEditVariation.id, {
                colorName: editVariationForm.colorName,
                colorHex: editVariationForm.colorHex,
                fabricId: editVariationForm.fabricId,
                isActive: editVariationForm.isActive
            });

            // Update each existing SKU
            for (const sku of editVariationForm.skus) {
                await productsApi.updateSku(sku.id, {
                    mrp: sku.mrp,
                    fabricConsumption: sku.fabricConsumption,
                    isActive: sku.isActive,
                    barcode: sku.barcode || null
                });
            }

            // Create new SKUs
            if (editVariationForm.newSkus.length > 0) {
                const product = products?.find((p: any) =>
                    p.variations?.some((v: any) => v.id === showEditVariation.id)
                );
                const productCode = product?.name?.substring(0, 3).toUpperCase() || 'PRD';
                const colorCode = editVariationForm.colorName.substring(0, 3).toUpperCase();

                for (const newSku of editVariationForm.newSkus) {
                    const skuCode = `${productCode}-${colorCode}-${newSku.size}`;
                    await productsApi.createSku(showEditVariation.id, {
                        skuCode,
                        size: newSku.size,
                        mrp: newSku.mrp,
                        fabricConsumption: newSku.fabricConsumption,
                        barcode: newSku.barcode || null
                    });
                }
            }

            queryClient.invalidateQueries({ queryKey: ['products'] });
            setShowEditVariation(null);
        } catch (error) {
            console.error('Failed to update variation:', error);
            alert('Failed to update variation. Please try again.');
        } finally {
            setIsSubmitting(false);
        }
    };

    const updateSkuInForm = (skuId: string, field: string, value: any) => {
        setEditVariationForm((f: any) => ({
            ...f,
            skus: f.skus.map((s: any) => s.id === skuId ? { ...s, [field]: value } : s)
        }));
    };

    const toggleExpand = (id: string) => {
        const newSet = new Set(expandedProducts);
        if (newSet.has(id)) newSet.delete(id);
        else newSet.add(id);
        setExpandedProducts(newSet);
    };

    const filteredProducts = products?.filter((p: any) => {
        if (filter.category && p.category !== filter.category) return false;
        if (filter.search && !p.name.toLowerCase().includes(filter.search.toLowerCase())) return false;
        return true;
    });

    const handleSubmitProduct = (e: React.FormEvent) => {
        e.preventDefault();
        createProduct.mutate(productForm);
    };

    const handleEditProduct = (e: React.FormEvent) => {
        e.preventDefault();
        updateProduct.mutate({ id: showEditProduct.id, data: showEditProduct });
    };

    const openEditProduct = (product: any) => {
        setShowEditProduct({ ...product });
    };

    const handleSubmitVariation = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!showAddVariation || !variationForm.fabricId) return;

        setIsSubmitting(true);
        try {
            const variationRes = await productsApi.createVariation(showAddVariation, {
                colorName: variationForm.colorName,
                colorHex: variationForm.colorHex,
                fabricId: variationForm.fabricId
            });

            const variationId = variationRes.data.id;
            const product = products?.find((p: any) => p.id === showAddVariation);
            const productCode = product?.name?.substring(0, 3).toUpperCase() || 'PRD';
            const colorCode = variationForm.colorName.substring(0, 3).toUpperCase();

            for (const size of variationForm.sizes) {
                const skuCode = `${productCode}-${colorCode}-${size}`;
                await productsApi.createSku(variationId, {
                    skuCode,
                    size,
                    fabricConsumption: variationForm.fabricConsumption,
                    mrp: variationForm.mrp
                });
            }

            queryClient.invalidateQueries({ queryKey: ['products'] });
            setShowAddVariation(null);
            setVariationForm({ colorName: '', colorHex: '#6B8E9F', fabricId: '', sizes: ['XS', 'S', 'M', 'L', 'XL'], mrp: 2500, fabricConsumption: 1.5 });
        } catch (error) {
            console.error('Failed to create variation:', error);
            alert('Failed to create variation. Please try again.');
        } finally {
            setIsSubmitting(false);
        }
    };

    if (isLoading) return <div className="flex justify-center p-8"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600"></div></div>;

    return (
        <div className="space-y-6">
            <div className="flex items-center justify-between">
                <h1 className="text-2xl font-bold text-gray-900">Products</h1>
                <button onClick={() => setShowAddProduct(true)} className="btn-primary flex items-center"><Plus size={20} className="mr-2" />Add Product</button>
            </div>

            {/* Filters */}
            <div className="card flex flex-wrap gap-4">
                <input type="text" placeholder="Search products..." className="input max-w-xs" value={filter.search} onChange={(e) => setFilter(f => ({ ...f, search: e.target.value }))} />
                <select className="input max-w-xs" value={filter.category} onChange={(e) => setFilter(f => ({ ...f, category: e.target.value }))}>
                    <option value="">All Categories</option>
                    <option value="dress">Dress</option>
                    <option value="top">Top</option>
                    <option value="bottom">Bottom</option>
                    <option value="outerwear">Outerwear</option>
                </select>
            </div>

            {/* Products List */}
            <div className="space-y-4">
                {filteredProducts?.map((product: any) => (
                    <div key={product.id} className="card">
                        <div className="flex items-center justify-between cursor-pointer" onClick={() => toggleExpand(product.id)}>
                            <div className="flex items-center">
                                {expandedProducts.has(product.id) ? <ChevronDown size={20} className="mr-2 text-gray-400" /> : <ChevronRight size={20} className="mr-2 text-gray-400" />}
                                <div>
                                    <h3 className="font-semibold text-gray-900">{product.name}</h3>
                                    <p className="text-sm text-gray-500">{product.category} • {product.productType} • {product.baseProductionTimeMins} mins</p>
                                </div>
                            </div>
                            <div className="flex items-center gap-4">
                                <span className="text-sm text-gray-500">{product.variations?.length || 0} variations</span>
                                <span className={`badge ${product.isActive ? 'badge-success' : 'badge-danger'}`}>{product.isActive ? 'Active' : 'Inactive'}</span>
                                <button onClick={(e) => { e.stopPropagation(); openEditProduct(product); }} className="text-gray-400 hover:text-gray-600"><Pencil size={16} /></button>
                            </div>
                        </div>

                        {expandedProducts.has(product.id) && (
                            <div className="mt-4 border-t pt-4 space-y-3">
                                {product.variations?.map((v: any) => (
                                    <div key={v.id} className="ml-6 p-3 bg-gray-50 rounded-lg">
                                        <div className="flex items-center justify-between">
                                            <div className="flex items-center">
                                                <div className="w-6 h-6 rounded-full border-2 border-gray-300 mr-3" style={{ backgroundColor: v.colorHex || '#ccc' }} />
                                                <div>
                                                    <p className="font-medium">{v.colorName}</p>
                                                    <p className="text-xs text-gray-500">{v.fabric?.name}</p>
                                                </div>
                                            </div>
                                            <div className="flex items-center gap-2">
                                                <span className="text-sm text-gray-500">{v.skus?.length || 0} SKUs</span>
                                                <button onClick={(e) => { e.stopPropagation(); openEditVariation(v); }} className="text-gray-400 hover:text-gray-600"><Pencil size={14} /></button>
                                            </div>
                                        </div>
                                        {v.skus?.length > 0 && (
                                            <div className="mt-2 flex flex-wrap gap-2">
                                                {v.skus.map((s: any) => (
                                                    <span key={s.id} className="px-2 py-1 bg-white rounded text-xs border" title={s.barcode ? `Barcode: ${s.barcode}` : 'No barcode'}>
                                                        <span className="font-medium">{s.size}</span> • ₹{Number(s.mrp).toLocaleString()}
                                                        {s.barcode && <span className="text-gray-400 ml-1">#{s.barcode}</span>}
                                                    </span>
                                                ))}
                                            </div>
                                        )}
                                    </div>
                                ))}
                                <button onClick={(e) => { e.stopPropagation(); setShowAddVariation(product.id); }} className="ml-6 text-sm text-primary-600 hover:underline flex items-center">
                                    <Plus size={16} className="mr-1" /> Add Variation
                                </button>
                            </div>
                        )}
                    </div>
                ))}
            </div>

            {/* Add Product Modal */}
            {showAddProduct && (
                <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
                    <div className="bg-white rounded-xl p-6 w-full max-w-md">
                        <div className="flex items-center justify-between mb-4">
                            <h2 className="text-lg font-semibold">Add New Product</h2>
                            <button onClick={() => setShowAddProduct(false)} className="text-gray-400 hover:text-gray-600"><X size={20} /></button>
                        </div>
                        <form onSubmit={handleSubmitProduct} className="space-y-4">
                            <div>
                                <label className="label">Product Name</label>
                                <input className="input" value={productForm.name} onChange={(e) => setProductForm(f => ({ ...f, name: e.target.value }))} placeholder="e.g., Linen MIDI Dress" required />
                            </div>
                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <label className="label">Category</label>
                                    <select className="input" value={productForm.category} onChange={(e) => setProductForm(f => ({ ...f, category: e.target.value }))}>
                                        <option value="dress">Dress</option>
                                        <option value="top">Top</option>
                                        <option value="bottom">Bottom</option>
                                        <option value="outerwear">Outerwear</option>
                                        <option value="accessory">Accessory</option>
                                    </select>
                                </div>
                                <div>
                                    <label className="label">Type</label>
                                    <select className="input" value={productForm.productType} onChange={(e) => setProductForm(f => ({ ...f, productType: e.target.value }))}>
                                        <option value="basic">Basic</option>
                                        <option value="seasonal">Seasonal</option>
                                        <option value="limited">Limited</option>
                                    </select>
                                </div>
                            </div>
                            <div>
                                <label className="label">Production Time (mins)</label>
                                <input type="number" className="input" value={productForm.baseProductionTimeMins} onChange={(e) => setProductForm(f => ({ ...f, baseProductionTimeMins: Number(e.target.value) }))} min={1} />
                            </div>
                            <div className="flex gap-3 pt-2">
                                <button type="button" onClick={() => setShowAddProduct(false)} className="btn-secondary flex-1">Cancel</button>
                                <button type="submit" className="btn-primary flex-1" disabled={createProduct.isPending}>{createProduct.isPending ? 'Creating...' : 'Create Product'}</button>
                            </div>
                        </form>
                    </div>
                </div>
            )}

            {/* Edit Product Modal */}
            {showEditProduct && (
                <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
                    <div className="bg-white rounded-xl p-6 w-full max-w-md">
                        <div className="flex items-center justify-between mb-4">
                            <h2 className="text-lg font-semibold">Edit Product</h2>
                            <button onClick={() => setShowEditProduct(null)} className="text-gray-400 hover:text-gray-600"><X size={20} /></button>
                        </div>
                        <form onSubmit={handleEditProduct} className="space-y-4">
                            <div>
                                <label className="label">Product Name</label>
                                <input className="input" value={showEditProduct.name} onChange={(e) => setShowEditProduct((p: any) => ({ ...p, name: e.target.value }))} required />
                            </div>
                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <label className="label">Category</label>
                                    <select className="input" value={showEditProduct.category} onChange={(e) => setShowEditProduct((p: any) => ({ ...p, category: e.target.value }))}>
                                        <option value="dress">Dress</option>
                                        <option value="top">Top</option>
                                        <option value="bottom">Bottom</option>
                                        <option value="outerwear">Outerwear</option>
                                        <option value="accessory">Accessory</option>
                                    </select>
                                </div>
                                <div>
                                    <label className="label">Type</label>
                                    <select className="input" value={showEditProduct.productType} onChange={(e) => setShowEditProduct((p: any) => ({ ...p, productType: e.target.value }))}>
                                        <option value="basic">Basic</option>
                                        <option value="seasonal">Seasonal</option>
                                        <option value="limited">Limited</option>
                                    </select>
                                </div>
                            </div>
                            <div>
                                <label className="label">Production Time (mins)</label>
                                <input type="number" className="input" value={showEditProduct.baseProductionTimeMins} onChange={(e) => setShowEditProduct((p: any) => ({ ...p, baseProductionTimeMins: Number(e.target.value) }))} min={1} />
                            </div>
                            <div>
                                <label className="flex items-center gap-2">
                                    <input type="checkbox" checked={showEditProduct.isActive} onChange={(e) => setShowEditProduct((p: any) => ({ ...p, isActive: e.target.checked }))} className="rounded border-gray-300" />
                                    <span className="text-sm">Active</span>
                                </label>
                            </div>
                            <div className="flex gap-3 pt-2">
                                <button type="button" onClick={() => setShowEditProduct(null)} className="btn-secondary flex-1">Cancel</button>
                                <button type="submit" className="btn-primary flex-1" disabled={updateProduct.isPending}>{updateProduct.isPending ? 'Saving...' : 'Save Changes'}</button>
                            </div>
                        </form>
                    </div>
                </div>
            )}

            {/* Add Variation Modal */}
            {showAddVariation && (
                <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
                    <div className="bg-white rounded-xl p-6 w-full max-w-lg">
                        <div className="flex items-center justify-between mb-4">
                            <h2 className="text-lg font-semibold">Add Variation</h2>
                            <button onClick={() => setShowAddVariation(null)} className="text-gray-400 hover:text-gray-600"><X size={20} /></button>
                        </div>
                        <form onSubmit={handleSubmitVariation} className="space-y-4">
                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <label className="label">Color Name</label>
                                    <input className="input" value={variationForm.colorName} onChange={(e) => setVariationForm(f => ({ ...f, colorName: e.target.value }))} placeholder="e.g., Wildflower Blue" required />
                                </div>
                                <div>
                                    <label className="label">Color</label>
                                    <input type="color" className="input h-10" value={variationForm.colorHex} onChange={(e) => setVariationForm(f => ({ ...f, colorHex: e.target.value }))} />
                                </div>
                            </div>
                            <div>
                                <label className="label">Fabric</label>
                                <select className="input" value={variationForm.fabricId} onChange={(e) => setVariationForm(f => ({ ...f, fabricId: e.target.value }))} required>
                                    <option value="">Select fabric...</option>
                                    {fabrics?.map((f: any) => <option key={f.id} value={f.id}>{f.name} - {f.colorName}</option>)}
                                </select>
                            </div>
                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <label className="label">MRP (₹)</label>
                                    <input type="number" className="input" value={variationForm.mrp} onChange={(e) => setVariationForm(f => ({ ...f, mrp: Number(e.target.value) }))} min={0} />
                                </div>
                                <div>
                                    <label className="label">Fabric (meters)</label>
                                    <input type="number" step="0.1" className="input" value={variationForm.fabricConsumption} onChange={(e) => setVariationForm(f => ({ ...f, fabricConsumption: Number(e.target.value) }))} min={0} />
                                </div>
                            </div>
                            <div>
                                <label className="label">Sizes (SKUs will be created for each)</label>
                                <div className="flex gap-2 flex-wrap">
                                    {['XS', 'S', 'M', 'L', 'XL', 'XXL', 'Free'].map(size => (
                                        <label key={size} className="flex items-center gap-1">
                                            <input type="checkbox" checked={variationForm.sizes.includes(size)} onChange={(e) => {
                                                if (e.target.checked) setVariationForm(f => ({ ...f, sizes: [...f.sizes, size] }));
                                                else setVariationForm(f => ({ ...f, sizes: f.sizes.filter(s => s !== size) }));
                                            }} className="rounded border-gray-300" />
                                            <span className="text-sm">{size}</span>
                                        </label>
                                    ))}
                                </div>
                            </div>
                            <div className="flex gap-3 pt-2">
                                <button type="button" onClick={() => setShowAddVariation(null)} className="btn-secondary flex-1">Cancel</button>
                                <button type="submit" className="btn-primary flex-1" disabled={isSubmitting}>{isSubmitting ? 'Creating...' : 'Add Variation'}</button>
                            </div>
                        </form>
                    </div>
                </div>
            )}

            {/* Edit Variation Modal */}
            {showEditVariation && (
                <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
                    <div className="bg-white rounded-xl p-6 w-full max-w-lg max-h-[90vh] overflow-y-auto">
                        <div className="flex items-center justify-between mb-4">
                            <h2 className="text-lg font-semibold">Edit Variation</h2>
                            <button onClick={() => setShowEditVariation(null)} className="text-gray-400 hover:text-gray-600"><X size={20} /></button>
                        </div>
                        <form onSubmit={handleEditVariation} className="space-y-4">
                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <label className="label">Color Name</label>
                                    <input className="input" value={editVariationForm.colorName} onChange={(e) => setEditVariationForm((f: any) => ({ ...f, colorName: e.target.value }))} required />
                                </div>
                                <div>
                                    <label className="label">Color</label>
                                    <input type="color" className="input h-10" value={editVariationForm.colorHex} onChange={(e) => setEditVariationForm((f: any) => ({ ...f, colorHex: e.target.value }))} />
                                </div>
                            </div>
                            <div>
                                <label className="label">Fabric</label>
                                <select className="input" value={editVariationForm.fabricId} onChange={(e) => setEditVariationForm((f: any) => ({ ...f, fabricId: e.target.value }))} required>
                                    <option value="">Select fabric...</option>
                                    {fabrics?.map((f: any) => <option key={f.id} value={f.id}>{f.name} - {f.colorName}</option>)}
                                </select>
                            </div>
                            <div>
                                <label className="flex items-center gap-2">
                                    <input type="checkbox" checked={editVariationForm.isActive} onChange={(e) => setEditVariationForm((f: any) => ({ ...f, isActive: e.target.checked }))} className="rounded border-gray-300" />
                                    <span className="text-sm">Active</span>
                                </label>
                            </div>

                            {/* SKU Pricing Section */}
                            {editVariationForm.skus?.length > 0 && (
                                <div className="border-t pt-4">
                                    <label className="label mb-3">Existing SKUs</label>
                                    <div className="space-y-3">
                                        {editVariationForm.skus.map((sku: any) => (
                                            <div key={sku.id} className="p-3 bg-gray-50 rounded-lg space-y-2">
                                                <div className="flex items-center gap-3">
                                                    <span className="font-medium text-sm w-12">{sku.size}</span>
                                                    <div className="flex-1">
                                                        <label className="text-xs text-gray-500">MRP (₹)</label>
                                                        <input type="number" className="input input-sm" value={sku.mrp} onChange={(e) => updateSkuInForm(sku.id, 'mrp', Number(e.target.value))} min={0} />
                                                    </div>
                                                    <div className="flex-1">
                                                        <label className="text-xs text-gray-500">Fabric (m)</label>
                                                        <input type="number" step="0.1" className="input input-sm" value={sku.fabricConsumption} onChange={(e) => updateSkuInForm(sku.id, 'fabricConsumption', Number(e.target.value))} min={0} />
                                                    </div>
                                                    <div className="flex items-center pt-4">
                                                        <label className="flex items-center gap-1">
                                                            <input type="checkbox" checked={sku.isActive} onChange={(e) => updateSkuInForm(sku.id, 'isActive', e.target.checked)} className="rounded border-gray-300" />
                                                            <span className="text-xs">Active</span>
                                                        </label>
                                                    </div>
                                                </div>
                                                <div className="ml-12">
                                                    <label className="text-xs text-gray-500">Barcode (8 digits)</label>
                                                    <input type="text" className="input input-sm w-40" value={sku.barcode || ''} onChange={(e) => updateSkuInForm(sku.id, 'barcode', e.target.value)} placeholder="e.g., 10000001" maxLength={8} pattern="[0-9]{8}" />
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            )}

                            {/* New SKUs Section */}
                            {editVariationForm.newSkus?.length > 0 && (
                                <div className="border-t pt-4">
                                    <label className="label mb-3">New Sizes to Add</label>
                                    <div className="space-y-3">
                                        {editVariationForm.newSkus.map((sku: any) => (
                                            <div key={sku.size} className="p-3 bg-green-50 border border-green-200 rounded-lg space-y-2">
                                                <div className="flex items-center gap-3">
                                                    <span className="font-medium text-sm w-12 text-green-700">{sku.size}</span>
                                                    <div className="flex-1">
                                                        <label className="text-xs text-gray-500">MRP (₹)</label>
                                                        <input type="number" className="input input-sm" value={sku.mrp} onChange={(e) => updateNewSkuInForm(sku.size, 'mrp', Number(e.target.value))} min={0} />
                                                    </div>
                                                    <div className="flex-1">
                                                        <label className="text-xs text-gray-500">Fabric (m)</label>
                                                        <input type="number" step="0.1" className="input input-sm" value={sku.fabricConsumption} onChange={(e) => updateNewSkuInForm(sku.size, 'fabricConsumption', Number(e.target.value))} min={0} />
                                                    </div>
                                                    <button type="button" onClick={() => removeNewSku(sku.size)} className="text-red-500 hover:text-red-700 pt-4">
                                                        <X size={16} />
                                                    </button>
                                                </div>
                                                <div className="ml-12">
                                                    <label className="text-xs text-gray-500">Barcode (8 digits)</label>
                                                    <input type="text" className="input input-sm w-40" value={sku.barcode || ''} onChange={(e) => updateNewSkuInForm(sku.size, 'barcode', e.target.value)} placeholder="e.g., 10000001" maxLength={8} />
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            )}

                            {/* Add New Size */}
                            {getAvailableSizes().length > 0 && (
                                <div className="border-t pt-4">
                                    <label className="label mb-2">Add New Size</label>
                                    <div className="flex gap-2">
                                        <select className="input flex-1" value={newSkuSize} onChange={(e) => setNewSkuSize(e.target.value)}>
                                            <option value="">Select size...</option>
                                            {getAvailableSizes().map(size => (
                                                <option key={size} value={size}>{size}</option>
                                            ))}
                                        </select>
                                        <button type="button" onClick={addNewSku} disabled={!newSkuSize} className="btn-secondary flex items-center">
                                            <Plus size={16} className="mr-1" /> Add
                                        </button>
                                    </div>
                                </div>
                            )}

                            <div className="flex gap-3 pt-2">
                                <button type="button" onClick={() => setShowEditVariation(null)} className="btn-secondary flex-1">Cancel</button>
                                <button type="submit" className="btn-primary flex-1" disabled={isSubmitting}>{isSubmitting ? 'Saving...' : 'Save Changes'}</button>
                            </div>
                        </form>
                    </div>
                </div>
            )}
        </div>
    );
}
