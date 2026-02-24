/**
 * iThink Logistics — Reverse pickup / return operations
 */

import { shippingLogger } from '../../utils/logger.js';
import { axiosWithRetry, axios, API_TIMEOUT_MS } from './axiosClient.js';
import { isFullyConfigured } from './config.js';
import { checkPincode } from './rates.js';
import type {
    ClientContext,
    ReversePickupRequest,
    ReversePickupResult,
    ReversePickupServiceability,
} from './types.js';

/**
 * Check if a pincode supports reverse pickup
 * Only Delhivery supports reverse pickups in iThink
 */
export async function checkReversePickupServiceability(
    ctx: ClientContext,
    pincode: string
): Promise<ReversePickupServiceability> {
    try {
        const result = await checkPincode(ctx, pincode);

        if (!result.serviceable) {
            return {
                serviceable: false,
                message: 'Pincode is not serviceable',
            };
        }

        // Find Delhivery provider with reverse pickup support
        const delhivery = result.providers.find(
            p => p.logistics.toLowerCase() === 'delhivery' && p.supportsPickup
        );

        if (!delhivery) {
            return {
                serviceable: false,
                message: 'Reverse pickup not available for this pincode (Delhivery only)',
            };
        }

        return {
            serviceable: true,
            provider: 'Delhivery',
        };
    } catch (error: unknown) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        shippingLogger.error({ pincode, error: message }, 'Reverse pickup serviceability check failed');
        return {
            serviceable: false,
            message: `Failed to check serviceability: ${message}`,
        };
    }
}

/**
 * Create a reverse pickup (return shipment) with iThink Logistics
 * Only Delhivery supports reverse pickups
 *
 * NOTE: For reverse shipments:
 * - pickup_address_id = customer address (pickup FROM)
 * - return_address_id = warehouse (deliver TO)
 * - payment_mode must be 'Prepaid' (COD not supported for reverse)
 */
export async function createReversePickup(
    ctx: ClientContext,
    request: ReversePickupRequest
): Promise<ReversePickupResult> {
    if (!isFullyConfigured(ctx)) {
        throw new Error('iThink Logistics not fully configured. Need credentials and warehouse IDs.');
    }

    const {
        orderNumber,
        orderDate,
        customer,
        products,
        dimensions,
    } = request;

    // Format order date as DD-MM-YYYY
    const formattedDate = orderDate instanceof Date
        ? `${String(orderDate.getDate()).padStart(2, '0')}-${String(orderDate.getMonth() + 1).padStart(2, '0')}-${orderDate.getFullYear()}`
        : orderDate;

    // Calculate total amount from products
    const totalAmount = products.reduce((sum, p) => sum + (p.price * p.quantity), 0);

    // Build reverse shipment object
    // For reverse: customer is pickup location, warehouse is destination
    const shipment = {
        waybill: '', // Empty - iThink will generate
        order: orderNumber,
        sub_order: '',
        order_date: formattedDate,
        total_amount: String(totalAmount),
        // Customer details (pickup location)
        name: customer.name,
        company_name: '',
        add: customer.address,
        add2: customer.address2 || '',
        add3: '',
        pin: String(customer.pincode),
        city: customer.city || '',
        state: customer.state || '',
        country: 'India',
        phone: String(customer.phone),
        alt_phone: '',
        email: customer.email || '',
        // Billing same as shipping
        is_billing_same_as_shipping: 'yes',
        billing_name: customer.name,
        billing_company_name: '',
        billing_add: customer.address,
        billing_add2: customer.address2 || '',
        billing_add3: '',
        billing_pin: String(customer.pincode),
        billing_city: customer.city || '',
        billing_state: customer.state || '',
        billing_country: 'India',
        billing_phone: String(customer.phone),
        billing_alt_phone: '',
        billing_email: customer.email || '',
        // Products
        products: products.map(p => ({
            product_name: p.name,
            product_sku: p.sku || '',
            product_quantity: String(p.quantity),
            product_price: String(p.price),
            product_tax_rate: '0',
            product_hsn_code: '',
            product_discount: '0',
        })),
        // Dimensions (weight in kg, dimensions in cm)
        shipment_length: String(dimensions.length || 10),
        shipment_width: String(dimensions.width || 10),
        shipment_height: String(dimensions.height || 5),
        weight: String(dimensions.weight || 0.5),
        // Charges - all zero for reverse
        shipping_charges: '0',
        giftwrap_charges: '0',
        transaction_charges: '0',
        total_discount: '0',
        first_attemp_discount: '0',
        cod_charges: '0',
        advance_amount: '0',
        cod_amount: '0', // No COD for reverse
        payment_mode: 'Prepaid', // MUST be Prepaid for reverse
        // Other
        reseller_name: '',
        eway_bill_number: '',
        gst_number: '',
        what3words: '',
        // For reverse: return_address_id is the destination (warehouse)
        return_address_id: ctx.returnAddressId,
    };

    const requestData = {
        data: {
            shipments: [shipment],
            // For reverse: pickup_address_id is where to pick up FROM (we use return address as source)
            // But actually, for reverse pickups the customer address is in the shipment
            // and pickup_address_id becomes the delivery destination
            pickup_address_id: ctx.pickupAddressId,
            access_token: ctx.accessToken,
            secret_key: ctx.secretKey,
            logistics: 'delhivery', // ONLY Delhivery supports reverse
            s_type: '',
            order_type: 'reverse', // KEY: This makes it a reverse pickup
        }
    };

    shippingLogger.info({ orderNumber, pincode: customer.pincode }, 'Creating iThink reverse pickup');

    const response = await axiosWithRetry(
        () => axios.post(`${ctx.orderBaseUrl}/order/add.json`, requestData, {
            headers: { 'Content-Type': 'application/json' },
            timeout: API_TIMEOUT_MS
        }),
        `createReversePickup:${orderNumber}`
    );

    shippingLogger.debug({ orderNumber, response: response.data }, 'iThink reverse pickup response');

    // Handle error response
    if (response.data.status === 'error' || response.data.status_code === 400 || response.data.status_code === 500) {
        const errorMsg = response.data.message || response.data.html_message || 'Reverse pickup creation failed';
        shippingLogger.error({ orderNumber, error: errorMsg }, 'iThink reverse pickup error');
        throw new Error(`iThink API error: ${errorMsg}`);
    }

    // Parse response - same format as forward orders
    const dataObj = response.data?.data;
    if (!dataObj || typeof dataObj !== 'object') {
        throw new Error(`Invalid response format from iThink API: ${JSON.stringify(response.data)}`);
    }

    const keys = Object.keys(dataObj);
    if (keys.length === 0) {
        throw new Error('Empty response data from iThink API');
    }

    const firstKey = keys[0];
    const result = dataObj[firstKey];

    if (!result) {
        throw new Error(`No result data in iThink response for key: ${firstKey}`);
    }

    if (result.status === 'error') {
        throw new Error(result.remark || result.reason || 'Logistics provider rejected the reverse pickup');
    }

    if (!result.waybill) {
        throw new Error(`No AWB number in iThink response: ${JSON.stringify(result)}`);
    }

    shippingLogger.info({ orderNumber, awbNumber: result.waybill }, 'iThink reverse pickup created');

    return {
        success: true,
        awbNumber: result.waybill,
        logistics: 'delhivery',
        estimatedPickupDate: result.estimated_pickup_date,
        rawResponse: response.data,
    };
}
