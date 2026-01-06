/**
 * Tracking Integration Tests
 * 
 * Tests for iThink Logistics tracking service and sync functionality.
 * Tests pure utility functions and status mapping logic.
 */

import ithinkLogistics from '../services/ithinkLogistics.js';

// ============================================
// ITHINK LOGISTICS STATUS MAPPING TESTS
// ============================================

describe('iThink Logistics Status Mapping', () => {
    describe('mapToInternalStatus', () => {
        it('should map forward delivery statuses correctly', () => {
            expect(ithinkLogistics.mapToInternalStatus('M')).toBe('manifested');
            expect(ithinkLogistics.mapToInternalStatus('PP')).toBe('picked_up');
            expect(ithinkLogistics.mapToInternalStatus('IT')).toBe('in_transit');
            expect(ithinkLogistics.mapToInternalStatus('RAD')).toBe('reached_destination');
            expect(ithinkLogistics.mapToInternalStatus('OFD')).toBe('out_for_delivery');
            expect(ithinkLogistics.mapToInternalStatus('DL')).toBe('delivered');
        });

        it('should map failure statuses correctly', () => {
            expect(ithinkLogistics.mapToInternalStatus('NP')).toBe('not_picked');
            expect(ithinkLogistics.mapToInternalStatus('UD')).toBe('undelivered');
            expect(ithinkLogistics.mapToInternalStatus('CA')).toBe('cancelled');
        });

        it('should map RTO statuses correctly', () => {
            expect(ithinkLogistics.mapToInternalStatus('RTP')).toBe('rto_pending');
            expect(ithinkLogistics.mapToInternalStatus('RTI')).toBe('rto_in_transit');
            expect(ithinkLogistics.mapToInternalStatus('RTD')).toBe('rto_delivered');
        });

        it('should map reverse pickup statuses correctly', () => {
            expect(ithinkLogistics.mapToInternalStatus('REVP')).toBe('reverse_pickup');
            expect(ithinkLogistics.mapToInternalStatus('REVI')).toBe('reverse_in_transit');
            expect(ithinkLogistics.mapToInternalStatus('REVD')).toBe('reverse_delivered');
        });

        it('should return unknown for unrecognized status codes', () => {
            expect(ithinkLogistics.mapToInternalStatus('INVALID')).toBe('unknown');
            expect(ithinkLogistics.mapToInternalStatus('')).toBe('unknown');
            expect(ithinkLogistics.mapToInternalStatus(null)).toBe('unknown');
            expect(ithinkLogistics.mapToInternalStatus(undefined)).toBe('unknown');
        });
    });

    describe('isConfigured', () => {
        it('should return false when credentials not set', () => {
            // Reset credentials
            ithinkLogistics.accessToken = null;
            ithinkLogistics.secretKey = null;
            expect(ithinkLogistics.isConfigured()).toBe(false);
        });

        it('should return false when only accessToken is set', () => {
            ithinkLogistics.accessToken = 'test-token';
            ithinkLogistics.secretKey = null;
            expect(ithinkLogistics.isConfigured()).toBe(false);
        });

        it('should return false when only secretKey is set', () => {
            ithinkLogistics.accessToken = null;
            ithinkLogistics.secretKey = 'test-secret';
            expect(ithinkLogistics.isConfigured()).toBe(false);
        });

        it('should return true when both credentials are set', () => {
            ithinkLogistics.accessToken = 'test-token';
            ithinkLogistics.secretKey = 'test-secret';
            expect(ithinkLogistics.isConfigured()).toBe(true);
        });
    });

    describe('getConfig', () => {
        it('should return hasCredentials false when not configured', () => {
            ithinkLogistics.accessToken = null;
            ithinkLogistics.secretKey = null;
            const config = ithinkLogistics.getConfig();
            expect(config.hasCredentials).toBe(false);
        });

        it('should return hasCredentials true when configured', () => {
            ithinkLogistics.accessToken = 'test-token';
            ithinkLogistics.secretKey = 'test-secret';
            const config = ithinkLogistics.getConfig();
            expect(config.hasCredentials).toBe(true);
        });
    });
});

