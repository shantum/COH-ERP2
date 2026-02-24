/**
 * iThink Logistics — Pincode check and rate operations
 */

import { shippingLogger } from '../../utils/logger.js';
import type {
    IThinkRawPincodeData,
    IThinkRawProviderInfo,
} from '../../types/ithinkApi.js';
import { isProviderInfo } from '../../types/ithinkApi.js';
import { axiosWithRetry, axios, API_TIMEOUT_MS } from './axiosClient.js';
import { isConfigured } from './config.js';
import type {
    ClientContext,
    PincodeCheckResult,
    PincodeProvider,
    RateCheckParams,
    RateCheckResult,
    RateInfo,
} from './types.js';

/**
 * Check pincode serviceability
 * Returns logistics providers that can service the pincode with their capabilities
 */
export async function checkPincode(ctx: ClientContext, pincode: string): Promise<PincodeCheckResult> {
    if (!isConfigured(ctx)) {
        throw new Error('iThink Logistics credentials not configured');
    }

    if (!pincode) {
        throw new Error('Pincode is required');
    }

    const response = await axiosWithRetry(
        () => axios.post(`${ctx.orderBaseUrl}/pincode/check.json`, {
            data: {
                pincode: String(pincode),
                access_token: ctx.accessToken,
                secret_key: ctx.secretKey,
            }
        }, {
            headers: { 'Content-Type': 'application/json' },
            timeout: API_TIMEOUT_MS
        }),
        `checkPincode:${pincode}`
    );

    shippingLogger.debug({ pincode, response: response.data }, 'iThink pincode check response');

    if (response.data.status !== 'success' || response.data.status_code !== 200) {
        const errorMsg = response.data.message || response.data.html_message || 'Pincode check failed';
        throw new Error(`iThink API error: ${errorMsg}`);
    }

    // Parse response - data is { "pincode": { "provider": { ... } } }
    // Also contains metadata fields like remark, state_name, city_name, etc.
    const pincodeData = (response.data.data?.[pincode] || {}) as IThinkRawPincodeData;
    const providers: PincodeProvider[] = [];

    for (const [providerName, details] of Object.entries(pincodeData)) {
        // Use type guard to check if it's a provider info object
        if (isProviderInfo(details)) {
            const providerDetails = details as IThinkRawProviderInfo;
            providers.push({
                logistics: providerName,
                supportsCod: providerDetails.cod === 'Y',
                supportsPrepaid: providerDetails.prepaid === 'Y',
                supportsPickup: providerDetails.pickup === 'Y',
                district: providerDetails.district || '',
                stateCode: providerDetails.state_code || '',
                sortCode: providerDetails.sort_code || '',
            });
        }
    }

    // Extract metadata (non-provider fields)
    const metadata = {
        stateName: typeof pincodeData.state_name === 'string' ? pincodeData.state_name : '',
        cityName: typeof pincodeData.city_name === 'string' ? pincodeData.city_name : '',
        remark: typeof pincodeData.remark === 'string' ? pincodeData.remark : '',
    };

    return {
        success: true,
        pincode,
        serviceable: providers.length > 0,
        city: metadata.cityName,
        state: metadata.stateName,
        providers,
        rawResponse: response.data,
    };
}

/**
 * Get shipping rates for a package
 * Returns available logistics providers with rates, zones, and delivery TAT
 */
export async function getRates(ctx: ClientContext, params: RateCheckParams): Promise<RateCheckResult> {
    if (!isConfigured(ctx)) {
        throw new Error('iThink Logistics credentials not configured');
    }

    const {
        fromPincode,
        toPincode,
        length = 10,
        width = 10,
        height = 5,
        weight = 0.5,
        orderType = 'forward',
        paymentMethod = 'prepaid',
        productMrp = 0,
    } = params;

    if (!fromPincode || !toPincode) {
        throw new Error('fromPincode and toPincode are required');
    }

    const response = await axiosWithRetry(
        () => axios.post(`${ctx.orderBaseUrl}/rate/check.json`, {
            data: {
                from_pincode: String(fromPincode),
                to_pincode: String(toPincode),
                shipping_length_cms: String(length),
                shipping_width_cms: String(width),
                shipping_height_cms: String(height),
                shipping_weight_kg: String(weight),
                order_type: orderType,
                payment_method: paymentMethod.toLowerCase(),
                product_mrp: String(productMrp),
                access_token: ctx.accessToken,
                secret_key: ctx.secretKey,
            }
        }, {
            headers: { 'Content-Type': 'application/json' },
            timeout: API_TIMEOUT_MS
        }),
        `getRates:${fromPincode}->${toPincode}`
    );

    shippingLogger.debug({ fromPincode, toPincode, response: response.data }, 'iThink rate check response');

    if (response.data.status !== 'success' || response.data.status_code !== 200) {
        const errorMsg = response.data.message || response.data.html_message || 'Rate check failed';
        throw new Error(`iThink API error: ${errorMsg}`);
    }

    // Parse rates - data is array of rate options
    const rates: RateInfo[] = [];
    const dataArr = Array.isArray(response.data.data) ? response.data.data : Object.values(response.data.data || {});
    for (const provider of dataArr) {
        rates.push({
            logistics: provider.logistic_name,
            serviceType: provider.service_type || '', // "Surface", "Air", etc.
            logisticId: provider.logistic_id || provider.logistic_service_type || '',
            rate: parseFloat(provider.rate) || 0,
            freightCharges: parseFloat(provider.freight_charges) || 0,
            codCharges: parseFloat(provider.cod_charges) || 0,
            gstCharges: parseFloat(provider.gst_charges) || 0,
            rtoCharges: parseFloat(provider.rto_charges) || 0,
            zone: provider.logistics_zone,
            deliveryTat: provider.delivery_tat,
            weightSlab: provider.weight_slab || '0.50', // "0.50", "1.00", "2.00", "5.00" kg
            supportsCod: provider.cod === 'Y',
            supportsPrepaid: provider.prepaid === 'Y',
            supportsPickup: provider.pickup === 'Y',
            supportsReversePickup: provider.rev_pickup === 'Y',
        });
    }

    // Sort by rate (lowest first)
    rates.sort((a, b) => a.rate - b.rate);

    return {
        success: true,
        zone: response.data.zone,
        expectedDelivery: response.data.expected_delivery_date,
        rates,
        rawResponse: response.data,
    };
}
