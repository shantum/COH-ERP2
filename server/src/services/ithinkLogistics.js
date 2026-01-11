/**
 * iThink Logistics API Integration
 * Provides real-time shipment tracking from logistics provider
 */

import axios from 'axios';
import prisma from '../lib/prisma.js';

class IThinkLogisticsClient {
    constructor() {
        // Different base URLs for different endpoints
        this.trackingBaseUrl = 'https://api.ithinklogistics.com/api_v3';
        this.orderBaseUrl = 'https://my.ithinklogistics.com/api_v3';
        this.accessToken = null;
        this.secretKey = null;
        this.pickupAddressId = null;
        this.returnAddressId = null;
        this.defaultLogistics = 'delhivery'; // delhivery, bluedart, xpressbees, ecom, ekart
    }

    /**
     * Load credentials from database
     */
    async loadFromDatabase() {
        try {
            const settings = await prisma.systemSetting.findMany({
                where: {
                    key: { in: [
                        'ithink_access_token',
                        'ithink_secret_key',
                        'ithink_pickup_address_id',
                        'ithink_return_address_id',
                        'ithink_default_logistics'
                    ] }
                }
            });

            for (const setting of settings) {
                if (setting.key === 'ithink_access_token') {
                    this.accessToken = setting.value;
                } else if (setting.key === 'ithink_secret_key') {
                    this.secretKey = setting.value;
                } else if (setting.key === 'ithink_pickup_address_id') {
                    this.pickupAddressId = setting.value;
                } else if (setting.key === 'ithink_return_address_id') {
                    this.returnAddressId = setting.value;
                } else if (setting.key === 'ithink_default_logistics') {
                    this.defaultLogistics = setting.value;
                }
            }
        } catch (error) {
            console.error('Error loading iThink Logistics config:', error.message);
        }
    }

    /**
     * Update credentials in database
     */
    async updateConfig(config) {
        const { accessToken, secretKey, pickupAddressId, returnAddressId, defaultLogistics } = config;

        const updates = [];

        if (accessToken !== undefined) {
            updates.push(prisma.systemSetting.upsert({
                where: { key: 'ithink_access_token' },
                update: { value: accessToken },
                create: { key: 'ithink_access_token', value: accessToken }
            }));
            this.accessToken = accessToken;
        }

        if (secretKey !== undefined) {
            updates.push(prisma.systemSetting.upsert({
                where: { key: 'ithink_secret_key' },
                update: { value: secretKey },
                create: { key: 'ithink_secret_key', value: secretKey }
            }));
            this.secretKey = secretKey;
        }

        if (pickupAddressId !== undefined) {
            updates.push(prisma.systemSetting.upsert({
                where: { key: 'ithink_pickup_address_id' },
                update: { value: pickupAddressId },
                create: { key: 'ithink_pickup_address_id', value: pickupAddressId }
            }));
            this.pickupAddressId = pickupAddressId;
        }

        if (returnAddressId !== undefined) {
            updates.push(prisma.systemSetting.upsert({
                where: { key: 'ithink_return_address_id' },
                update: { value: returnAddressId },
                create: { key: 'ithink_return_address_id', value: returnAddressId }
            }));
            this.returnAddressId = returnAddressId;
        }

        if (defaultLogistics !== undefined) {
            updates.push(prisma.systemSetting.upsert({
                where: { key: 'ithink_default_logistics' },
                update: { value: defaultLogistics },
                create: { key: 'ithink_default_logistics', value: defaultLogistics }
            }));
            this.defaultLogistics = defaultLogistics;
        }

        if (updates.length > 0) {
            await prisma.$transaction(updates);
        }
    }

    isConfigured() {
        return !!(this.accessToken && this.secretKey);
    }

    isFullyConfigured() {
        return !!(this.accessToken && this.secretKey && this.pickupAddressId && this.returnAddressId);
    }

    getConfig() {
        return {
            hasCredentials: this.isConfigured(),
            hasWarehouseConfig: !!(this.pickupAddressId && this.returnAddressId),
            pickupAddressId: this.pickupAddressId,
            returnAddressId: this.returnAddressId,
            defaultLogistics: this.defaultLogistics,
        };
    }

