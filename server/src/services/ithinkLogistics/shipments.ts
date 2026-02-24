/**
 * iThink Logistics — Shipment operations (create, label, cancel)
 */

import { shippingLogger } from '../../utils/logger.js';
import type { IThinkLabelRequestData } from '../../types/ithinkApi.js';
import { axiosWithRetry, axios, API_TIMEOUT_MS } from './axiosClient.js';
import { isConfigured, isFullyConfigured } from './config.js';
import type {
    ClientContext,
    ShipmentRequest,
    CreateOrderResult,
    LabelOptions,
    ShippingLabelResult,
    CancelShipmentResult,
    CancellationResult,
} from './types.js';

/**
 * Create a new order/shipment with iThink Logistics
 * This books the shipment and returns an AWB number
 */
export async function createOrder(ctx: ClientContext, orderData: ShipmentRequest): Promise<CreateOrderResult> {
    if (!isFullyConfigured(ctx)) {
        throw new Error('iThink Logistics not fully configured. Need credentials and warehouse IDs.');
    }

    const {
        orderNumber,
        orderDate,
        totalAmount,
        customer,
        products,
        dimensions,
        paymentMode = 'Prepaid',
        codAmount = 0,
        logistics,
    } = orderData;

    // Format order date as DD-MM-YYYY
    const formattedDate = orderDate instanceof Date
        ? `${String(orderDate.getDate()).padStart(2, '0')}-${String(orderDate.getMonth() + 1).padStart(2, '0')}-${orderDate.getFullYear()}`
        : orderDate;

    // Build shipment object per iThink API v3 spec
    const shipment = {
        waybill: '', // Empty - iThink will generate
        order: orderNumber,
        sub_order: '',
        order_date: formattedDate,
        total_amount: String(totalAmount),
        // Customer details
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
        // Charges
        shipping_charges: '0',
        giftwrap_charges: '0',
        transaction_charges: '0',
        total_discount: '0',
        first_attemp_discount: '0',
        cod_charges: '0',
        advance_amount: '0',
        cod_amount: paymentMode.toUpperCase() === 'COD' ? String(codAmount) : '0',
        payment_mode: paymentMode.toUpperCase() === 'COD' ? 'COD' : 'Prepaid',
        // Other
        reseller_name: '',
        eway_bill_number: '',
        gst_number: '',
        what3words: '',
        return_address_id: ctx.returnAddressId,
    };

    const requestData = {
        data: {
            shipments: [shipment],
            pickup_address_id: ctx.pickupAddressId,
            access_token: ctx.accessToken,
            secret_key: ctx.secretKey,
            logistics: logistics || ctx.defaultLogistics,
            s_type: '', // air/surface - optional
            order_type: 'forward', // forward/reverse
        }
    };

    shippingLogger.info({ orderNumber, logistics: logistics || ctx.defaultLogistics }, 'Creating iThink order');

    const response = await axiosWithRetry(
        () => axios.post(`${ctx.orderBaseUrl}/order/add.json`, requestData, {
            headers: { 'Content-Type': 'application/json' },
            timeout: API_TIMEOUT_MS
        }),
        `createOrder:${orderNumber}`
    );

    // Log full response for debugging
    shippingLogger.debug({ orderNumber, response: response.data }, 'iThink response received');

    // Handle top-level error response
    if (response.data.status === 'error' || response.data.status_code === 400 || response.data.status_code === 500) {
        const errorMsg = response.data.message || response.data.html_message || 'Order creation failed';
        shippingLogger.error({ orderNumber, error: errorMsg }, 'iThink error response');
        throw new Error(`iThink API error: ${errorMsg}`);
    }

    // Success response - extract AWB from response
    const dataObj = response.data?.data;

    // Defensive null checks for API response
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

    // Check if the logistics provider returned an error
    if (result.status === 'error') {
        throw new Error(result.remark || result.reason || 'Logistics provider rejected the order');
    }

    if (!result.waybill) {
        throw new Error(`No AWB number in iThink response: ${JSON.stringify(result)}`);
    }

    shippingLogger.info({ orderNumber, awbNumber: result.waybill }, 'iThink order created successfully');

    return {
        success: true,
        awbNumber: result.waybill,
        orderId: result.order_id,
        logistics: logistics || ctx.defaultLogistics,
        rawResponse: response.data,
    };
}

