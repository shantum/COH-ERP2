/**
 * useFabricMappingData - Data fetching and transformation for Fabric Mapping view
 *
 * Combines products tree and materials tree to build:
 * 1. Flat rows for the table (product headers + variation rows)
 * 2. Materials lookup maps for cascading dropdowns
 * 3. Current fabric assignments from BOM data
 */

import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useServerFn } from '@tanstack/react-start';
import { getProductsTree } from '../../../../server/functions/products';
import { getComponentRoles, getFabricAssignments } from '../../../../server/functions/bomMutations';
// NOTE: Shopify status now comes from getProductsTree on each variation node
// (uses Variation.shopifySourceProductId for accurate variation-level status)
import { useMaterialsTree } from '../../../materials/hooks/useMaterialsTree';
import type { ProductTreeResponse, ProductTreeNode } from '../../types';
import type { MaterialNode } from '../../../materials/types';
import type {
    FabricMappingRow,
    MaterialsLookup,
    MaterialOption,
    FabricOption,
    ColourOption,
    FabricMappingSummary,
    FabricMappingFilter,
    ShopifyStatus,
} from '../types';

interface UseFabricMappingDataOptions {
    filter?: FabricMappingFilter;
    searchQuery?: string;
    shopifyStatusFilter?: 'all' | 'active' | 'archived';
}

interface UseFabricMappingDataReturn {
    /** Flat rows for the table (product headers + variation rows) */
    rows: FabricMappingRow[];
    /** Materials lookup for cascading dropdowns */
    materialsLookup: MaterialsLookup;
    /** Summary statistics */
    summary: FabricMappingSummary;
    /** Loading state */
    isLoading: boolean;
    /** Error state */
    error: Error | null;
    /** Refetch all data */
    refetch: () => void;
    /** Component roles (to get main fabric role ID) */
    mainFabricRoleId: string | null;
}

/**
 * Build materials lookup from materials tree
 */
function buildMaterialsLookup(materialsData: MaterialNode[]): MaterialsLookup {
    const materials: MaterialOption[] = [];
    const fabrics: FabricOption[] = [];
    const colours: ColourOption[] = [];
    const fabricToMaterial = new Map<string, string>();
    const colourToFabric = new Map<string, string>();

    function traverseMaterials(nodes: MaterialNode[]) {
        for (const node of nodes) {
            if (node.type === 'material') {
                materials.push({
                    id: node.id,
                    name: node.name,
                    fabricCount: node.fabricCount || 0,
                });
                if (node.children) {
                    traverseMaterials(node.children);
                }
            } else if (node.type === 'fabric') {
                fabrics.push({
                    id: node.id,
                    name: node.name,
                    materialId: node.materialId || '',
                    constructionType: node.constructionType as 'knit' | 'woven' | undefined,
                    colourCount: node.colourCount || 0,
                });
                fabricToMaterial.set(node.id, node.materialId || '');
                if (node.children) {
                    traverseMaterials(node.children);
                }
            } else if (node.type === 'colour') {
                colours.push({
                    id: node.id,
                    name: node.name,
                    fabricId: node.fabricId || '',
                    materialId: node.materialId || '',
                    colourHex: node.colourHex,
                });
                colourToFabric.set(node.id, node.fabricId || '');
            }
        }
    }

    traverseMaterials(materialsData);

    return {
        materials,
        fabrics,
        colours,
        fabricToMaterial,
        colourToFabric,
    };
}

/**
 * Transform products tree to flat rows with current fabric assignments
 */
