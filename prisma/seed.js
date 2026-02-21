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

    // Create materials (replaces old FabricType)
    const linenMaterial = await prisma.material.create({
        data: { name: 'Linen', category: 'fabric' },
    });
    const cottonMaterial = await prisma.material.create({
        data: { name: 'Cotton', category: 'fabric' },
    });
    console.log('✅ Created materials');

    // Create party
    const party = await prisma.party.create({
        data: { name: 'Premium Fabrics Co', category: 'fabric', contactName: 'Rahul Sharma', email: 'rahul@premiumfabrics.com', phone: '+91-9876543210' },
    });

    // Create fabrics (linked to Material, not FabricType)
    const linenFabric = await prisma.fabric.create({
        data: { materialId: linenMaterial.id, name: 'Linen 60 Lea', composition: '100% Linen', costPerUnit: 450, partyId: party.id },
    });
    const cottonFabric = await prisma.fabric.create({
        data: { materialId: cottonMaterial.id, name: 'Organic Cotton', composition: '100% Cotton', costPerUnit: 350, partyId: party.id },
    });
    console.log('✅ Created fabrics');

    // Create fabric colours
    const blueLinenColour = await prisma.fabricColour.create({
        data: { fabricId: linenFabric.id, colourName: 'Wildflower Blue', colourHex: '#6B8E9F', costPerUnit: 450 },
    });
    const beigeLinenColour = await prisma.fabricColour.create({
        data: { fabricId: linenFabric.id, colourName: 'Natural Beige', colourHex: '#D4C4B0', costPerUnit: 420 },
    });
    const whiteCottonColour = await prisma.fabricColour.create({
        data: { fabricId: cottonFabric.id, colourName: 'Pure White', colourHex: '#FFFFFF', costPerUnit: 350 },
    });
    console.log('✅ Created fabric colours');

    // Add initial fabric colour stock
    await prisma.fabricColourTransaction.createMany({
        data: [
            { fabricColourId: blueLinenColour.id, txnType: 'inward', qty: 100, unit: 'meter', reason: 'supplier_receipt', createdById: admin.id },
            { fabricColourId: beigeLinenColour.id, txnType: 'inward', qty: 80, unit: 'meter', reason: 'supplier_receipt', createdById: admin.id },
            { fabricColourId: whiteCottonColour.id, txnType: 'inward', qty: 120, unit: 'meter', reason: 'supplier_receipt', createdById: admin.id },
        ],
    });

    // Create products
    const midiDress = await prisma.product.create({
        data: { name: 'Linen MIDI Dress', category: 'dress', productType: 'basic', baseProductionTimeMins: 90, defaultFabricConsumption: 2.2 },
    });
    const relaxedTop = await prisma.product.create({
        data: { name: 'Relaxed Fit Top', category: 'top', productType: 'basic', baseProductionTimeMins: 45, defaultFabricConsumption: 1.2 },
    });
    console.log('✅ Created products');

    // Create variations (no fabricId — fabric assignment via BOM)
    const blueMidiVar = await prisma.variation.create({
        data: { productId: midiDress.id, colorName: 'Wildflower Blue', colorHex: '#6B8E9F' },
    });
    const beigeMidiVar = await prisma.variation.create({
        data: { productId: midiDress.id, colorName: 'Natural Beige', colorHex: '#D4C4B0' },
    });
    const whiteTopVar = await prisma.variation.create({
        data: { productId: relaxedTop.id, colorName: 'Pure White', colorHex: '#FFFFFF' },
    });

    // Create SKUs (no fabricConsumption — consumption via BOM)
    const sizes = ['XS', 'S', 'M', 'L', 'XL'];
    const skusData = [];

    for (const size of sizes) {
        skusData.push({ skuCode: `LMD-BLU-${size}`, variationId: blueMidiVar.id, size, mrp: 4500, targetStockQty: 5 });
        skusData.push({ skuCode: `LMD-BGE-${size}`, variationId: beigeMidiVar.id, size, mrp: 4500, targetStockQty: 5 });
        skusData.push({ skuCode: `RFT-WHT-${size}`, variationId: whiteTopVar.id, size, mrp: 2200, targetStockQty: 8 });
    }

    for (const skuData of skusData) {
        await prisma.sku.create({ data: skuData });
    }
    console.log('✅ Created SKUs');

    // Set up BOM: create component type + role, then link fabrics via BOM
    const fabricType = await prisma.componentType.upsert({
        where: { code: 'FABRIC' },
        update: {},
        create: { code: 'FABRIC', name: 'Fabric', sortOrder: 1 },
    });
    const mainFabricRole = await prisma.componentRole.upsert({
        where: { code_typeId: { code: 'main', typeId: fabricType.id } },
        update: {},
        create: { code: 'main', name: 'Main Fabric', typeId: fabricType.id, sortOrder: 1 },
    });

    // Product BOM templates (default consumption)
    await prisma.productBomTemplate.createMany({
        data: [
            { productId: midiDress.id, roleId: mainFabricRole.id, defaultQuantity: 2.2, quantityUnit: 'meter', wastagePercent: 5 },
            { productId: relaxedTop.id, roleId: mainFabricRole.id, defaultQuantity: 1.2, quantityUnit: 'meter', wastagePercent: 5 },
        ],
    });

    // Variation BOM lines (fabric colour assignments)
    await prisma.variationBomLine.createMany({
        data: [
            { variationId: blueMidiVar.id, roleId: mainFabricRole.id, fabricColourId: blueLinenColour.id },
            { variationId: beigeMidiVar.id, roleId: mainFabricRole.id, fabricColourId: beigeLinenColour.id },
            { variationId: whiteTopVar.id, roleId: mainFabricRole.id, fabricColourId: whiteCottonColour.id },
        ],
    });
    console.log('✅ Created BOM structure');

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