/**
 * Get shipping label PDF for AWB number(s)
 * Returns URL to the PDF label file
 */
export async function getShippingLabel(
    ctx: ClientContext,
    awbNumbers: string | string[],
    options: LabelOptions = {}
): Promise<ShippingLabelResult> {
    if (!isConfigured(ctx)) {
        throw new Error('iThink Logistics credentials not configured');
    }

    // Normalize to comma-separated string
    const awbList = Array.isArray(awbNumbers) ? awbNumbers.join(',') : awbNumbers;

    if (!awbList) {
        throw new Error('AWB number(s) required');
    }

    const {
        pageSize = 'A4',
        displayCodPrepaid,
        displayShipperMobile,
        displayShipperAddress,
    } = options;

    const labelRequestData: IThinkLabelRequestData = {
        awb_numbers: awbList,
        page_size: pageSize,
        access_token: ctx.accessToken,
        secret_key: ctx.secretKey,
        ...(displayCodPrepaid !== undefined && { display_cod_prepaid: displayCodPrepaid ? '1' : '0' }),
        ...(displayShipperMobile !== undefined && { display_shipper_mobile: displayShipperMobile ? '1' : '0' }),
        ...(displayShipperAddress !== undefined && { display_shipper_address: displayShipperAddress ? '1' : '0' }),
    };

    const requestData = { data: labelRequestData };

    const response = await axiosWithRetry(
        () => axios.post(`${ctx.orderBaseUrl}/shipping/label.json`, requestData, {
            headers: { 'Content-Type': 'application/json' },
            timeout: API_TIMEOUT_MS
        }),
        `getShippingLabel:${awbList}`
    );

    shippingLogger.debug({ awbNumbers: awbList, response: response.data }, 'iThink shipping label response');

    if (response.data.status !== 'success' || response.data.status_code !== 200) {
        const errorMsg = response.data.message || response.data.html_message || 'Label generation failed';
        throw new Error(`iThink API error: ${errorMsg}`);
    }

    return {
        success: true,
        labelUrl: response.data.file_name,
        rawResponse: response.data,
    };
}

/**
 * Cancel shipment(s) by AWB number(s)
 */
export async function cancelShipment(
    ctx: ClientContext,
    awbNumbers: string | string[]
): Promise<CancelShipmentResult> {
    if (!isConfigured(ctx)) {
        throw new Error('iThink Logistics credentials not configured');
    }

    // Normalize to array
    const awbList = Array.isArray(awbNumbers) ? awbNumbers : [awbNumbers];
    if (awbList.length > 100) {
        throw new Error('Maximum 100 AWB numbers per cancellation request');
    }

    shippingLogger.info({ awbList, count: awbList.length }, 'Cancelling iThink shipments');

    const response = await axiosWithRetry(
        () => axios.post(`${ctx.orderBaseUrl}/order/cancel.json`, {
            data: {
                access_token: ctx.accessToken,
                secret_key: ctx.secretKey,
                awb_numbers: awbList.join(',')
            }
        }, {
            headers: { 'Content-Type': 'application/json' },
            timeout: API_TIMEOUT_MS
        }),
        `cancelShipment:${awbList.join(',')}`
    );

    shippingLogger.debug({ awbList, response: response.data }, 'iThink cancel response');

    // Handle error response
    if (response.data.status === 'error' || response.data.status_code === 400) {
        const errorMsg = response.data.html_message || response.data.message || 'Cancellation failed';
        throw new Error(`iThink API error: ${errorMsg}`);
    }

    // Process results - data is object with numeric keys
    const results: Record<string, CancellationResult> = {};
    const dataObj = response.data.data || {};

    for (const key of Object.keys(dataObj)) {
        const item = dataObj[key];
        const awb = awbList[parseInt(key) - 1] || item.refnum;
        results[awb] = {
            success: item.status?.toLowerCase() === 'success',
            status: item.status,
            remark: item.remark || '',
            refnum: item.refnum,
        };
    }

    return {
        success: true,
        results,
        rawResponse: response.data,
    };
}