function buildFabricMappingRows(
    productsData: ProductTreeNode[],
    variationAssignments: Map<string, { colourId: string; fabricId: string; materialId: string; colourName: string; fabricName: string; materialName: string; colourHex?: string }>,
    filter: FabricMappingFilter,
    searchQuery: string,
    shopifyStatusFilter: 'all' | 'active' | 'archived' = 'all'
): { rows: FabricMappingRow[]; summary: FabricMappingSummary } {
    const rows: FabricMappingRow[] = [];
    let totalVariations = 0;
    let mappedVariations = 0;
    let unmappedVariations = 0;
    let totalProducts = 0;

    const query = searchQuery.toLowerCase().trim();

    for (const product of productsData) {
        if (product.type !== 'product') continue;

        // Get variations
        const variations = product.children?.filter(c => c.type === 'variation') || [];
        if (variations.length === 0) continue;

        // Check if product matches search
        const productMatches = !query ||
            product.name.toLowerCase().includes(query) ||
            product.styleCode?.toLowerCase().includes(query) ||
            product.category?.toLowerCase().includes(query);

        // Count mapped variations for this product
        let productMappedCount = 0;
        const productVariationRows: FabricMappingRow[] = [];

        for (const variation of variations) {
            const assignment = variationAssignments.get(variation.id);
            const isMapped = !!assignment;

            // Apply mapping filter
            if (filter === 'mapped' && !isMapped) continue;
            if (filter === 'unmapped' && isMapped) continue;

            // Apply Shopify status filter
            // Use variation-level status from tree data (via Variation.shopifySourceProductId)
            const variationShopifyStatus = (variation.shopifyStatus || 'not_linked') as ShopifyStatus;
            if (shopifyStatusFilter === 'active' && variationShopifyStatus !== 'active') continue;
            if (shopifyStatusFilter === 'archived' && variationShopifyStatus !== 'archived') continue;

            // Check if variation matches search
            const variationMatches = !query ||
                productMatches ||
                variation.colorName?.toLowerCase().includes(query) ||
                assignment?.colourName?.toLowerCase().includes(query) ||
                assignment?.fabricName?.toLowerCase().includes(query);

            if (!variationMatches) continue;

            totalVariations++;
            if (isMapped) {
                mappedVariations++;
                productMappedCount++;
            } else {
                unmappedVariations++;
            }

            productVariationRows.push({
                id: variation.id,
                rowType: 'variation',
                variationId: variation.id,
                variationName: variation.colorName || variation.name,
                colorHex: variation.colorHex,
                parentProductId: product.id,
                parentProductName: product.name,
                isActive: variation.isActive,
                shopifyStatus: variationShopifyStatus,
                currentMaterialId: assignment?.materialId || null,
                currentMaterialName: assignment?.materialName || null,
                currentFabricId: assignment?.fabricId || null,
                currentFabricName: assignment?.fabricName || null,
                currentColourId: assignment?.colourId || null,
                currentColourName: assignment?.colourName || null,
                currentColourHex: assignment?.colourHex || null,
            });
        }

        // Only add product header if it has visible variations
        if (productVariationRows.length > 0) {
            totalProducts++;

            // Calculate aggregated material/fabric from mapped variations
            const mappedRows = productVariationRows.filter(v => v.currentMaterialId);
            let aggregatedMaterialId: string | null = null;
            let aggregatedMaterialName: string | null = null;
            let aggregatedFabricId: string | null = null;
            let aggregatedFabricName: string | null = null;

            if (mappedRows.length > 0) {
                // Check if all mapped variations have the same material
                const firstMaterialId = mappedRows[0].currentMaterialId;
                const allSameMaterial = mappedRows.every(v => v.currentMaterialId === firstMaterialId);
                if (allSameMaterial && firstMaterialId) {
                    aggregatedMaterialId = firstMaterialId;
                    aggregatedMaterialName = mappedRows[0].currentMaterialName || null;
                }

                // Check if all mapped variations have the same fabric
                const firstFabricId = mappedRows[0].currentFabricId;
                const allSameFabric = mappedRows.every(v => v.currentFabricId === firstFabricId);
                if (allSameFabric && firstFabricId) {
                    aggregatedFabricId = firstFabricId;
                    aggregatedFabricName = mappedRows[0].currentFabricName || null;
                }
            }

            // Add product header row with aggregated data
            // Product shopifyStatus is derived from variations in getProductsTree
            rows.push({
                id: `product-${product.id}`,
                rowType: 'product',
                productId: product.id,
                productName: product.name,
                productImageUrl: product.imageUrl,
                styleCode: product.styleCode,
                category: product.category,
                gender: product.gender,
                variationCount: productVariationRows.length,
                mappedCount: productMappedCount,
                shopifyStatus: (product.shopifyStatus || 'not_linked') as ShopifyStatus,
                currentMaterialId: aggregatedMaterialId,
                currentMaterialName: aggregatedMaterialName,
                currentFabricId: aggregatedFabricId,
                currentFabricName: aggregatedFabricName,
            });

            // Add variation rows
            rows.push(...productVariationRows);
        }
    }

    return {
        rows,
        summary: {
            totalVariations,
            mappedVariations,
            unmappedVariations,
            totalProducts,
        },
    };
}