    /**
     * Track shipments by AWB numbers
     * @param {string|string[]} awbNumbers - Single AWB or array of AWBs (max 10)
     * @returns {Promise<Object>} Tracking data keyed by AWB number
     */
    async trackShipments(awbNumbers) {
        if (!this.isConfigured()) {
            throw new Error('iThink Logistics credentials not configured');
        }

        // Normalize to array and limit to 10
        const awbList = Array.isArray(awbNumbers) ? awbNumbers : [awbNumbers];
        if (awbList.length > 10) {
            throw new Error('Maximum 10 AWB numbers per request');
        }

        const response = await axios.post(`${this.trackingBaseUrl}/order/track.json`, {
            data: {
                access_token: this.accessToken,
                secret_key: this.secretKey,
                awb_number_list: awbList.join(',')
            }
        }, {
            headers: { 'Content-Type': 'application/json' },
            timeout: 30000
        });

        if (response.data.status_code !== 200) {
            throw new Error(`iThink API error: ${response.data.message || 'Unknown error'}`);
        }

        return response.data.data;
    }

    /**
     * Create a new order/shipment with iThink Logistics
     * This books the shipment and returns an AWB number
     *
     * @param {Object} orderData - Order details
     * @param {string} orderData.orderNumber - Unique order number
     * @param {Date} orderData.orderDate - Order date
     * @param {number} orderData.totalAmount - Total order amount
     * @param {Object} orderData.customer - Customer details
     * @param {string} orderData.customer.name - Customer name
     * @param {string} orderData.customer.phone - Customer phone
     * @param {string} orderData.customer.address - Address line 1
     * @param {string} orderData.customer.address2 - Address line 2 (optional)
     * @param {string} orderData.customer.city - City
     * @param {string} orderData.customer.state - State
     * @param {string} orderData.customer.pincode - Pincode
     * @param {string} orderData.customer.email - Email (optional)
     * @param {Array} orderData.products - Array of products
     * @param {Object} orderData.dimensions - Shipment dimensions
     * @param {number} orderData.dimensions.length - Length in cm
     * @param {number} orderData.dimensions.width - Width in cm
     * @param {number} orderData.dimensions.height - Height in cm
     * @param {number} orderData.dimensions.weight - Weight in kg
     * @param {string} orderData.paymentMode - 'COD' or 'Prepaid'
     * @param {number} orderData.codAmount - COD amount (if payment mode is COD)
     * @param {string} orderData.logistics - Logistics provider (optional, uses default)
     * @returns {Promise<Object>} Response with AWB number
     */
    async createOrder(orderData) {
        if (!this.isFullyConfigured()) {
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
            return_address_id: this.returnAddressId,
        };

        const requestData = {
            data: {
                shipments: [shipment],
                pickup_address_id: this.pickupAddressId,
                access_token: this.accessToken,
                secret_key: this.secretKey,
                logistics: logistics || this.defaultLogistics,
                s_type: '', // air/surface - optional
                order_type: 'forward', // forward/reverse
            }
        };

        console.log(`[iThink] Creating order ${orderNumber} with ${logistics || this.defaultLogistics}`);

        const response = await axios.post(`${this.orderBaseUrl}/order/add.json`, requestData, {
            headers: { 'Content-Type': 'application/json' },
            timeout: 30000
        });

        // Log full response for debugging
        console.log(`[iThink] Response:`, JSON.stringify(response.data, null, 2));

        // Handle top-level error response
        if (response.data.status === 'error' || response.data.status_code === 400 || response.data.status_code === 500) {
            const errorMsg = response.data.message || response.data.html_message || 'Order creation failed';
            console.error(`[iThink] Error response:`, JSON.stringify(response.data));
            throw new Error(`iThink API error: ${errorMsg}`);
        }

        // Success response - extract AWB from response
        // Response structure: { status: "success", status_code: 200, data: { "1": { waybill: "AWB123", status: "success", ... } } }
        // Note: data is an object with numeric string keys, not an array
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

        console.log(`[iThink] Order ${orderNumber} created successfully. AWB: ${result.waybill}`);

        return {
            success: true,
            awbNumber: result.waybill,
            orderId: result.order_id,
            logistics: logistics || this.defaultLogistics,
            rawResponse: response.data,
        };
    }

