/**
 * Costing Server Functions
 *
 * TanStack Start Server Functions for P&L analysis and costing dashboard.
 * Calculates revenue, BOM costs, gross profit, and operating profit metrics.
 *
 * IMPORTANT: All database imports are dynamic to prevent Node.js code
 * from being bundled into the client.
 */

import { createServerFn } from '@tanstack/react-start';
import { z } from 'zod';
import { authMiddleware } from '../middleware/auth';
import { getPrisma } from '@coh/shared/services/db';
import { getISTMidnightAsUTC, getISTMonthStartAsUTC, getISTDayOfMonth } from '@coh/shared';

// ============================================
// INPUT SCHEMAS
// ============================================

const getCostingDashboardInputSchema = z.object({
    period: z.enum(['7d', '30d', 'mtd']).default('30d'),
    channel: z.enum(['all', 'shopify_online', 'marketplace']).default('all'),
});

const getProductContributionInputSchema = z.object({
    period: z.enum(['7d', '30d', 'mtd']).default('30d'),
    channel: z.enum(['all', 'shopify_online', 'marketplace']).default('all'),
    limit: z.number().int().positive().default(50),
});

const getFabricColourCostsInputSchema = z.object({
    period: z.enum(['7d', '30d', 'mtd']).default('30d'),
    channel: z.enum(['all', 'shopify_online', 'marketplace']).default('all'),
    limit: z.number().int().positive().default(10),
});

const updateCostingConfigInputSchema = z.object({
    monthlyLaborOverhead: z.number().nonnegative().optional(),
    monthlyMarketingBudget: z.number().nonnegative().optional(),
});

// ============================================
// OUTPUT TYPES
// ============================================

export interface CostingDashboardData {
    period: '30d' | '7d' | 'mtd';
    summary: {
        revenue: number;
        bomCost: number;
        grossProfit: number;
        grossMarginPct: number;
        laborOverhead: number;
        marketingBudget: number;
        operatingProfit: number;
        operatingMarginPct: number;
        unitsSold: number;
        avgSellingPrice: number;
        avgBomCost: number;
        contributionPerUnit: number;
        overheadPerUnit: number;
        netProfitPerUnit: number;
        // ROAS metrics
        roas: number;              // Current ROAS = Revenue / Marketing
        breakevenRoas: number;     // ROAS needed to break even
        roasStatus: 'above' | 'below' | 'at'; // Are we above/below breakeven ROAS?
    };
    breakeven: {
        unitsRequired: number;
        currentUnits: number;
        percentToBreakeven: number;
        surplusDeficit: number;
    };
    config: {
        monthlyLaborOverhead: number;
        monthlyMarketingBudget: number;
    };
}

export interface ProductContribution {
    productId: string;
    productName: string;
    category: string;
    avgMrp: number;
    avgBomCost: number;
    contribution: number;
    contributionPct: number;
    unitsSold: number;
    revenue: number;
    totalContribution: number;
    bomMultiple: number;
}

export interface ProductContributionResponse {
    period: string;
    data: ProductContribution[];
    totals: {
        unitsSold: number;
        revenue: number;
        totalContribution: number;
    };
}

export interface FabricColourDetail {
    colourName: string;
    colourHex: string | null;
    units: number;
    consumption: number;
    cost: number;
}

export interface FabricGroup {
    fabricId: string;
    fabricName: string;
    materialName: string;
    fabricUnit: string;
    fabricRate: number;
    totalConsumption: number;
    totalFabricCost: number;
    colours: FabricColourDetail[];
}

export interface FabricCostResponse {
    period: string;
    data: FabricGroup[];
    totals: {
        totalFabricCost: number;
    };
}

// Default overhead values (Rs)
const DEFAULT_MONTHLY_LABOR_OVERHEAD = 1500000; // Rs 15,00,000
const DEFAULT_MONTHLY_MARKETING_BUDGET = 1500000; // Rs 15,00,000

// Marketplace channels (Myntra, Ajio, Nykaa, etc.)
const MARKETPLACE_CHANNELS = ['myntra', 'ajio', 'nykaa', 'amazon', 'flipkart'];

