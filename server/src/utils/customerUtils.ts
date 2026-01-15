/**
 * Shared customer utilities
 * Consolidates duplicate customer lookup/create logic across the codebase
 *
 * IMPORTANT: Uses upsert pattern to prevent race conditions when
 * concurrent orders from the same customer arrive simultaneously.
 */

import type { PrismaClient, Customer } from '@prisma/client';

/**
 * Prisma error with code property for unique constraint violations
 */
interface PrismaError extends Error {
    code?: string;
    meta?: {
        target?: string[];
    };
}

/**
 * Shopify customer data structure from order/webhook payloads
 */
export interface ShopifyCustomerData {
    id: string | number;
    email?: string | null;
    first_name?: string | null;
    last_name?: string | null;
    phone?: string | null;
    tags?: string | null;
    default_address?: {
        address1?: string;
        address2?: string;
        city?: string;
        province?: string;
        country?: string;
        zip?: string;
    } | null;
}

/**
 * Contact data for manual order creation
 */
export interface CustomerContactData {
    email?: string | null;
    phone?: string | null;
    firstName?: string | null;
    lastName?: string | null;
    defaultAddress?: string | null;
}

/**
 * Options for findOrCreateCustomer
 */
interface FindOrCreateOptions {
    shippingAddress?: Record<string, unknown>;
    orderDate?: Date | string;
}

/**
 * Result of findOrCreateCustomer
 */
export interface FindOrCreateResult {
    customer: Customer | null;
    created: boolean;
}

/**
 * Result of upsertCustomerFromWebhook
 */
export interface UpsertCustomerResult {
    customer: Customer;
    action: 'created' | 'updated';
}

/**
 * Find or create a customer from Shopify customer data
 *
 * Uses upsert on shopifyCustomerId to prevent race conditions where
 * two concurrent orders from the same customer could create duplicate records.
 *
 * @param prisma - Prisma client instance
 * @param shopifyCustomer - Shopify customer object
 * @param options - Additional options
 * @returns Promise with customer and created flag
 */
export async function findOrCreateCustomer(
    prisma: PrismaClient,
    shopifyCustomer: ShopifyCustomerData | null | undefined,
    options: FindOrCreateOptions = {}
): Promise<FindOrCreateResult> {
    if (!shopifyCustomer || !shopifyCustomer.id) {
        return { customer: null, created: false };
    }

    const shopifyCustomerId = String(shopifyCustomer.id);
    const customerEmail = shopifyCustomer.email?.toLowerCase()?.trim() || null;
    const { shippingAddress, orderDate } = options;

    // If we have a Shopify customer ID, use upsert to prevent race conditions
    // This is the primary key for deduplication
    if (shopifyCustomerId) {
        try {
            // First, try to find by shopifyCustomerId (fastest path)
            let customer = await prisma.customer.findUnique({
                where: { shopifyCustomerId }
            });

            if (customer) {
                // Update existing customer with latest data
                const updateData: { lastOrderDate?: Date; defaultAddress?: string } = {};

                // Update last order date if provided
                if (orderDate) {
                    updateData.lastOrderDate = new Date(orderDate);
                }

                // Update address if provided and customer doesn't have one
                if (shippingAddress && !customer.defaultAddress) {
                    updateData.defaultAddress = JSON.stringify(shippingAddress);
                }

                // Only update if there's something to update
                if (Object.keys(updateData).length > 0) {
                    customer = await prisma.customer.update({
                        where: { id: customer.id },
                        data: updateData,
                    });
                }

                return { customer, created: false };
            }

            // Customer not found by Shopify ID - check by email to avoid duplicates
            if (customerEmail) {
                const existingByEmail = await prisma.customer.findUnique({
                    where: { email: customerEmail }
                });

                if (existingByEmail) {
                    // Link existing customer to Shopify ID
                    customer = await prisma.customer.update({
                        where: { id: existingByEmail.id },
                        data: {
                            shopifyCustomerId,
                            lastOrderDate: orderDate ? new Date(orderDate) : existingByEmail.lastOrderDate,
                            defaultAddress: shippingAddress && !existingByEmail.defaultAddress
                                ? JSON.stringify(shippingAddress)
                                : existingByEmail.defaultAddress,
                        }
                    });
                    return { customer, created: false };
                }
            }

            // No existing customer found - create new one
            // Use try-catch to handle race condition where another process creates same customer
            if (customerEmail) {
                try {
                    customer = await prisma.customer.create({
                        data: {
                            email: customerEmail,
                            firstName: shopifyCustomer.first_name || null,
                            lastName: shopifyCustomer.last_name || null,
                            phone: shopifyCustomer.phone || null,
                            tags: shopifyCustomer.tags || null,
                            shopifyCustomerId,
                            defaultAddress: shippingAddress ? JSON.stringify(shippingAddress) : null,
                            firstOrderDate: orderDate ? new Date(orderDate) : null,
                            lastOrderDate: orderDate ? new Date(orderDate) : null,
                        }
                    });
                    return { customer, created: true };
                } catch (createError) {
                    const prismaError = createError as PrismaError;
                    // Unique constraint violation - another process created the customer
                    if (prismaError.code === 'P2002') {
                        // Try to find the customer that was just created
                        customer = await prisma.customer.findFirst({
                            where: {
                                OR: [
                                    { shopifyCustomerId },
                                    { email: customerEmail }
                                ]
                            }
                        });
                        return { customer, created: false };
                    }
                    throw createError;
                }
            }

            return { customer: null, created: false };
        } catch (error) {
            console.error('findOrCreateCustomer error:', error);
            throw error;
        }
    }

    // Fallback: No Shopify customer ID, try by email only
    if (customerEmail) {
        let customer = await prisma.customer.findUnique({
            where: { email: customerEmail }
        });

        if (customer) {
            if (orderDate) {
                customer = await prisma.customer.update({
                    where: { id: customer.id },
                    data: { lastOrderDate: new Date(orderDate) },
                });
            }
            return { customer, created: false };
        }

        // Create new customer
        try {
            customer = await prisma.customer.create({
                data: {
                    email: customerEmail,
                    firstName: shopifyCustomer.first_name || null,
                    lastName: shopifyCustomer.last_name || null,
                    phone: shopifyCustomer.phone || null,
                    defaultAddress: shippingAddress ? JSON.stringify(shippingAddress) : null,
                    firstOrderDate: orderDate ? new Date(orderDate) : null,
                    lastOrderDate: orderDate ? new Date(orderDate) : null,
                }
            });
            return { customer, created: true };
        } catch (createError) {
            const prismaError = createError as PrismaError;
            if (prismaError.code === 'P2002') {
                customer = await prisma.customer.findUnique({ where: { email: customerEmail } });
                return { customer, created: false };
            }
            throw createError;
        }
    }

    return { customer: null, created: false };
}

