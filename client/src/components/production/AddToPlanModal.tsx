import { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useServerFn } from '@tanstack/react-start';
import { getProductsList } from '@/server/functions/products';
import { createBatch } from '@/server/functions/productionMutations';
import { getTodayString } from '@/components/orders/OrdersTable/utils/dateFormatters';
import { invalidateOrderView } from '@/hooks/orders/orderMutationUtils';
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogFooter,
} from '@/components/ui/dialog';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Search, FlaskConical, Package, X, Loader2 } from 'lucide-react';
import { getOptimizedImageUrl } from '@/utils/imageOptimization';
import type { SkuRow, VariationRow, ProductWithVariations } from '@coh/shared';

/** Flattened SKU with nested variation+product for display in the search dropdown */
interface FlattenedSku extends SkuRow {
    variation: VariationRow & {
        product: ProductWithVariations;
    };
}

interface AddToPlanModalProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    defaultDate?: string;
    lockedDates?: string[];
}

export function AddToPlanModal({
    open,
    onOpenChange,
    defaultDate,
    lockedDates = [],
}: AddToPlanModalProps) {
    const queryClient = useQueryClient();
    const today = getTodayString(); // Use local date to avoid timezone issues

    // State
    const [activeTab, setActiveTab] = useState<'existing' | 'sample'>('existing');
    const [batchDate, setBatchDate] = useState(defaultDate || today);
    const [qty, setQty] = useState(1);

    // Existing product state - unified search
    const [skuId, setSkuId] = useState('');
    const [searchQuery, setSearchQuery] = useState('');
    const [showDropdown, setShowDropdown] = useState(false);

    // Sample state
    const [sampleName, setSampleName] = useState('');
    const [sampleColour, setSampleColour] = useState('');
    const [sampleSize, setSampleSize] = useState('');

    // Fetch all SKUs when modal is open
    const getProductsListFn = useServerFn(getProductsList);
    const allSkusQueryResult = useQuery({
        queryKey: ['products', 'list', { limit: 1000 }],
        queryFn: () => getProductsListFn({ data: { limit: 1000 } }),
        enabled: open,
        staleTime: 60000,
        select: (data): FlattenedSku[] => {
            const skus: FlattenedSku[] = [];
            data.products.forEach((product) => {
                product.variations?.forEach((variation) => {
                    variation.skus?.forEach((sku) => {
                        skus.push({
                            ...sku,
                            // Include variation with product reference for display
                            variation: {
                                ...variation,
                                product, // Add product for sku.variation.product.name access
                            },
                        });
                    });
                });
            });
            return skus;
        }
    });
    const allSkus = allSkusQueryResult.data;
    const isLoadingSkus = allSkusQueryResult.isLoading;

    // Helper to get image URL (variation image or fallback to product image)
    const getSkuImageUrl = (sku: FlattenedSku): string | null => {
        return sku.variation?.imageUrl || sku.variation?.product?.imageUrl || null;
    };

    // Create batch mutation using Server Function
    const createBatchFn = useServerFn(createBatch);
    const createBatchMutation = useMutation({
        mutationFn: async (input: {
            skuId?: string;
            sampleName?: string;
            sampleColour?: string;
            sampleSize?: string;
            quantity: number;
            priority: 'low' | 'normal' | 'high' | 'urgent' | 'order_fulfillment';
            batchDate: string;
        }) => {
            const result = await createBatchFn({ data: input });
            if (!result.success) {
                throw new Error(result.error?.message || 'Failed to create batch');
            }
            return result.data;
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['production'] });
            // Production batch affects all view (shows production batch info)
            invalidateOrderView(queryClient, 'all');
            resetForm();
            onOpenChange(false);
        },
        onError: (error: Error) => {
            alert(error.message || 'Failed to add item');
        }
    });

    const resetForm = () => {
        setActiveTab('existing');
        setBatchDate(defaultDate || today);
        setQty(1);
        setSkuId('');
        setSearchQuery('');
        setShowDropdown(false);
        setSampleName('');
        setSampleColour('');
        setSampleSize('');
    };

    // Unified search - filter SKUs by any field
    const filteredSkus = useMemo(() => {
        if (!allSkus || !searchQuery.trim()) return [];
        const search = searchQuery.toLowerCase().trim();
        return allSkus
            .filter((sku) => {
                const skuCode = sku.skuCode?.toLowerCase() || '';
                const productName = sku.variation?.product?.name?.toLowerCase() || '';
                const colorName = sku.variation?.colorName?.toLowerCase() || '';
                const size = sku.size?.toLowerCase() || '';
                return skuCode.includes(search) || productName.includes(search) || colorName.includes(search) || size.includes(search);
            })
            .slice(0, 20);
    }, [allSkus, searchQuery]);

    // Get selected SKU details for display
    const selectedSku = useMemo(() => {
        if (!skuId || !allSkus) return null;
        return allSkus.find((s) => s.id === skuId);
    }, [skuId, allSkus]);

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();

        if (lockedDates.includes(batchDate)) {
            alert('This date is locked. Please select another date.');
            return;
        }

        if (activeTab === 'existing') {
            if (!skuId) {
                alert('Please select a product');
                return;
            }
            createBatchMutation.mutate({
                skuId,
                quantity: qty,
                priority: 'normal',
                batchDate
            });
        } else {
            if (!sampleName.trim()) {
                alert('Please enter a sample name');
                return;
            }
            createBatchMutation.mutate({
                sampleName: sampleName.trim(),
                sampleColour: sampleColour.trim() || undefined,
                sampleSize: sampleSize.trim() || undefined,
                quantity: qty,
                priority: 'normal',
                batchDate
            });
        }
    };

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-md">
                <DialogHeader>
                    <DialogTitle>Add to Production</DialogTitle>
                </DialogHeader>

                <form onSubmit={handleSubmit} className="space-y-4">
                    {/* Tabs for Existing vs Sample */}
                    <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as 'existing' | 'sample')}>
                        <TabsList className="grid w-full grid-cols-2">
                            <TabsTrigger value="existing" className="flex items-center gap-2">
                                <Package size={14} />
                                Existing Product
                            </TabsTrigger>
                            <TabsTrigger value="sample" className="flex items-center gap-2">
                                <FlaskConical size={14} />
                                Sample/Trial
                            </TabsTrigger>
                        </TabsList>

                        {/* Existing Product Tab - Unified Search */}
                        <TabsContent value="existing" className="space-y-4 mt-4">
                            <div className="relative">
                                <Label htmlFor="product-search">Search Product</Label>
                                {selectedSku ? (
                                    <div className="flex items-center gap-2 mt-1">
                                        <div className="flex h-auto w-full items-center gap-3 rounded-md border border-input bg-muted px-3 py-2 text-sm">
                                            {getSkuImageUrl(selectedSku) ? (
                                                <img
                                                    src={getOptimizedImageUrl(getSkuImageUrl(selectedSku), 'sm') ?? undefined}
                                                    alt=""
                                                    className="w-10 h-10 object-cover rounded flex-shrink-0"
                                                    loading="lazy"
                                                />
                                            ) : (
                                                <div className="w-10 h-10 bg-gray-200 rounded flex items-center justify-center flex-shrink-0">
                                                    <Package size={16} className="text-gray-400" />
                                                </div>
                                            )}
                                            <div className="flex-1 min-w-0">
                                                <div className="font-medium truncate">{selectedSku.variation?.product?.name}</div>
                                                <div className="text-xs text-muted-foreground truncate">
                                                    {selectedSku.variation?.colorName} / {selectedSku.size} - {selectedSku.skuCode}
                                                </div>
                                            </div>
                                        </div>
                                        <Button
                                            type="button"
                                            variant="ghost"
                                            size="icon"
                                            onClick={() => {
                                                setSkuId('');
                                                setSearchQuery('');
                                            }}
                                        >
                                            <X size={16} />
                                        </Button>
                                    </div>
                                ) : (
                                    <div className="relative mt-1">
                                        {isLoadingSkus ? (
                                            <Loader2 size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground animate-spin" />
                                        ) : (
                                            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                                        )}
                                        <Input
                                            id="product-search"
                                            placeholder={isLoadingSkus ? "Loading products..." : "Search by product, colour, size, or SKU..."}
                                            value={searchQuery}
                                            onChange={(e) => {
                                                setSearchQuery(e.target.value);
                                                setShowDropdown(true);
                                            }}
                                            onFocus={() => setShowDropdown(true)}
                                            className="pl-9"
                                            autoComplete="off"
                                            disabled={isLoadingSkus}
                                        />
                                    </div>
                                )}
                                {showDropdown && searchQuery.trim() && !selectedSku && (
                                    <div className="absolute z-10 w-full mt-1 bg-background border rounded-md shadow-lg max-h-72 overflow-y-auto">
                                        {isLoadingSkus ? (
                                            <div className="px-3 py-4 text-sm text-muted-foreground text-center flex items-center justify-center gap-2">
                                                <Loader2 size={16} className="animate-spin" />
                                                Loading products...
                                            </div>
                                        ) : filteredSkus.length === 0 ? (
                                            <div className="px-3 py-3 text-sm text-muted-foreground text-center">
                                                No products found for "{searchQuery}"
                                            </div>
                                        ) : (
                                            filteredSkus.map((sku) => (
                                                <button
                                                    key={sku.id}
                                                    type="button"
                                                    className="w-full text-left px-3 py-2.5 hover:bg-accent border-b last:border-0 transition-colors flex items-center gap-3"
                                                    onClick={() => {
                                                        setSkuId(sku.id);
                                                        setShowDropdown(false);
                                                        setSearchQuery('');
                                                    }}
                                                >
                                                    {getSkuImageUrl(sku) ? (
                                                        <img
                                                            src={getOptimizedImageUrl(getSkuImageUrl(sku), 'sm') ?? undefined}
                                                            alt=""
                                                            className="w-10 h-10 object-cover rounded flex-shrink-0"
                                                            loading="lazy"
                                                        />
                                                    ) : (
                                                        <div className="w-10 h-10 bg-gray-100 rounded flex items-center justify-center flex-shrink-0">
                                                            <Package size={16} className="text-gray-400" />
                                                        </div>
                                                    )}
                                                    <div className="flex-1 min-w-0">
                                                        <div className="font-medium text-sm truncate">{sku.variation?.product?.name}</div>
                                                        <div className="text-xs text-muted-foreground mt-0.5 truncate">
                                                            {sku.variation?.colorName} / {sku.size} - <span className="font-mono">{sku.skuCode}</span>
                                                        </div>
                                                    </div>
                                                </button>
                                            ))
                                        )}
                                    </div>
                                )}
                            </div>
                        </TabsContent>

                        {/* Sample/Trial Tab */}
                        <TabsContent value="sample" className="space-y-4 mt-4">
                            <div className="rounded-lg border border-purple-200 bg-purple-50 p-3">
                                <div className="flex items-center gap-2 text-purple-700 text-sm font-medium mb-1">
                                    <FlaskConical size={14} />
                                    Sample Product
                                </div>
                                <p className="text-xs text-purple-600">
                                    Create a production batch for a new trial item. Sample batches don't require an existing SKU
                                    and won't create inventory transactions.
                                </p>
                            </div>

                            <div>
                                <Label htmlFor="sample-name">Sample Name *</Label>
                                <Input
                                    id="sample-name"
                                    placeholder="e.g., New Summer Dress, Trial Linen Shirt..."
                                    value={sampleName}
                                    onChange={(e) => setSampleName(e.target.value)}
                                    className="mt-1"
                                    required={activeTab === 'sample'}
                                />
                                <p className="text-xs text-muted-foreground mt-1">
                                    A unique code like SAMPLE-01 will be auto-generated
                                </p>
                            </div>

                            <div className="grid grid-cols-2 gap-3">
                                <div>
                                    <Label htmlFor="sample-colour">Colour</Label>
                                    <Input
                                        id="sample-colour"
                                        placeholder="e.g., Navy Blue"
                                        value={sampleColour}
                                        onChange={(e) => setSampleColour(e.target.value)}
                                        className="mt-1"
                                    />
                                </div>
                                <div>
                                    <Label htmlFor="sample-size">Size</Label>
                                    <Input
                                        id="sample-size"
                                        placeholder="e.g., M, 32, Free"
                                        value={sampleSize}
                                        onChange={(e) => setSampleSize(e.target.value)}
                                        className="mt-1"
                                    />
                                </div>
                            </div>
                        </TabsContent>
                    </Tabs>

                    {/* Common Fields */}
                    <div className="grid grid-cols-2 gap-4 pt-2 border-t">
                        <div>
                            <Label htmlFor="batch-date">Production Date</Label>
                            <Input
                                id="batch-date"
                                type="date"
                                value={batchDate}
                                onChange={(e) => setBatchDate(e.target.value)}
                                min={today}
                                className="mt-1"
                            />
                            {lockedDates.includes(batchDate) && (
                                <p className="text-xs text-destructive mt-1">This date is locked</p>
                            )}
                        </div>
                        <div>
                            <Label htmlFor="qty">Quantity</Label>
                            <Input
                                id="qty"
                                type="number"
                                value={qty}
                                onChange={(e) => setQty(Number(e.target.value))}
                                min={1}
                                className="mt-1"
                            />
                        </div>
                    </div>

                    <DialogFooter className="gap-2 sm:gap-0">
                        <Button
                            type="button"
                            variant="outline"
                            onClick={() => onOpenChange(false)}
                        >
                            Cancel
                        </Button>
                        <Button
                            type="submit"
                            disabled={createBatchMutation.isPending || lockedDates.includes(batchDate)}
                        >
                            {createBatchMutation.isPending ? 'Adding...' : 'Add to Plan'}
                        </Button>
                    </DialogFooter>
                </form>
            </DialogContent>
        </Dialog>
    );
}

export default AddToPlanModal;
