/**
 * iThink Logistics API Integration
 * Provides real-time shipment tracking from logistics provider
 */

import axios from 'axios';
import prisma from '../lib/prisma.js';

class IThinkLogisticsClient {
    constructor() {
        this.baseUrl = 'https://api.ithinklogistics.com/api_v3';
        this.accessToken = null;
        this.secretKey = null;
    }

    /**
     * Load credentials from database
     */
    async loadFromDatabase() {
        try {
            const settings = await prisma.systemSetting.findMany({
                where: {
                    key: { in: ['ithink_access_token', 'ithink_secret_key'] }
                }
            });

            for (const setting of settings) {
                if (setting.key === 'ithink_access_token') {
                    this.accessToken = setting.value;
                } else if (setting.key === 'ithink_secret_key') {
                    this.secretKey = setting.value;
                }
            }
        } catch (error) {
            console.error('Error loading iThink Logistics config:', error.message);
        }
    }

    /**
     * Update credentials in database
     */
    async updateConfig(accessToken, secretKey) {
        await prisma.$transaction([
            prisma.systemSetting.upsert({
                where: { key: 'ithink_access_token' },
                update: { value: accessToken },
                create: { key: 'ithink_access_token', value: accessToken }
            }),
            prisma.systemSetting.upsert({
                where: { key: 'ithink_secret_key' },
                update: { value: secretKey },
                create: { key: 'ithink_secret_key', value: secretKey }
            })
        ]);

        this.accessToken = accessToken;
        this.secretKey = secretKey;
    }

    isConfigured() {
        return !!(this.accessToken && this.secretKey);
    }

    getConfig() {
        return {
            hasCredentials: this.isConfigured(),
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

        const response = await axios.post(`${this.baseUrl}/order/track.json`, {
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
     */
    mapToInternalStatus(statusCode, statusText = '') {
        const textLower = (statusText || '').toLowerCase();

        // First, check the status TEXT which is more reliable
        // IMPORTANT: Check RTO states BEFORE regular delivered check!
        // "RTO Delivered" should map to rto_delivered, not delivered
        if (textLower.includes('rto') || textLower.includes('return to origin') || textLower.includes('returned to origin')) {
            if (textLower.includes('delivered')) return 'rto_delivered';
            return 'rto_in_transit'; // All non-delivered RTO states map to rto_in_transit
        }

        // Delivered states (only regular delivery, not RTO)
        if (textLower.includes('delivered') && !textLower.includes('undelivered') && !textLower.includes('not delivered')) {
            return 'delivered';
        }

        // Undelivered/NDR - only if text explicitly says undelivered
        if (textLower.includes('undelivered') || textLower.includes('not delivered') || textLower.includes('delivery failed')) {
            return 'undelivered';
        }

        // Out for delivery
        if (textLower.includes('out for delivery') || textLower.includes('ofd')) {
            return 'out_for_delivery';
        }

        // In transit variations
        if (textLower.includes('transit') || textLower.includes('in-transit')) {
            return 'in_transit';
        }

        // Picked up
        if (textLower.includes('picked') || textLower.includes('pickup')) {
            return 'picked_up';
        }

        // At destination hub
        if (textLower.includes('reached') || textLower.includes('destination') || textLower.includes('hub')) {
            return 'reached_destination';
        }

        // Manifested
        if (textLower.includes('manifest')) {
            return 'manifested';
        }

        // Cancelled
        if (textLower.includes('cancel')) {
            return 'cancelled';
        }

        // Fall back to status code only if text didn't match anything
        const statusMap = {
            'M': 'manifested',
            'NP': 'not_picked',
            'PP': 'picked_up',
            'IT': 'in_transit',
            'RAD': 'reached_destination',
            'OFD': 'out_for_delivery',
            'UD': 'undelivered',
            'DL': 'delivered',
            'CA': 'cancelled',
            'RTP': 'rto_in_transit',
            'RTI': 'rto_in_transit',
            'RTD': 'rto_delivered',
            'REVP': 'reverse_pickup',
            'REVI': 'reverse_in_transit',
            'REVD': 'reverse_delivered',
        };
        return statusMap[statusCode] || 'in_transit';
    }
}

// Singleton instance
const ithinkLogistics = new IThinkLogisticsClient();

export default ithinkLogistics;
