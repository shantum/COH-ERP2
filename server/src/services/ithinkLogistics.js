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
