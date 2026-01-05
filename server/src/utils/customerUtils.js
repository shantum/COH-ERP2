/**
 * Shared customer utilities
 * Consolidates duplicate customer lookup/create logic across the codebase
 */

/**
 * Find or create a customer from Shopify customer data
 * @param {PrismaClient} prisma - Prisma client instance
 * @param {Object} shopifyCustomer - Shopify customer object
 * @param {Object} options - Additional options
 * @param {Object} options.shippingAddress - Shipping address to store
 * @param {Date} options.orderDate - Date of the order (for firstOrderDate/lastOrderDate)
 * @returns {Promise<{customer: Object|null, created: boolean}>}
 */
export async function findOrCreateCustomer(prisma, shopifyCustomer, options = {}) {
    if (!shopifyCustomer || !shopifyCustomer.id) {
        return { customer: null, created: false };
    }

    const shopifyCustomerId = String(shopifyCustomer.id);
    const customerEmail = shopifyCustomer.email?.toLowerCase()?.trim() || null;
    const { shippingAddress, orderDate } = options;

    // Build search conditions
    const searchConditions = [{ shopifyCustomerId }];
    if (customerEmail) {
        searchConditions.push({ email: customerEmail });
    }

    // Try to find existing customer
    let customer = await prisma.customer.findFirst({
        where: { OR: searchConditions }
    });

    let created = false;

    if (customer) {
        // Update existing customer with latest data
        const updateData = {
            shopifyCustomerId, // Ensure Shopify ID is linked
        };

        // Update last order date if provided
        if (orderDate) {
            updateData.lastOrderDate = new Date(orderDate);
        }

        // Update address if provided and customer doesn't have one
        if (shippingAddress && !customer.defaultAddress) {
            updateData.defaultAddress = JSON.stringify(shippingAddress);
        }

        await prisma.customer.update({
            where: { id: customer.id },
            data: updateData,
        });
    } else if (customerEmail) {
        // Create new customer
        customer = await prisma.customer.create({
            data: {
                email: customerEmail,
                firstName: shopifyCustomer.first_name || null,
                lastName: shopifyCustomer.last_name || null,
                phone: shopifyCustomer.phone || null,
                shopifyCustomerId,
                defaultAddress: shippingAddress ? JSON.stringify(shippingAddress) : null,
                firstOrderDate: orderDate ? new Date(orderDate) : null,
                lastOrderDate: orderDate ? new Date(orderDate) : null,
                totalOrders: shopifyCustomer.orders_count || 0,
                totalSpent: parseFloat(shopifyCustomer.total_spent) || 0,
            }
        });
        created = true;
    }

    return { customer, created };
}

/**
 * Update customer from Shopify customer webhook data
 * @param {PrismaClient} prisma - Prisma client instance
 * @param {Object} shopifyCustomer - Full Shopify customer object from webhook
 * @returns {Promise<{customer: Object, action: string}>}
 */
export async function upsertCustomerFromWebhook(prisma, shopifyCustomer) {
    const shopifyCustomerId = String(shopifyCustomer.id);
    const customerEmail = shopifyCustomer.email?.toLowerCase()?.trim() || null;

    // Build search conditions
    const searchConditions = [{ shopifyCustomerId }];
    if (customerEmail) {
        searchConditions.push({ email: customerEmail });
    }

    // Check if customer exists
    let customer = await prisma.customer.findFirst({
        where: { OR: searchConditions.filter(c => c.shopifyCustomerId || c.email) }
    });

    const defaultAddress = shopifyCustomer.default_address;

    const customerData = {
        email: customerEmail,
        firstName: shopifyCustomer.first_name || null,
        lastName: shopifyCustomer.last_name || null,
        phone: shopifyCustomer.phone || null,
        shopifyCustomerId,
        defaultAddress: defaultAddress ? JSON.stringify(defaultAddress) : null,
        totalOrders: shopifyCustomer.orders_count || 0,
        totalSpent: parseFloat(shopifyCustomer.total_spent) || 0,
    };

    if (customer) {
        await prisma.customer.update({
            where: { id: customer.id },
            data: customerData
        });
        return { customer, action: 'updated' };
    } else {
        customer = await prisma.customer.create({
            data: customerData
        });
        return { customer, action: 'created' };
    }
}

/**
 * Find customer by various identifiers
 * @param {PrismaClient} prisma - Prisma client instance
 * @param {Object} identifiers - Customer identifiers
 * @param {string} identifiers.shopifyCustomerId - Shopify customer ID
 * @param {string} identifiers.email - Customer email
 * @param {string} identifiers.phone - Customer phone
 * @returns {Promise<Object|null>}
 */
export async function findCustomer(prisma, { shopifyCustomerId, email, phone }) {
    const conditions = [];

    if (shopifyCustomerId) {
        conditions.push({ shopifyCustomerId: String(shopifyCustomerId) });
    }
    if (email) {
        conditions.push({ email: email.toLowerCase().trim() });
    }
    if (phone) {
        conditions.push({ phone });
    }

    if (conditions.length === 0) {
        return null;
    }

    return prisma.customer.findFirst({
        where: { OR: conditions }
    });
}