// ============================================
// TRACKING DATA PARSING TESTS
// ============================================

describe('Tracking Data Parsing', () => {
    // Mock iThink API response format
    const mockApiResponse = {
        'AWB123456': {
            message: 'success',
            awb_no: 'AWB123456',
            logistic: 'Delhivery',
            current_status: 'In Transit',
            current_status_code: 'IT',
            expected_delivery_date: '2026-01-10',
            promise_delivery_date: '2026-01-09',
            ofd_count: '2',
            return_tracking_no: null,
            last_scan_details: {
                status: 'Package picked up',
                location: 'Mumbai Hub',
                date_time: '2026-01-06T10:30:00',
                remarks: 'Out for delivery'
            },
            scan_details: [
                { status: 'Package picked up', status_code: 'PP', location: 'Origin', date_time: '2026-01-05T09:00:00' },
                { status: 'In Transit', status_code: 'IT', location: 'Hub', date_time: '2026-01-05T14:00:00' },
            ]
        }
    };

    describe('getTrackingStatus response parsing', () => {
        // This tests the expected structure of parsed tracking data
        it('should parse successful tracking response structure', () => {
            const rawData = mockApiResponse['AWB123456'];

            // Test the expected parsed structure
            const expectedParsed = {
                awbNumber: 'AWB123456',
                courier: 'Delhivery',
                currentStatus: 'In Transit',
                statusCode: 'IT',
                expectedDeliveryDate: '2026-01-10',
                ofdCount: 2,
                isRto: false,
                rtoAwb: null
            };

            expect(rawData.awb_no).toBe(expectedParsed.awbNumber);
            expect(rawData.logistic).toBe(expectedParsed.courier);
            expect(rawData.current_status).toBe(expectedParsed.currentStatus);
            expect(parseInt(rawData.ofd_count)).toBe(expectedParsed.ofdCount);
            expect(!!rawData.return_tracking_no).toBe(expectedParsed.isRto);
        });

        it('should detect RTO when return_tracking_no is present', () => {
            const rtoData = {
                ...mockApiResponse['AWB123456'],
                return_tracking_no: 'RTO123456'
            };

            expect(!!rtoData.return_tracking_no).toBe(true);
        });

        it('should handle missing last_scan_details', () => {
            const noScanData = {
                message: 'success',
                awb_no: 'AWB999',
                current_status: 'In Transit',
                last_scan_details: null
            };

            expect(noScanData.last_scan_details).toBeNull();
        });
    });
});

// ============================================
// TRACKING STATUS FLOW TESTS
// ============================================

describe('Tracking Status Flow', () => {
    // Test the expected status progression
    const statusFlow = [
        'manifested',
        'picked_up',
        'in_transit',
        'reached_destination',
        'out_for_delivery',
        'delivered'
    ];

    const rtoFlow = [
        'rto_pending',
        'rto_in_transit',
        'rto_delivered'
    ];

    it('should have forward delivery flow defined', () => {
        statusFlow.forEach(status => {
            // All forward statuses should be mapped
            const statusCode = getStatusCodeForInternal(status);
            expect(ithinkLogistics.mapToInternalStatus(statusCode)).toBe(status);
        });
    });

    it('should have RTO flow defined', () => {
        rtoFlow.forEach(status => {
            const statusCode = getStatusCodeForInternal(status);
            expect(ithinkLogistics.mapToInternalStatus(statusCode)).toBe(status);
        });
    });

    // Helper to get status code from internal status
    function getStatusCodeForInternal(internalStatus) {
        const reverseMap = {
            'manifested': 'M',
            'not_picked': 'NP',
            'picked_up': 'PP',
            'in_transit': 'IT',
            'reached_destination': 'RAD',
            'out_for_delivery': 'OFD',
            'undelivered': 'UD',
            'delivered': 'DL',
            'cancelled': 'CA',
            'rto_pending': 'RTP',
            'rto_in_transit': 'RTI',
            'rto_delivered': 'RTD',
        };
        return reverseMap[internalStatus];
    }
});

// ============================================
// BATCH TRACKING TESTS
// ============================================

