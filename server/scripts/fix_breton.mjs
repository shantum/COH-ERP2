import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function fixBretonStripe() {
    console.log('Fixing Breton Stripe...');

    try {
        const womenCache = await prisma.shopifyProductCache.findUnique({ where: { id: '7338217570501' } });
        if (!womenCache) {
            console.log('Women cache not found');
            return;
        }

        const womenData = JSON.parse(womenCache.rawData);
        const womenSkuCodes = womenData.variants.map(v => v.sku);
        console.log('Women SKUs:', womenSkuCodes);

        const mensProduct = await prisma.product.findFirst({
            where: { name: 'The Breton Stripe Pullover', gender: 'men' }
        });

        if (!mensProduct) {
            console.log('Mens product not found');
            return;
        }

        let womensProduct = await prisma.product.findFirst({
            where: { name: 'The Breton Stripe Pullover', gender: 'women' }
        });

        if (!womensProduct) {
            womensProduct = await prisma.product.create({
                data: {
                    name: 'The Breton Stripe Pullover',
                    category: mensProduct.category,
                    productType: mensProduct.productType,
                    gender: 'women',
                    fabricTypeId: mensProduct.fabricTypeId,
                    baseProductionTimeMins: mensProduct.baseProductionTimeMins,
                    shopifyProductId: '7338217570501',
                    shopifyProductIds: ['7338217570501'],
                    shopifyHandle: 'the-breton-stripe-pullover-women-nautical-blue'
                }
            });
            console.log('Created women product');
        }

        const mensVariation = await prisma.variation.findFirst({
            where: { productId: mensProduct.id, colorName: 'Nautical Blue' }
        });

        if (!mensVariation) {
            console.log('Mens variation not found');
            return;
        }

        let womensVariation = await prisma.variation.findFirst({
            where: { productId: womensProduct.id, colorName: 'Nautical Blue' }
        });

        if (!womensVariation) {
            womensVariation = await prisma.variation.create({
                data: {
                    productId: womensProduct.id,
                    colorName: 'Nautical Blue',
                    fabricId: mensVariation.fabricId,
                    shopifySourceProductId: '7338217570501'
                }
            });
            console.log('Created women variation');
        }

        const result = await prisma.sku.updateMany({
            where: { skuCode: { in: womenSkuCodes } },
            data: { variationId: womensVariation.id }
        });
        console.log('Moved ' + result.count + ' SKUs');

        const products = await prisma.product.findMany({
            where: { name: 'The Breton Stripe Pullover' },
            include: { variations: { include: { skus: true } } }
        });

        console.log('Result:');
        for (const p of products) {
            console.log('  ' + p.name + ' (' + p.gender + '):');
            for (const v of p.variations) {
                console.log('    - ' + v.colorName + ': ' + v.skus.length + ' SKUs');
            }
        }
    } catch (e) {
        console.error('Error:', e);
    }
}

fixBretonStripe().finally(() => prisma.$disconnect());
