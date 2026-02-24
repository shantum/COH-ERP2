/**
 * Chat Agent — Mutating tool executor functions
 *
 * These tools modify data and require user confirmation before execution.
 */

import { prisma } from '../../db/index.js';
import type { ToolInput } from './types.js';

export async function execAddFabricInward(input: ToolInput, userId: string) {
    const fabricColourId = String(input.fabricColourId);
    const qty = Number(input.qty);
    const unit = String(input.unit);
    const costPerUnit = input.costPerUnit != null ? Number(input.costPerUnit) : undefined;
    const notes = input.notes ? String(input.notes) : undefined;

    // Verify the fabric colour exists
    const fc = await prisma.fabricColour.findUnique({
        where: { id: fabricColourId },
        include: { fabric: { select: { name: true } } },
    });
    if (!fc) return { error: `FabricColour with ID "${fabricColourId}" not found` };

    const txn = await prisma.fabricColourTransaction.create({
        data: {
            fabricColourId,
            txnType: 'inward',
            qty,
            unit,
            reason: 'receipt',
            ...(costPerUnit != null ? { costPerUnit } : {}),
            ...(notes ? { notes } : {}),
            createdById: userId,
        },
    });

    return {
        transactionId: txn.id,
        fabricColour: `${fc.fabric.name} - ${fc.colourName}`,
        qty,
        unit,
        message: `Added ${qty} ${unit} inward for ${fc.fabric.name} - ${fc.colourName}`,
    };
}

export async function execAddInventoryInward(input: ToolInput, userId: string) {
    const skuId = String(input.skuId);
    const qty = Math.round(Number(input.qty));
    const reason = String(input.reason);
    const notes = input.notes ? String(input.notes) : undefined;

    const sku = await prisma.sku.findUnique({
        where: { id: skuId },
        select: { skuCode: true },
    });
    if (!sku) return { error: `SKU with ID "${skuId}" not found` };

    const txn = await prisma.inventoryTransaction.create({
        data: {
            skuId,
            txnType: 'inward',
            qty,
            reason,
            ...(notes ? { notes } : {}),
            createdById: userId,
        },
    });

    return {
        transactionId: txn.id,
        skuCode: sku.skuCode,
        qty,
        message: `Added ${qty} units inward for ${sku.skuCode}`,
    };
}

export async function execAddInventoryOutward(input: ToolInput, userId: string) {
    const skuId = String(input.skuId);
    const qty = Math.round(Number(input.qty));
    const reason = String(input.reason);
    const notes = input.notes ? String(input.notes) : undefined;

    const sku = await prisma.sku.findUnique({
        where: { id: skuId },
        select: { skuCode: true, currentBalance: true },
    });
    if (!sku) return { error: `SKU with ID "${skuId}" not found` };
    if (sku.currentBalance < qty) {
        return { error: `Insufficient stock: ${sku.skuCode} has ${sku.currentBalance} units, cannot remove ${qty}` };
    }

    const txn = await prisma.inventoryTransaction.create({
        data: {
            skuId,
            txnType: 'outward',
            qty,
            reason,
            ...(notes ? { notes } : {}),
            createdById: userId,
        },
    });

    return {
        transactionId: txn.id,
        skuCode: sku.skuCode,
        qty,
        message: `Removed ${qty} units from ${sku.skuCode}`,
    };
}

export async function execAdjustInventory(input: ToolInput, userId: string) {
    const skuId = String(input.skuId);
    const newBalance = Math.round(Number(input.newBalance));
    const reason = String(input.reason);
    const notes = input.notes ? String(input.notes) : undefined;

    const sku = await prisma.sku.findUnique({
        where: { id: skuId },
        select: { skuCode: true, currentBalance: true },
    });
    if (!sku) return { error: `SKU with ID "${skuId}" not found` };

    const diff = newBalance - sku.currentBalance;
    if (diff === 0) {
        return { skuCode: sku.skuCode, message: `Balance is already ${newBalance}, no adjustment needed` };
    }

    const txnType = diff > 0 ? 'inward' : 'outward';
    const qty = Math.abs(diff);

    const txn = await prisma.inventoryTransaction.create({
        data: {
            skuId,
            txnType,
            qty,
            reason,
            ...(notes ? { notes } : {}),
            createdById: userId,
        },
    });

    return {
        transactionId: txn.id,
        skuCode: sku.skuCode,
        previousBalance: sku.currentBalance,
        newBalance,
        adjustment: `${txnType} ${qty}`,
        message: `Adjusted ${sku.skuCode} from ${sku.currentBalance} \u2192 ${newBalance} (${txnType} ${qty})`,
    };
}