// Build channel filter for Prisma queries
function getChannelFilter(channel: 'all' | 'shopify_online' | 'marketplace') {
    if (channel === 'shopify_online') {
        return { channel: 'shopify_online' };
    }
    if (channel === 'marketplace') {
        return { channel: { in: MARKETPLACE_CHANNELS } };
    }
    return {}; // all channels
}

// ============================================
// HELPER FUNCTIONS
// ============================================

function getDateRangeForPeriod(period: '7d' | '30d' | 'mtd'): { start: Date; end: Date; daysInPeriod: number } {
    const now = new Date();

    switch (period) {
        case '7d':
            return {
                start: getISTMidnightAsUTC(-7),
                end: now,
                daysInPeriod: 7,
            };
        case 'mtd':
            return {
                start: getISTMonthStartAsUTC(0),
                end: now,
                daysInPeriod: getISTDayOfMonth(), // Days elapsed in current month (IST)
            };
        case '30d':
        default:
            return {
                start: getISTMidnightAsUTC(-30),
                end: now,
                daysInPeriod: 30,
            };
    }
}

// ============================================
// SERVER FUNCTIONS
// ============================================

/**
 * Get costing config (overhead settings)
 */
export const getCostingConfig = createServerFn({ method: 'GET' })
    .middleware([authMiddleware])
    .handler(async () => {
        const prisma = await getPrisma();

        // Get or create cost config
        let config = await prisma.costConfig.findFirst();

        if (!config) {
            config = await prisma.costConfig.create({
                data: {
                    monthlyLaborOverhead: DEFAULT_MONTHLY_LABOR_OVERHEAD,
                    monthlyMarketingBudget: DEFAULT_MONTHLY_MARKETING_BUDGET,
                },
            });
        }

        return {
            monthlyLaborOverhead: config.monthlyLaborOverhead ?? DEFAULT_MONTHLY_LABOR_OVERHEAD,
            monthlyMarketingBudget: config.monthlyMarketingBudget ?? DEFAULT_MONTHLY_MARKETING_BUDGET,
        };
    });

/**
 * Update costing config (overhead settings)
 */
export const updateCostingConfig = createServerFn({ method: 'POST' })
    .middleware([authMiddleware])
    .inputValidator((input: unknown) => updateCostingConfigInputSchema.parse(input))
    .handler(async ({ data }) => {
        const prisma = await getPrisma();

        // Get existing config or create
        let config = await prisma.costConfig.findFirst();

        const updateData: Record<string, number> = {};
        if (data.monthlyLaborOverhead !== undefined) {
            updateData.monthlyLaborOverhead = data.monthlyLaborOverhead;
        }
        if (data.monthlyMarketingBudget !== undefined) {
            updateData.monthlyMarketingBudget = data.monthlyMarketingBudget;
        }

        if (config) {
            config = await prisma.costConfig.update({
                where: { id: config.id },
                data: {
                    ...updateData,
                    lastUpdated: new Date(),
                },
            });
        } else {
            config = await prisma.costConfig.create({
                data: {
                    monthlyLaborOverhead: data.monthlyLaborOverhead ?? DEFAULT_MONTHLY_LABOR_OVERHEAD,
                    monthlyMarketingBudget: data.monthlyMarketingBudget ?? DEFAULT_MONTHLY_MARKETING_BUDGET,
                },
            });
        }

        return {
            success: true,
            monthlyLaborOverhead: config.monthlyLaborOverhead ?? DEFAULT_MONTHLY_LABOR_OVERHEAD,
            monthlyMarketingBudget: config.monthlyMarketingBudget ?? DEFAULT_MONTHLY_MARKETING_BUDGET,
        };
    });

/**
 * Get costing dashboard data
 *
 * Returns P&L summary, unit economics, and breakeven analysis.
 */
