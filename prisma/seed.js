import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function main() {
    console.log('🌱 Seeding database...');

    // Create admin user
    const hashedPassword = await bcrypt.hash('admin123', 10);
    const admin = await prisma.user.upsert({
        where: { email: 'admin@coh.com' },
        update: {},
        create: { email: 'admin@coh.com', password: hashedPassword, name: 'Admin User', role: 'admin' },
    });
    console.log('✅ Created admin user');

    // Create cost config
    await prisma.costConfig.upsert({
        where: { id: 'default-config' },
        update: {},
        create: { id: 'default-config', laborRatePerMin: 2.50, defaultPackagingCost: 50 },
    });

    // Create fabric types
    const linenType = await prisma.fabricType.create({
        data: { name: 'Linen 60 Lea', composition: '100% Linen', unit: 'meter', avgShrinkagePct: 5 },
    });
    const cottonType = await prisma.fabricType.create({
        data: { name: 'Organic Cotton', composition: '100% Cotton', unit: 'meter', avgShrinkagePct: 3 },
    });
    console.log('✅ Created fabric types');

    // Create supplier
    const supplier = await prisma.supplier.create({
        data: { name: 'Premium Fabrics Co', contactName: 'Rahul Sharma', email: 'rahul@premiumfabrics.com', phone: '+91-9876543210' },
    });

    // Create fabrics
    const blueLinenFabric = await prisma.fabric.create({
        data: { fabricTypeId: linenType.id, name: 'Linen Wildflower Blue 60 Lea', colorName: 'Wildflower Blue', colorHex: '#6B8E9F', costPerUnit: 450, supplierId: supplier.id, leadTimeDays: 14, minOrderQty: 20 },
    });
    const beigeLinenFabric = await prisma.fabric.create({
        data: { fabricTypeId: linenType.id, name: 'Linen Natural Beige 60 Lea', colorName: 'Natural Beige', colorHex: '#D4C4B0', costPerUnit: 420, supplierId: supplier.id, leadTimeDays: 14, minOrderQty: 20 },
    });
    const whiteCottonFabric = await prisma.fabric.create({
        data: { fabricTypeId: cottonType.id, name: 'Organic Cotton White', colorName: 'Pure White', colorHex: '#FFFFFF', costPerUnit: 350, supplierId: supplier.id, leadTimeDays: 10, minOrderQty: 25 },
    });
    console.log('✅ Created fabrics');

    // Add initial fabric stock
    await prisma.fabricTransaction.createMany({
        data: [
            { fabricId: blueLinenFabric.id, txnType: 'inward', qty: 100, unit: 'meter', reason: 'supplier_receipt', createdById: admin.id },
            { fabricId: beigeLinenFabric.id, txnType: 'inward', qty: 80, unit: 'meter', reason: 'supplier_receipt', createdById: admin.id },
            { fabricId: whiteCottonFabric.id, txnType: 'inward', qty: 120, unit: 'meter', reason: 'supplier_receipt', createdById: admin.id },
        ],
    });

    // Create products
    const midiDress = await prisma.product.create({
        data: { name: 'Linen MIDI Dress', category: 'dress', productType: 'basic', baseProductionTimeMins: 90 },
    });
    const relaxedTop = await prisma.product.create({
        data: { name: 'Relaxed Fit Top', category: 'top', productType: 'basic', baseProductionTimeMins: 45 },
    });
    console.log('✅ Created products');

    // Create variations
    const blueMidiVar = await prisma.variation.create({
        data: { productId: midiDress.id, colorName: 'Wildflower Blue', colorHex: '#6B8E9F', fabricId: blueLinenFabric.id },
    });
    const beigeMidiVar = await prisma.variation.create({
        data: { productId: midiDress.id, colorName: 'Natural Beige', colorHex: '#D4C4B0', fabricId: beigeLinenFabric.id },
    });
    const whiteTopVar = await prisma.variation.create({
        data: { productId: relaxedTop.id, colorName: 'Pure White', colorHex: '#FFFFFF', fabricId: whiteCottonFabric.id },
    });

    // Create SKUs with barcodes
    const sizes = ['XS', 'S', 'M', 'L', 'XL'];
    const skusData = [];
    let barcodeCounter = 10000001; // Start with 8-digit barcode

    for (const size of sizes) {
        skusData.push({ skuCode: `LMD-BLU-${size}`, variationId: blueMidiVar.id, size, fabricConsumption: 2.2, mrp: 4500, targetStockQty: 5, barcode: String(barcodeCounter++) });
        skusData.push({ skuCode: `LMD-BGE-${size}`, variationId: beigeMidiVar.id, size, fabricConsumption: 2.2, mrp: 4500, targetStockQty: 5, barcode: String(barcodeCounter++) });
        skusData.push({ skuCode: `RFT-WHT-${size}`, variationId: whiteTopVar.id, size, fabricConsumption: 1.2, mrp: 2200, targetStockQty: 8, barcode: String(barcodeCounter++) });
    }

    for (const skuData of skusData) {
        await prisma.sku.create({ data: skuData });
    }
    console.log('✅ Created SKUs with barcodes');

    // Add some initial inventory
    const allSkus = await prisma.sku.findMany();
    for (const sku of allSkus.slice(0, 5)) {
        await prisma.inventoryTransaction.create({
            data: { skuId: sku.id, txnType: 'inward', qty: 3, reason: 'production', createdById: admin.id },
        });
    }
    console.log('✅ Created initial inventory');

    // Create tailors
    await prisma.tailor.createMany({
        data: [
            { name: 'Meera Devi', specializations: 'dress,top', dailyCapacityMins: 480 },
            { name: 'Lakshmi Amma', specializations: 'dress,bottom', dailyCapacityMins: 480 },
            { name: 'Radha Kumari', specializations: 'top,outerwear', dailyCapacityMins: 420 },
        ],
    });
    console.log('✅ Created tailors');

    // Create sample customer
    const customer = await prisma.customer.create({
        data: { email: 'priya@example.com', firstName: 'Priya', lastName: 'Sharma', phone: '+91-9876543211', acceptsMarketing: true },
    });

    // Create sample order
    const firstSku = allSkus[0];
    await prisma.order.create({
        data: {
            orderNumber: 'COH-0001',
            channel: 'shopify',
            customerId: customer.id,
            customerName: 'Priya Sharma',
            customerEmail: 'priya@example.com',
            customerPhone: '+91-9876543211',
            shippingAddress: JSON.stringify({ line1: '123 MG Road', city: 'Bangalore', state: 'Karnataka', pincode: '560001' }),
            totalAmount: 4500,
            orderLines: {
                create: [{ skuId: firstSku.id, qty: 1, unitPrice: 4500, lineStatus: 'pending' }],
            },
        },
    });
    console.log('✅ Created sample order');

    console.log('🎉 Seeding complete!');
}

main()
    .catch((e) => { console.error(e); process.exit(1); })
    .finally(async () => { await prisma.$disconnect(); });