export function useFabricMappingData(options: UseFabricMappingDataOptions = {}): UseFabricMappingDataReturn {
    const { filter = 'all', searchQuery = '', shopifyStatusFilter = 'all' } = options;

    // Server function hooks
    const getProductsTreeFn = useServerFn(getProductsTree);
    const getComponentRolesFn = useServerFn(getComponentRoles);
    const getFabricAssignmentsFn = useServerFn(getFabricAssignments);

    // Fetch products tree
    const {
        data: productsResponse,
        isLoading: productsLoading,
        error: productsError,
        refetch: refetchProducts,
    } = useQuery<ProductTreeResponse>({
        queryKey: ['productsTree', 'tree', 'server-fn'],
        queryFn: async () => {
            const result = await getProductsTreeFn({ data: {} });
            return result as ProductTreeResponse;
        },
        staleTime: 30 * 1000,
    });

    // Fetch materials tree
    const {
        data: materialsData,
        isLoading: materialsLoading,
        error: materialsError,
        refetch: refetchMaterials,
    } = useMaterialsTree({ enabled: true });

    // Fetch component roles to get main fabric role ID
    const {
        data: rolesData,
        isLoading: rolesLoading,
    } = useQuery({
        queryKey: ['componentRoles', 'server-fn'],
        queryFn: () => getComponentRolesFn(),
        staleTime: 5 * 60 * 1000, // 5 minutes
    });

    // Get main fabric role ID
    // getComponentRoles returns { success: true, data: [...] }
    const mainFabricRoleId = useMemo(() => {
        // Handle the MutationResult wrapper
        const roles = rolesData?.success && rolesData?.data ? rolesData.data : null;
        if (!roles || !Array.isArray(roles)) return null;
        const mainFabricRole = roles.find(
            (role: { code: string; type?: { code: string } }) => role.code === 'main' && role.type?.code === 'FABRIC'
        );
        return mainFabricRole?.id || null;
    }, [rolesData]);

    // Fetch all fabric assignments (variation BOM lines for main fabric role)
    const {
        data: assignmentsData,
        isLoading: assignmentsLoading,
        refetch: refetchAssignments,
    } = useQuery({
        queryKey: ['fabricMappingAssignments', mainFabricRoleId, 'server-fn'],
        queryFn: async () => {
            const result = await getFabricAssignmentsFn({ data: { roleId: mainFabricRoleId || undefined } });
            return result;
        },
        enabled: !!mainFabricRoleId,
        staleTime: 30 * 1000,
    });

    // NOTE: Shopify status now comes from getProductsTree on each variation/product node
    // (uses Variation.shopifySourceProductId for accurate variation-level status)

    // Build materials lookup
    const materialsLookup = useMemo(
        () => buildMaterialsLookup(materialsData || []),
        [materialsData]
    );

    // Build variation assignments map from assignments data
    const variationAssignments = useMemo(() => {
        const map = new Map<string, {
            colourId: string;
            fabricId: string;
            materialId: string;
            colourName: string;
            fabricName: string;
            materialName: string;
            colourHex?: string;
        }>();

        // Parse assignments from API response
        // For now, this will be empty until we add the endpoint
        if (assignmentsData?.assignments) {
            for (const assignment of assignmentsData.assignments) {
                map.set(assignment.variationId, {
                    colourId: assignment.colourId,
                    fabricId: assignment.fabricId,
                    materialId: assignment.materialId,
                    colourName: assignment.colourName,
                    fabricName: assignment.fabricName,
                    materialName: assignment.materialName,
                    colourHex: assignment.colourHex,
                });
            }
        }

        return map;
    }, [assignmentsData]);

    // Build rows and summary
    const { rows, summary } = useMemo(
        () => buildFabricMappingRows(
            productsResponse?.items || [],
            variationAssignments,
            filter,
            searchQuery,
            shopifyStatusFilter
        ),
        [productsResponse?.items, variationAssignments, filter, searchQuery, shopifyStatusFilter]
    );

    const refetch = () => {
        refetchProducts();
        refetchMaterials();
        refetchAssignments();
    };

    return {
        rows,
        materialsLookup,
        summary,
        isLoading: productsLoading || materialsLoading || rolesLoading || assignmentsLoading,
        error: (productsError || materialsError) as Error | null,
        refetch,
        mainFabricRoleId,
    };
}