export const getCostingDashboard = createServerFn({ method: 'GET' })
    .middleware([authMiddleware])
    .inputValidator((input: unknown) => getCostingDashboardInputSchema.parse(input))
    .handler(async ({ data }): Promise<CostingDashboardData> => {
        const prisma = await getPrisma();

        const { period, channel } = data;
        const { start, end, daysInPeriod } = getDateRangeForPeriod(period);
        const channelFilter = getChannelFilter(channel);

        // Get config
        let config = await prisma.costConfig.findFirst();
        const monthlyLaborOverhead = config?.monthlyLaborOverhead ?? DEFAULT_MONTHLY_LABOR_OVERHEAD;
        const monthlyMarketingBudget = config?.monthlyMarketingBudget ?? DEFAULT_MONTHLY_MARKETING_BUDGET;

        // Prorate overhead to the period (assume 30 days per month)
        const periodOverheadMultiplier = daysInPeriod / 30;
        const periodLaborOverhead = monthlyLaborOverhead * periodOverheadMultiplier;
        const periodMarketingBudget = monthlyMarketingBudget * periodOverheadMultiplier;
        const totalOverhead = periodLaborOverhead + periodMarketingBudget;

        // Fetch order lines with SKU bomCost for the period
        // Include all non-cancelled lines (matches Shopify's order-based revenue)
        const orderLines = await prisma.orderLine.findMany({
            where: {
                order: {
                    orderDate: {
                        gte: start,
                        lte: end,
                    },
                    status: { notIn: ['cancelled'] },
                    ...channelFilter,
                },
                lineStatus: { notIn: ['cancelled'] },
            },
            include: {
                sku: {
                    select: {
                        id: true,
                        bomCost: true,
                        mrp: true,
                    },
                },
            },
        });

        // Calculate aggregates
        let totalRevenue = 0;
        let totalBomCost = 0;
        let unitsSold = 0;

        for (const line of orderLines) {
            const lineRevenue = line.unitPrice * line.qty;
            const lineBomCost = (line.sku.bomCost ?? 0) * line.qty;

            totalRevenue += lineRevenue;
            totalBomCost += lineBomCost;
            unitsSold += line.qty;
        }

        // Calculate metrics
        const grossProfit = totalRevenue - totalBomCost;
        const grossMarginPct = totalRevenue > 0 ? (grossProfit / totalRevenue) * 100 : 0;

        const operatingProfit = grossProfit - totalOverhead;
        const operatingMarginPct = totalRevenue > 0 ? (operatingProfit / totalRevenue) * 100 : 0;

        const avgSellingPrice = unitsSold > 0 ? totalRevenue / unitsSold : 0;
        const avgBomCost = unitsSold > 0 ? totalBomCost / unitsSold : 0;
        const contributionPerUnit = avgSellingPrice - avgBomCost;
        const overheadPerUnit = unitsSold > 0 ? totalOverhead / unitsSold : 0;
        const netProfitPerUnit = contributionPerUnit - overheadPerUnit;

        // Breakeven analysis
        // Breakeven units = Total Overhead / Contribution per Unit
        const unitsRequired = contributionPerUnit > 0
            ? Math.ceil(totalOverhead / contributionPerUnit)
            : 0;
        const percentToBreakeven = unitsRequired > 0
            ? Math.min((unitsSold / unitsRequired) * 100, 100)
            : 100;
        const surplusDeficit = operatingProfit;

        // ROAS calculations
        // Current ROAS = Revenue / Marketing Spend
        const roas = periodMarketingBudget > 0 ? totalRevenue / periodMarketingBudget : 0;

        // Breakeven ROAS: Revenue needed to cover (BOM + Labor + Marketing) / Marketing
        // At breakeven: Revenue - BOM Cost - Labor - Marketing = 0
        // Assuming BOM is proportional to revenue (BOM% of revenue):
        // Revenue * (1 - BOM%) = Labor + Marketing
        // Breakeven Revenue = (Labor + Marketing) / Gross Margin %
        const grossMarginDecimal = grossMarginPct / 100;
        const breakevenRevenue = grossMarginDecimal > 0
            ? totalOverhead / grossMarginDecimal
            : 0;
        const breakevenRoas = periodMarketingBudget > 0
            ? breakevenRevenue / periodMarketingBudget
            : 0;

        const roasStatus: 'above' | 'below' | 'at' = roas > breakevenRoas + 0.1
            ? 'above'
            : roas < breakevenRoas - 0.1
            ? 'below'
            : 'at';

        return {
            period,
            summary: {
                revenue: Math.round(totalRevenue * 100) / 100,
                bomCost: Math.round(totalBomCost * 100) / 100,
                grossProfit: Math.round(grossProfit * 100) / 100,
                grossMarginPct: Math.round(grossMarginPct * 10) / 10,
                laborOverhead: Math.round(periodLaborOverhead * 100) / 100,
                marketingBudget: Math.round(periodMarketingBudget * 100) / 100,
                operatingProfit: Math.round(operatingProfit * 100) / 100,
                operatingMarginPct: Math.round(operatingMarginPct * 10) / 10,
                unitsSold,
                avgSellingPrice: Math.round(avgSellingPrice * 100) / 100,
                avgBomCost: Math.round(avgBomCost * 100) / 100,
                contributionPerUnit: Math.round(contributionPerUnit * 100) / 100,
                overheadPerUnit: Math.round(overheadPerUnit * 100) / 100,
                netProfitPerUnit: Math.round(netProfitPerUnit * 100) / 100,
                roas: Math.round(roas * 100) / 100,
                breakevenRoas: Math.round(breakevenRoas * 100) / 100,
                roasStatus,
            },
            breakeven: {
                unitsRequired,
                currentUnits: unitsSold,
                percentToBreakeven: Math.round(percentToBreakeven * 10) / 10,
                surplusDeficit: Math.round(surplusDeficit * 100) / 100,
            },
            config: {
                monthlyLaborOverhead,
                monthlyMarketingBudget,
            },
        };
    });