/**
 * Update customer from Shopify customer webhook data
 * @param prisma - Prisma client instance
 * @param shopifyCustomer - Full Shopify customer object from webhook
 * @returns Promise with customer and action taken
 */
export async function upsertCustomerFromWebhook(
    prisma: PrismaClient,
    shopifyCustomer: ShopifyCustomerData
): Promise<UpsertCustomerResult> {
    const shopifyCustomerId = String(shopifyCustomer.id);
    const customerEmail = shopifyCustomer.email?.toLowerCase()?.trim() || null;

    // Build search conditions
    const searchConditions: Array<{ shopifyCustomerId?: string; email?: string }> = [{ shopifyCustomerId }];
    if (customerEmail) {
        searchConditions.push({ email: customerEmail });
    }

    // Check if customer exists
    let customer = await prisma.customer.findFirst({
        where: { OR: searchConditions.filter(c => c.shopifyCustomerId || c.email) }
    });

    const defaultAddress = shopifyCustomer.default_address;

    if (customer) {
        // For update, use undefined instead of null for optional fields
        customer = await prisma.customer.update({
            where: { id: customer.id },
            data: {
                email: customerEmail ?? undefined,
                firstName: shopifyCustomer.first_name || null,
                lastName: shopifyCustomer.last_name || null,
                phone: shopifyCustomer.phone || null,
                tags: shopifyCustomer.tags || customer.tags || null,
                shopifyCustomerId,
                defaultAddress: defaultAddress ? JSON.stringify(defaultAddress) : null,
            }
        });
        return { customer, action: 'updated' };
    } else {
        // For create, email is required - generate placeholder if not provided
        const emailForCreate = customerEmail || `shopify-${shopifyCustomerId}@placeholder.local`;
        customer = await prisma.customer.create({
            data: {
                email: emailForCreate,
                firstName: shopifyCustomer.first_name || null,
                lastName: shopifyCustomer.last_name || null,
                phone: shopifyCustomer.phone || null,
                tags: shopifyCustomer.tags || null,
                shopifyCustomerId,
                defaultAddress: defaultAddress ? JSON.stringify(defaultAddress) : null,
            }
        });
        return { customer, action: 'created' };
    }
}

/**
 * Find or create a customer from manual order data (email/phone)
 * Used for offline/manual order creation where we don't have Shopify customer data
 * @param prisma - Prisma client instance
 * @param customerData - Customer data
 * @returns Promise with customer record
 */
export async function findOrCreateCustomerByContact(
    prisma: PrismaClient,
    { email, phone, firstName, lastName, defaultAddress }: CustomerContactData
): Promise<Customer> {
    let customer: Customer | null = null;

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
        const customerEmail = email?.toLowerCase().trim() || `${phone!.replace(/\D/g, '')}@phone.local`;
        customer = await prisma.customer.create({
            data: {
                email: customerEmail,
                firstName: firstName ?? null,
                lastName: lastName ?? null,
                phone: phone ?? null,
                defaultAddress: defaultAddress ?? null,
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
