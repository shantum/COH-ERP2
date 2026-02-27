/**
 * BOM List Server Function
 *
 * Fetches all active SKUs with their resolved BOM data for the BOM overview page.
 */

import { createServerFn } from '@tanstack/react-start';
import { authMiddleware } from '../middleware/auth';
import { getPrisma } from '@coh/shared/services/db';
import type { DbRecord } from './bomHelpers';
import { sortBySizeOrder } from '@coh/shared/config/product';

// ============================================
// RESULT TYPES
// ============================================

export interface BomRoleColumn {
    roleId: string;
    roleCode: string;
    roleName: string;
    typeCode: string; // FABRIC | TRIM | SERVICE
}

export interface SkuBomRow {
    skuId: string;
    skuCode: string;
    size: string;
    productName: string;
    productId: string;
    imageUrl: string | null;
    variationId: string;
    colorName: string;
    colorHex: string | null;
    /** Keyed by roleId → resolved component info */
    components: Record<string, {
        name: string;
        quantity: number | null;
        unit: string | null;
        costPerUnit: number | null;
    }>;
}

export interface BomListResult {
    roles: BomRoleColumn[];
    rows: SkuBomRow[];
}

// ============================================
// SERVER FUNCTION
// ============================================

export const getBomList = createServerFn({ method: 'GET' })
    .middleware([authMiddleware])
    .handler(async (): Promise<BomListResult> => {
        const prisma = await getPrisma();

        // 1. Get all component roles that are actually used in templates
        const usedRoles = await prisma.productBomTemplate.findMany({
            select: {
                roleId: true,
                role: {
                    select: {
                        id: true,
                        code: true,
                        name: true,
                        sortOrder: true,
                        type: { select: { code: true } },
                    },
                },
            },
            distinct: ['roleId'],
        });

        // Deduplicate and sort
        const rolesMap = new Map<string, BomRoleColumn & { sortOrder: number }>();
        for (const ur of usedRoles as DbRecord[]) {
            if (!rolesMap.has(ur.roleId)) {
                rolesMap.set(ur.roleId, {
                    roleId: ur.role.id,
                    roleCode: ur.role.code,
                    roleName: ur.role.name,
                    typeCode: ur.role.type.code,
                    sortOrder: ur.role.sortOrder,
                });
            }
        }
        const roles = Array.from(rolesMap.values())
            .sort((a, b) => a.sortOrder - b.sortOrder)
            .map(({ sortOrder: _, ...r }) => r);

        // 2. Fetch all active products with templates, variations (bom lines), and SKUs
        const products = await prisma.product.findMany({
            where: { isActive: true },
            select: {
                id: true,
                name: true,
                imageUrl: true,
                bomTemplates: {
                    select: {
                        roleId: true,
                        defaultQuantity: true,
                        quantityUnit: true,
                        trimItem: { select: { name: true, costPerUnit: true } },
                        serviceItem: { select: { name: true, costPerJob: true } },
                    },
                },
                variations: {
                    where: { isActive: true },
                    select: {
                        id: true,
                        colorName: true,
                        colorHex: true,
                        imageUrl: true,
                        bomLines: {
                            select: {
                                roleId: true,
                                quantity: true,
                                fabricColour: {
                                    select: {
                                        colourName: true,
                                        costPerUnit: true,
                                        fabric: { select: { name: true, costPerUnit: true, unit: true } },
                                    },
                                },
                                trimItem: { select: { name: true, costPerUnit: true } },
                                serviceItem: { select: { name: true, costPerJob: true } },
                            },
                        },
                        skus: {
                            where: { isActive: true },
                            select: {
                                id: true,
                                skuCode: true,
                                size: true,
                                bomLines: {
                                    select: {
                                        roleId: true,
                                        quantity: true,
                                        overrideCost: true,
                                    },
                                },
                            },
                        },
                    },
                },
            },
            orderBy: { name: 'asc' },
        });

        // 3. Build rows: one per SKU, with resolved BOM components
        const rows: SkuBomRow[] = [];

        for (const product of products as DbRecord[]) {
            // Index templates by roleId
            const templatesByRole = new Map<string, DbRecord>();
            for (const t of product.bomTemplates) {
                templatesByRole.set(t.roleId, t);
            }

            for (const variation of product.variations) {
                // Index variation bom lines by roleId
                const varLinesByRole = new Map<string, DbRecord>();
                for (const vl of variation.bomLines) {
                    varLinesByRole.set(vl.roleId, vl);
                }

                for (const sku of variation.skus) {
                    // Index SKU bom overrides by roleId
                    const skuLinesByRole = new Map<string, DbRecord>();
                    for (const sl of sku.bomLines) {
                        skuLinesByRole.set(sl.roleId, sl);
                    }

                    // Resolve each role's component
                    const components: SkuBomRow['components'] = {};

                    for (const role of roles) {
                        const template = templatesByRole.get(role.roleId);
                        const varLine = varLinesByRole.get(role.roleId);
                        const skuLine = skuLinesByRole.get(role.roleId);

                        if (!template && !varLine) continue;

                        // Resolve quantity: SKU > variation > template
                        const quantity = skuLine?.quantity ?? varLine?.quantity ?? template?.defaultQuantity ?? null;
                        const unit = template?.quantityUnit ?? null;

                        // Resolve component name and cost based on type
                        let name = '';
                        let costPerUnit: number | null = null;

                        if (role.typeCode === 'FABRIC' && varLine?.fabricColour) {
                            const fc = varLine.fabricColour;
                            name = `${fc.fabric.name} — ${fc.colourName}`;
                            costPerUnit = skuLine?.overrideCost ?? fc.costPerUnit ?? fc.fabric.costPerUnit ?? null;
                        } else if (role.typeCode === 'TRIM') {
                            const trim = varLine?.trimItem ?? template?.trimItem;
                            if (trim) {
                                name = trim.name;
                                costPerUnit = skuLine?.overrideCost ?? trim.costPerUnit ?? null;
                            }
                        } else if (role.typeCode === 'SERVICE') {
                            const svc = varLine?.serviceItem ?? template?.serviceItem;
                            if (svc) {
                                name = svc.name;
                                costPerUnit = skuLine?.overrideCost ?? svc.costPerJob ?? null;
                            }
                        }

                        if (name) {
                            components[role.roleId] = { name, quantity, unit, costPerUnit };
                        }
                    }

                    rows.push({
                        skuId: sku.id,
                        skuCode: sku.skuCode,
                        size: sku.size,
                        productName: product.name,
                        productId: product.id,
                        imageUrl: variation.imageUrl ?? product.imageUrl ?? null,
                        variationId: variation.id,
                        colorName: variation.colorName,
                        colorHex: variation.colorHex,
                        components,
                    });
                }
            }
        }

        // Sort: product name → color → size (XS → 3XL)
        rows.sort((a, b) => {
            const byProduct = a.productName.localeCompare(b.productName);
            if (byProduct !== 0) return byProduct;
            const byColor = a.colorName.localeCompare(b.colorName);
            if (byColor !== 0) return byColor;
            return sortBySizeOrder(a.size, b.size);
        });

        return { roles, rows };
    });