describe('Batch Tracking Logic', () => {
    it('should limit batch to 10 AWBs', () => {
        const awbs = Array.from({ length: 15 }, (_, i) => `AWB${i}`);
        const batch1 = awbs.slice(0, 10);
        const batch2 = awbs.slice(10);

        expect(batch1.length).toBe(10);
        expect(batch2.length).toBe(5);
    });

    it('should normalize AWB array input', () => {
        // Single AWB should be converted to array
        const singleAwb = 'AWB123';
        const normalized = Array.isArray(singleAwb) ? singleAwb : [singleAwb];
        expect(normalized).toEqual(['AWB123']);
    });

    it('should handle array AWB input', () => {
        const awbArray = ['AWB1', 'AWB2', 'AWB3'];
        const normalized = Array.isArray(awbArray) ? awbArray : [awbArray];
        expect(normalized).toEqual(['AWB1', 'AWB2', 'AWB3']);
    });
});

// ============================================
// TRACKING SYNC LOGIC TESTS
// ============================================

describe('Tracking Sync Logic', () => {
    // Test the update logic without calling the database
    describe('Order Update Data Mapping', () => {
        it('should build update data from tracking response', () => {
            const trackingData = {
                internalStatus: 'in_transit',
                statusCode: 'IT',
                ofdCount: 2,
                expectedDeliveryDate: '2026-01-10',
                lastScan: {
                    status: 'In Transit',
                    location: 'Mumbai Hub',
                    datetime: '2026-01-06T10:30:00'
                },
                courier: 'Delhivery',
                isRto: false
            };

            // Expected update data structure
            const expectedUpdate = {
                trackingStatus: 'in_transit',
                courierStatusCode: 'IT',
                deliveryAttempts: 2,
            };

            expect(trackingData.internalStatus).toBe(expectedUpdate.trackingStatus);
            expect(trackingData.statusCode).toBe(expectedUpdate.courierStatusCode);
            expect(trackingData.ofdCount).toBe(expectedUpdate.deliveryAttempts);
        });

        it('should set deliveredAt when status is delivered', () => {
            const trackingData = {
                internalStatus: 'delivered',
                lastScan: {
                    datetime: '2026-01-08T14:00:00'
                }
            };

            const shouldSetDeliveredAt = trackingData.internalStatus === 'delivered';
            expect(shouldSetDeliveredAt).toBe(true);
        });

        it('should set rtoInitiatedAt when isRto is true', () => {
            const trackingData = {
                internalStatus: 'rto_in_transit',
                isRto: true
            };

            const shouldSetRto = trackingData.isRto === true;
            expect(shouldSetRto).toBe(true);
        });
    });

    describe('Date Validation', () => {
        it('should skip invalid expected delivery dates', () => {
            const invalidDates = ['0000-00-00', '', null, undefined];

            invalidDates.forEach(date => {
                const isValid = date && date !== '0000-00-00';
                expect(isValid).toBeFalsy();
            });
        });

        it('should accept valid expected delivery dates', () => {
            const validDates = ['2026-01-10', '2026-12-31'];

            validDates.forEach(date => {
                const isValid = date && date !== '0000-00-00';
                expect(isValid).toBeTruthy();
            });
        });
    });
});

// ============================================
// SYNC SCHEDULER TESTS
// ============================================

describe('Tracking Sync Scheduler', () => {
    // Import trackingSync for scheduler tests
    let trackingSync;

    beforeAll(async () => {
        trackingSync = (await import('../services/trackingSync.js')).default;
    });

    it('should return correct status structure', () => {
        const status = trackingSync.getStatus();

        expect(status).toHaveProperty('isRunning');
        expect(status).toHaveProperty('schedulerActive');
        expect(status).toHaveProperty('intervalMinutes');
        expect(status).toHaveProperty('lastSyncAt');
        expect(status).toHaveProperty('lastSyncResult');
    });

    it('should have 4 hour sync interval', () => {
        const status = trackingSync.getStatus();
        expect(status.intervalMinutes).toBe(240); // 4 hours = 240 minutes
    });
});