/**
 * Get product contribution analysis
 *
 * Returns per-product contribution margins and profitability.
 */
export const getProductContribution = createServerFn({ method: 'GET' })
    .middleware([authMiddleware])
    .inputValidator((input: unknown) => getProductContributionInputSchema.parse(input))
    .handler(async ({ data }): Promise<ProductContributionResponse> => {
        const prisma = await getPrisma();

        const { period, channel, limit } = data;
        const { start, end } = getDateRangeForPeriod(period);
        const channelFilter = getChannelFilter(channel);

        // Fetch order lines grouped by product
        // Include all non-cancelled lines (matches Shopify's order-based revenue)
        const orderLines = await prisma.orderLine.findMany({
            where: {
                order: {
                    orderDate: {
                        gte: start,
                        lte: end,
                    },
                    status: { notIn: ['cancelled'] },
                    ...channelFilter,
                },
                lineStatus: { notIn: ['cancelled'] },
            },
            include: {
                sku: {
                    include: {
                        variation: {
                            include: {
                                product: {
                                    select: {
                                        id: true,
                                        name: true,
                                        category: true,
                                    },
                                },
                            },
                        },
                    },
                },
            },
        });

        // Aggregate by product
        const productMap = new Map<
            string,
            {
                productId: string;
                productName: string;
                category: string;
                totalRevenue: number;
                totalBomCost: number;
                unitsSold: number;
                prices: number[];
                bomCosts: number[];
            }
        >();

        for (const line of orderLines) {
            const product = line.sku.variation.product;
            const key = product.id;

            if (!productMap.has(key)) {
                productMap.set(key, {
                    productId: product.id,
                    productName: product.name,
                    category: product.category || 'Uncategorized',
                    totalRevenue: 0,
                    totalBomCost: 0,
                    unitsSold: 0,
                    prices: [],
                    bomCosts: [],
                });
            }

            const stats = productMap.get(key)!;
            const lineRevenue = line.unitPrice * line.qty;
            const lineBomCost = (line.sku.bomCost ?? 0) * line.qty;

            stats.totalRevenue += lineRevenue;
            stats.totalBomCost += lineBomCost;
            stats.unitsSold += line.qty;

            // Track individual prices and costs for averaging
            for (let i = 0; i < line.qty; i++) {
                stats.prices.push(line.unitPrice);
                stats.bomCosts.push(line.sku.bomCost ?? 0);
            }
        }

        // Convert to result array
        let totalUnits = 0;
        let totalRevenue = 0;
        let totalContributionSum = 0;

        const products: ProductContribution[] = Array.from(productMap.values())
            .map((stats) => {
                const avgMrp = stats.prices.length > 0
                    ? stats.prices.reduce((a, b) => a + b, 0) / stats.prices.length
                    : 0;
                const avgBomCost = stats.bomCosts.length > 0
                    ? stats.bomCosts.reduce((a, b) => a + b, 0) / stats.bomCosts.length
                    : 0;
                const contribution = avgMrp - avgBomCost;
                const contributionPct = avgMrp > 0 ? (contribution / avgMrp) * 100 : 0;
                const totalContribution = stats.totalRevenue - stats.totalBomCost;
                const bomMultiple = avgBomCost > 0 ? avgMrp / avgBomCost : 0;

                totalUnits += stats.unitsSold;
                totalRevenue += stats.totalRevenue;
                totalContributionSum += totalContribution;

                return {
                    productId: stats.productId,
                    productName: stats.productName,
                    category: stats.category,
                    avgMrp: Math.round(avgMrp * 100) / 100,
                    avgBomCost: Math.round(avgBomCost * 100) / 100,
                    contribution: Math.round(contribution * 100) / 100,
                    contributionPct: Math.round(contributionPct * 10) / 10,
                    unitsSold: stats.unitsSold,
                    revenue: Math.round(stats.totalRevenue * 100) / 100,
                    totalContribution: Math.round(totalContribution * 100) / 100,
                    bomMultiple: Math.round(bomMultiple * 10) / 10,
                };
            })
            .sort((a, b) => b.totalContribution - a.totalContribution)
            .slice(0, limit);

        return {
            period,
            data: products,
            totals: {
                unitsSold: totalUnits,
                revenue: Math.round(totalRevenue * 100) / 100,
                totalContribution: Math.round(totalContributionSum * 100) / 100,
            },
        };
    });