    /**
     * Get shipping label PDF for AWB number(s)
     * Returns URL to the PDF label file
     *
     * @param {string|string[]} awbNumbers - Single AWB or array of AWBs
     * @param {Object} options - Label options
     * @param {string} options.pageSize - 'A4' or 'A6' (default: A4)
     * @param {boolean} options.displayCodPrepaid - Show COD/Prepaid on label
     * @param {boolean} options.displayShipperMobile - Show shipper mobile on label
     * @param {boolean} options.displayShipperAddress - Show shipper address on label
     * @returns {Promise<Object>} URL to the PDF label
     */
    async getShippingLabel(awbNumbers, options = {}) {
        if (!this.isConfigured()) {
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

        const requestData = {
            data: {
                awb_numbers: awbList,
                page_size: pageSize,
                access_token: this.accessToken,
                secret_key: this.secretKey,
            }
        };

        // Add optional display settings (1 = yes, 0 = no, blank = default)
        if (displayCodPrepaid !== undefined) {
            requestData.data.display_cod_prepaid = displayCodPrepaid ? '1' : '0';
        }
        if (displayShipperMobile !== undefined) {
            requestData.data.display_shipper_mobile = displayShipperMobile ? '1' : '0';
        }
        if (displayShipperAddress !== undefined) {
            requestData.data.display_shipper_address = displayShipperAddress ? '1' : '0';
        }

        const response = await axios.post(`${this.orderBaseUrl}/shipping/label.json`, requestData, {
            headers: { 'Content-Type': 'application/json' },
            timeout: 30000
        });

        console.log(`[iThink] Shipping label response:`, JSON.stringify(response.data, null, 2));

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
     * Check pincode serviceability
     * Returns logistics providers that can service the pincode with their capabilities
     *
     * @param {string} pincode - Pincode to check
     * @returns {Promise<Object>} Serviceability info for each logistics provider
     */
    async checkPincode(pincode) {
        if (!this.isConfigured()) {
            throw new Error('iThink Logistics credentials not configured');
        }

        if (!pincode) {
            throw new Error('Pincode is required');
        }

        const response = await axios.post(`${this.orderBaseUrl}/pincode/check.json`, {
            data: {
                pincode: String(pincode),
                access_token: this.accessToken,
                secret_key: this.secretKey,
            }
        }, {
            headers: { 'Content-Type': 'application/json' },
            timeout: 30000
        });

        console.log(`[iThink] Pincode check response:`, JSON.stringify(response.data, null, 2));

        if (response.data.status !== 'success' || response.data.status_code !== 200) {
            const errorMsg = response.data.message || response.data.html_message || 'Pincode check failed';
            throw new Error(`iThink API error: ${errorMsg}`);
        }

        // Parse response - data is { "pincode": { "provider": { ... } } }
        // Also contains metadata fields like remark, state_name, city_name, etc.
        const pincodeData = response.data.data?.[pincode] || {};
        const providers = [];

        // Metadata fields to skip (not logistics providers)
        const metadataFields = ['remark', 'state_name', 'city_name', 'city_id', 'state_id'];

        for (const [providerName, details] of Object.entries(pincodeData)) {
            // Skip metadata fields
            if (metadataFields.includes(providerName) || typeof details !== 'object') {
                continue;
            }
            providers.push({
                logistics: providerName,
                supportsCod: details.cod === 'Y',
                supportsPrepaid: details.prepaid === 'Y',
                supportsPickup: details.pickup === 'Y',
                district: details.district || '',
                stateCode: details.state_code || '',
                sortCode: details.sort_code || '',
            });
        }

        // Extract metadata
        const metadata = {
            stateName: pincodeData.state_name || '',
            cityName: pincodeData.city_name || '',
            remark: pincodeData.remark || '',
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
     *
     * @param {Object} params - Rate query parameters
     * @param {string} params.fromPincode - Origin pincode
     * @param {string} params.toPincode - Destination pincode
     * @param {number} params.length - Length in cm
     * @param {number} params.width - Width in cm
     * @param {number} params.height - Height in cm
     * @param {number} params.weight - Weight in kg
     * @param {string} params.orderType - 'forward' or 'reverse' (default: forward)
     * @param {string} params.paymentMethod - 'cod' or 'prepaid' (default: prepaid)
     * @param {number} params.productMrp - Product MRP for COD orders
     * @returns {Promise<Object>} Available rates and delivery info
     */
    async getRates(params) {
        if (!this.isConfigured()) {
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

        const response = await axios.post(`${this.orderBaseUrl}/rate/check.json`, {
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
                access_token: this.accessToken,
                secret_key: this.secretKey,
            }
        }, {
            headers: { 'Content-Type': 'application/json' },
            timeout: 30000
        });

        console.log(`[iThink] Rate check response:`, JSON.stringify(response.data, null, 2));

        if (response.data.status !== 'success' || response.data.status_code !== 200) {
            const errorMsg = response.data.message || response.data.html_message || 'Rate check failed';
            throw new Error(`iThink API error: ${errorMsg}`);
        }

        // Parse rates - data is array of rate options
        const rates = [];
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

    /**
     * Cancel shipment(s) by AWB number(s)
     * @param {string|string[]} awbNumbers - Single AWB or array of AWBs (max 100)
     * @returns {Promise<Object>} Cancellation results
     */
    async cancelShipment(awbNumbers) {
        if (!this.isConfigured()) {
            throw new Error('iThink Logistics credentials not configured');
        }

        // Normalize to array
        const awbList = Array.isArray(awbNumbers) ? awbNumbers : [awbNumbers];
        if (awbList.length > 100) {
            throw new Error('Maximum 100 AWB numbers per cancellation request');
        }

        console.log(`[iThink] Cancelling ${awbList.length} shipment(s): ${awbList.join(', ')}`);

        const response = await axios.post(`${this.orderBaseUrl}/order/cancel.json`, {
            data: {
                access_token: this.accessToken,
                secret_key: this.secretKey,
                awb_numbers: awbList.join(',')
            }
        }, {
            headers: { 'Content-Type': 'application/json' },
            timeout: 30000
        });

        console.log(`[iThink] Cancel response:`, JSON.stringify(response.data, null, 2));

        // Handle error response
        if (response.data.status === 'error' || response.data.status_code === 400) {
            const errorMsg = response.data.html_message || response.data.message || 'Cancellation failed';
            throw new Error(`iThink API error: ${errorMsg}`);
        }

        // Process results - data is object with numeric keys
        const results = {};
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

    /**
     * Get simplified tracking status for an AWB
     * @param {string} awbNumber
     * @returns {Promise<Object>} Simplified tracking info
     */
    async getTrackingStatus(awbNumber) {
        const data = await this.trackShipments(awbNumber);
        const tracking = data[awbNumber];

        if (!tracking || tracking.message !== 'success') {
            return null;
        }

        return {
            awbNumber: tracking.awb_no,
            courier: tracking.logistic,
            currentStatus: tracking.current_status,
            statusCode: tracking.current_status_code,
            expectedDeliveryDate: tracking.expected_delivery_date,
            promiseDeliveryDate: tracking.promise_delivery_date,
            ofdCount: parseInt(tracking.ofd_count) || 0,
            isRto: tracking.return_tracking_no ? true : false,
            rtoAwb: tracking.return_tracking_no || null,
            orderType: tracking.order_type || null,
            cancelStatus: tracking.cancel_status || null,
            // Last scan details - different field names than scan_details!
            lastScan: tracking.last_scan_details ? {
                status: tracking.last_scan_details.status,
                statusCode: tracking.last_scan_details.status_code,
                location: tracking.last_scan_details.scan_location,      // last_scan uses scan_location
                datetime: tracking.last_scan_details.status_date_time,   // Correct
                remark: tracking.last_scan_details.remark,               // last_scan uses remark
                reason: tracking.last_scan_details.reason,               // last_scan uses reason
            } : null,
            // Order details with additional fields
            orderDetails: tracking.order_details ? {
                orderNumber: tracking.order_details.order_number,
                subOrderNumber: tracking.order_details.sub_order_number,
                orderType: tracking.order_details.order_type,
                weight: tracking.order_details.phy_weight,
                length: tracking.order_details.ship_length,
                breadth: tracking.order_details.ship_width,
                height: tracking.order_details.ship_height,
                netPayment: tracking.order_details.net_payment,
            } : null,
            // Customer details with phone and address
            customerDetails: tracking.customer_details ? {
                name: tracking.customer_details.customer_name,
                phone: tracking.customer_details.customer_mobile || tracking.customer_details.customer_phone,
                address1: tracking.customer_details.customer_address1,
                address2: tracking.customer_details.customer_address2,
                city: tracking.customer_details.customer_city,
                state: tracking.customer_details.customer_state,
                country: tracking.customer_details.customer_country,
                pincode: tracking.customer_details.customer_pincode,
            } : null,
            // Scan history - use correct field names from iThink API
            scanHistory: (tracking.scan_details || []).map(scan => ({
                status: scan.status,
                statusCode: scan.status_code,
                location: scan.status_location,      // Fixed: was 'scan_location'
                datetime: scan.status_date_time,     // Correct
                remark: scan.status_remark,          // Fixed: was 'remark'
                reason: scan.status_reason,          // Correct
            })),
        };
    }

    /**
     * Map iThink status to our internal tracking status
     * Uses both statusCode and statusText because iThink API can be inconsistent
     * (e.g., returning UD code but "In Transit" text)
     *
     * Status codes documentation:
     * - M: Manifested (order created)
     * - NP: Not Picked (pickup failed)
     * - PP: Picked Up
     * - IT: In Transit
     * - OT: Out for Transit (alternative in-transit code)
     * - RAD: Reached At Destination
     * - OFD: Out For Delivery
     * - UD: Undelivered (delivery attempt failed)
     * - NDR: Non-Delivery Report (same as UD)
     * - DL: Delivered
     * - CA: Cancelled
     * - RTO: Return to Origin (initiated)
     * - RTP: RTO Pending/Processing
     * - RTI: RTO In Transit
     * - RTD: RTO Delivered (returned to seller)
     * - RTOUD: RTO Undelivered
     * - RTOOFD: RTO Out for Delivery
     */
    mapToInternalStatus(statusCode, statusText = '') {
        const textLower = (statusText || '').toLowerCase();
        const codeUpper = (statusCode || '').toUpperCase();

        // First, check the status TEXT which is more reliable
        // IMPORTANT: Check RTO states BEFORE regular delivered check!
        // "RTO Delivered" should map to rto_delivered, not delivered

        // RTO status detection - comprehensive check
        const isRtoText = textLower.includes('rto') ||
                          textLower.includes('return to origin') ||
                          textLower.includes('returned to origin') ||
                          textLower.includes('return to shipper') ||
                          textLower.includes('rtod') ||
                          textLower.includes('rts');  // Return to Shipper

        const isRtoCode = ['RTO', 'RTP', 'RTI', 'RTD', 'RTOUD', 'RTOOFD', 'RTS'].includes(codeUpper);

        if (isRtoText || isRtoCode) {
            // RTO Delivered states
            if (textLower.includes('delivered') || textLower.includes('received') ||
                textLower.includes('rtod') || codeUpper === 'RTD') {
                return 'rto_delivered';
            }
            // RTO Out for Delivery
            if (textLower.includes('out for delivery') || textLower.includes('ofd') ||
                codeUpper === 'RTOOFD') {
                return 'rto_in_transit';  // Still in transit until delivered
            }
            // RTO Undelivered
            if (textLower.includes('undelivered') || codeUpper === 'RTOUD') {
                return 'rto_in_transit';  // RTO still in progress
            }
            // All other RTO states map to rto_in_transit
            return 'rto_in_transit';
        }

        // Delivered states (only regular delivery, not RTO)
        if ((textLower.includes('delivered') || codeUpper === 'DL') &&
            !textLower.includes('undelivered') &&
            !textLower.includes('not delivered')) {
            return 'delivered';
        }

        // Undelivered/NDR - delivery attempt failed
        if (textLower.includes('undelivered') ||
            textLower.includes('not delivered') ||
            textLower.includes('delivery failed') ||
            textLower.includes('ndr') ||
            codeUpper === 'UD' ||
            codeUpper === 'NDR') {
            return 'undelivered';
        }

        // Out for delivery
        if (textLower.includes('out for delivery') ||
            textLower.includes('ofd') ||
            codeUpper === 'OFD') {
            return 'out_for_delivery';
        }

        // In transit variations
        if (textLower.includes('transit') ||
            textLower.includes('in-transit') ||
            codeUpper === 'IT' ||
            codeUpper === 'OT') {
            return 'in_transit';
        }

        // Picked up
        if (textLower.includes('picked') ||
            textLower.includes('pickup') ||
            codeUpper === 'PP') {
            return 'picked_up';
        }

        // At destination hub
        if (textLower.includes('reached') ||
            textLower.includes('destination') ||
            textLower.includes('hub') ||
            codeUpper === 'RAD') {
            return 'reached_destination';
        }

        // Manifested
        if (textLower.includes('manifest') || codeUpper === 'M') {
            return 'manifested';
        }

        // Not picked
        if (textLower.includes('not picked') ||
            textLower.includes('pickup failed') ||
            codeUpper === 'NP') {
            return 'not_picked';
        }

        // Cancelled
        if (textLower.includes('cancel') || codeUpper === 'CA') {
            return 'cancelled';
        }

        // Reverse logistics (customer returning item, not RTO)
        if (codeUpper === 'REVP') return 'reverse_pickup';
        if (codeUpper === 'REVI') return 'reverse_in_transit';
        if (codeUpper === 'REVD') return 'reverse_delivered';

        // Fall back to status code map for any remaining codes
        const statusMap = {
            'M': 'manifested',
            'NP': 'not_picked',
            'PP': 'picked_up',
            'IT': 'in_transit',
            'OT': 'in_transit',
            'RAD': 'reached_destination',
            'OFD': 'out_for_delivery',
            'UD': 'undelivered',
            'NDR': 'undelivered',
            'DL': 'delivered',
            'CA': 'cancelled',
        };

        return statusMap[codeUpper] || 'in_transit';
    }
}

// Singleton instance
const ithinkLogistics = new IThinkLogisticsClient();

export default ithinkLogistics;
