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
 * Find or create a customer from manual order data (email/phone)
 * Used for offline/manual order creation where we don't have Shopify customer data
 * @param {PrismaClient} prisma - Prisma client instance
 * @param {Object} customerData - Customer data
 * @param {string} customerData.email - Customer email
 * @param {string} customerData.phone - Customer phone
 * @param {string} customerData.firstName - Customer first name
 * @param {string} customerData.lastName - Customer last name
 * @param {string} customerData.defaultAddress - Default address (JSON string or plain text)
 * @returns {Promise<Object>} Customer record
 */
export async function findOrCreateCustomerByContact(prisma, { email, phone, firstName, lastName, defaultAddress }) {
    let customer = null;

    // Try to find by email first
    if (email) {
        customer = await prisma.customer.findUnique({ where: { email: email.toLowerCase().trim() } });
    }

    // If no email or not found, try by phone
    if (!customer && phone) {
        customer = await prisma.customer.findFirst({ where: { phone } });
    }

    // Create new customer if not found
    if (!customer) {
        const customerEmail = email?.toLowerCase().trim() || `${phone.replace(/\D/g, '')}@phone.local`;
        customer = await prisma.customer.create({
            data: {
                email: customerEmail,
                firstName,
                lastName,
                phone,
                defaultAddress,
            },
        });
    } else if (phone && !customer.phone) {
        // Update phone if customer exists but doesn't have phone
        customer = await prisma.customer.update({
            where: { id: customer.id },
            data: { phone },
        });
    }

    return customer;
}