/**
 * Get fabric cost breakdown grouped by fabric
 *
 * Groups by Fabric parent, shows rate per metre/kg, consumption, and cost.
 * Colours are nested under their parent fabric for a clean drill-down view.
 */
export const getFabricColourCosts = createServerFn({ method: 'GET' })
    .middleware([authMiddleware])
    .inputValidator((input: unknown) => getFabricColourCostsInputSchema.parse(input))
    .handler(async ({ data }): Promise<FabricCostResponse> => {
        const prisma = await getPrisma();

        const { period, channel, limit } = data;
        const { start, end } = getDateRangeForPeriod(period);
        const channelFilter = getChannelFilter(channel);

        // Fetch order lines with deep BOM join to fabric colour + fabric parent
        const orderLines = await prisma.orderLine.findMany({
            where: {
                order: {
                    orderDate: { gte: start, lte: end },
                    status: { notIn: ['cancelled'] },
                    ...channelFilter,
                },
                lineStatus: { notIn: ['cancelled'] },
            },
            include: {
                sku: {
                    select: {
                        id: true,
                        bomLines: {
                            where: { fabricColourId: { not: null } },
                            select: {
                                roleId: true,
                                quantity: true,
                                fabricColour: {
                                    select: {
                                        id: true,
                                        colourName: true,
                                        colourHex: true,
                                        costPerUnit: true,
                                        fabric: {
                                            select: {
                                                id: true,
                                                name: true,
                                                costPerUnit: true,
                                                unit: true,
                                                material: {
                                                    select: { name: true },
                                                },
                                            },
                                        },
                                    },
                                },
                            },
                        },
                        variation: {
                            select: {
                                id: true,
                                product: {
                                    select: { defaultFabricConsumption: true },
                                },
                                bomLines: {
                                    where: { fabricColourId: { not: null } },
                                    select: {
                                        roleId: true,
                                        quantity: true,
                                        fabricColour: {
                                            select: {
                                                id: true,
                                                colourName: true,
                                                colourHex: true,
                                                costPerUnit: true,
                                                fabric: {
                                                    select: {
                                                        id: true,
                                                        name: true,
                                                        costPerUnit: true,
                                                        unit: true,
                                                        material: {
                                                            select: { name: true },
                                                        },
                                                    },
                                                },
                                            },
                                        },
                                    },
                                },
                            },
                        },
                    },
                },
            },
        });

        // Aggregate by fabric → colour
        const fabricMap = new Map<string, {
            fabricId: string;
            fabricName: string;
            materialName: string;
            fabricUnit: string;
            fabricRate: number;
            colours: Map<string, {
                colourName: string;
                colourHex: string | null;
                units: number;
                consumption: number;
                cost: number;
            }>;
        }>();

        for (const line of orderLines) {
            // Resolve BOM lines: prefer SKU-level, fall back to variation-level
            const skuBomLines = line.sku.bomLines;
            const variationBomLines = line.sku.variation.bomLines;
            const productDefault = line.sku.variation.product?.defaultFabricConsumption;

            // Use SKU BOM lines if available, otherwise variation BOM lines
            const effectiveBomLines = skuBomLines.length > 0 ? skuBomLines : variationBomLines;
            if (effectiveBomLines.length === 0) continue;

            for (const bom of effectiveBomLines) {
                const fc = bom.fabricColour;
                if (!fc) continue;

                const fabric = fc.fabric;
                const fabricKey = fabric.id;
                const rate = fc.costPerUnit ?? fabric.costPerUnit ?? 0;

                // Consumption cascade: SkuBomLine > VariationBomLine > Product.defaultFabricConsumption > 1.5
                let consumption: number;
                const skuLine = skuBomLines.find(s => s.roleId === bom.roleId);
                const varLine = variationBomLines.find(v => v.roleId === bom.roleId);
                consumption = skuLine?.quantity ?? varLine?.quantity ?? productDefault ?? 1.5;

                if (!fabricMap.has(fabricKey)) {
                    fabricMap.set(fabricKey, {
                        fabricId: fabric.id,
                        fabricName: fabric.name,
                        materialName: fabric.material?.name ?? 'Unknown',
                        fabricUnit: fabric.unit ?? 'm',
                        fabricRate: rate,
                        colours: new Map(),
                    });
                }

                const fabricGroup = fabricMap.get(fabricKey)!;
                const colourKey = fc.id;

                if (!fabricGroup.colours.has(colourKey)) {
                    fabricGroup.colours.set(colourKey, {
                        colourName: fc.colourName,
                        colourHex: fc.colourHex,
                        units: 0,
                        consumption: 0,
                        cost: 0,
                    });
                }

                const colourStats = fabricGroup.colours.get(colourKey)!;
                const lineConsumption = consumption * line.qty;
                const lineCost = rate * lineConsumption;

                colourStats.units += line.qty;
                colourStats.consumption += lineConsumption;
                colourStats.cost += lineCost;
            }
        }

        let totalFabricCost = 0;

        const results: FabricGroup[] = Array.from(fabricMap.values())
            .map((fg) => {
                const colours: FabricColourDetail[] = Array.from(fg.colours.values())
                    .map((c) => ({
                        colourName: c.colourName,
                        colourHex: c.colourHex,
                        units: c.units,
                        consumption: Math.round(c.consumption * 100) / 100,
                        cost: Math.round(c.cost * 100) / 100,
                    }))
                    .sort((a, b) => b.cost - a.cost);

                const totalConsumption = colours.reduce((sum, c) => sum + c.consumption, 0);
                const totalCost = colours.reduce((sum, c) => sum + c.cost, 0);
                totalFabricCost += totalCost;

                return {
                    fabricId: fg.fabricId,
                    fabricName: fg.fabricName,
                    materialName: fg.materialName,
                    fabricUnit: fg.fabricUnit,
                    fabricRate: Math.round(fg.fabricRate * 100) / 100,
                    totalConsumption: Math.round(totalConsumption * 100) / 100,
                    totalFabricCost: Math.round(totalCost * 100) / 100,
                    colours,
                };
            })
            .sort((a, b) => b.totalFabricCost - a.totalFabricCost)
            .slice(0, limit);

        return {
            period,
            data: results,
            totals: {
                totalFabricCost: Math.round(totalFabricCost * 100) / 100,
            },
        };
    });
