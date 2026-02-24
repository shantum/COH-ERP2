/**
 * Chat Agent — Read-only tool executor functions
 */

import { prisma } from '../../db/index.js';
import type { ToolInput } from './types.js';

export async function execSearchInventory(input: ToolInput) {
    const query = String(input.query ?? '');
    const results = await prisma.sku.findMany({
        where: {
            isActive: true,
            OR: [
                { skuCode: { contains: query, mode: 'insensitive' } },
                { variation: { colorName: { contains: query, mode: 'insensitive' } } },
                { variation: { product: { name: { contains: query, mode: 'insensitive' } } } },
            ],
        },
        include: {
            variation: {
                include: { product: { select: { name: true } } },
            },
        },
        take: 20,
        orderBy: { skuCode: 'asc' },
    });

    return results.map(s => ({
        skuCode: s.skuCode,
        productName: s.variation.product.name,
        variationName: s.variation.colorName,
        size: s.size,
        currentBalance: s.currentBalance,
        mrp: s.mrp,
    }));
}

export async function execGetSkuBalance(input: ToolInput) {
    const skuCode = String(input.skuCode ?? '');
    const sku = await prisma.sku.findUnique({
        where: { skuCode },
        include: {
            variation: {
                include: { product: { select: { name: true } } },
            },
        },
    });

    if (!sku) {
        return { error: `SKU "${skuCode}" not found` };
    }

    return {
        skuCode: sku.skuCode,
        productName: sku.variation.product.name,
        variationName: sku.variation.colorName,
        size: sku.size,
        currentBalance: sku.currentBalance,
    };
}

export async function execSearchOrders(input: ToolInput) {
    const query = String(input.query ?? '');
    const orders = await prisma.order.findMany({
        where: {
            OR: [
                { orderNumber: { contains: query, mode: 'insensitive' } },
                { customerName: { contains: query, mode: 'insensitive' } },
            ],
        },
        include: {
            orderLines: {
                include: {
                    sku: {
                        select: {
                            skuCode: true,
                            size: true,
                            variation: {
                                select: {
                                    colorName: true,
                                    product: { select: { name: true } },
                                },
                            },
                        },
                    },
                },
            },
        },
        take: 10,
        orderBy: { orderDate: 'desc' },
    });

    return orders.map(o => ({
        orderNumber: o.orderNumber,
        customerName: o.customerName,
        orderDate: o.orderDate.toISOString().split('T')[0],
        status: o.status,
        totalAmount: o.totalAmount,
        lines: o.orderLines.map(l => ({
            skuCode: l.sku.skuCode,
            productName: l.sku.variation.product.name,
            variationName: l.sku.variation.colorName,
            size: l.sku.size,
            qty: l.qty,
            unitPrice: l.unitPrice,
            lineStatus: l.lineStatus,
        })),
    }));
}

export async function execSearchFabrics(input: ToolInput) {
    const query = String(input.query ?? '');
    const results = await prisma.fabricColour.findMany({
        where: {
            isActive: true,
            OR: [
                { colourName: { contains: query, mode: 'insensitive' } },
                { fabric: { name: { contains: query, mode: 'insensitive' } } },
                { fabric: { material: { name: { contains: query, mode: 'insensitive' } } } },
            ],
        },
        include: {
            fabric: {
                include: { material: { select: { name: true } } },
            },
        },
        take: 20,
        orderBy: { colourName: 'asc' },
    });

    return results.map(fc => ({
        id: fc.id,
        code: fc.code,
        colourName: fc.colourName,
        fabricName: fc.fabric.name,
        materialName: fc.fabric.material?.name ?? null,
        currentBalance: fc.currentBalance,
        unit: fc.fabric.unit,
        costPerUnit: fc.costPerUnit ?? fc.fabric.costPerUnit,
    }));
}

export async function execLookupSku(input: ToolInput) {
    const code = input.code ? String(input.code) : undefined;
    const productName = input.productName ? String(input.productName) : undefined;
    const size = input.size ? String(input.size) : undefined;

    if (code) {
        const sku = await prisma.sku.findUnique({
            where: { skuCode: code },
            include: {
                variation: {
                    include: { product: { select: { name: true } } },
                },
            },
        });
        if (!sku) return { error: `SKU "${code}" not found` };
        return {
            id: sku.id,
            skuCode: sku.skuCode,
            productName: sku.variation.product.name,
            variationName: sku.variation.colorName,
            size: sku.size,
            currentBalance: sku.currentBalance,
        };
    }

    if (productName) {
        const skus = await prisma.sku.findMany({
            where: {
                isActive: true,
                variation: {
                    product: { name: { contains: productName, mode: 'insensitive' } },
                },
                ...(size ? { size: { equals: size, mode: 'insensitive' } } : {}),
            },
            include: {
                variation: {
                    include: { product: { select: { name: true } } },
                },
            },
            take: 20,
            orderBy: { skuCode: 'asc' },
        });

        if (skus.length === 0) return { error: `No SKUs found for product "${productName}"${size ? ` size "${size}"` : ''}` };

        return skus.map(s => ({
            id: s.id,
            skuCode: s.skuCode,
            productName: s.variation.product.name,
            variationName: s.variation.colorName,
            size: s.size,
            currentBalance: s.currentBalance,
        }));
    }

    return { error: 'Provide either "code" or "productName" to look up a SKU' };
}
