/**
 * iThink Logistics — Client class (facade delegating to module functions)
 */

import type { IThinkRawTrackingResponse } from '../../types/ithinkApi.js';
import type { IThinkRemittanceSummary, IThinkRemittanceDetail } from '../../types/ithinkApi.js';
import * as configModule from './config.js';
import * as trackingModule from './tracking.js';
import * as shipmentsModule from './shipments.js';
import * as ratesModule from './rates.js';
import * as returnsModule from './returns.js';
import * as remittanceModule from './remittance.js';
import type {
    ClientContext,
    IThinkConfig,
    ConfigStatus,
    ShipmentRequest,
    CreateOrderResult,
    LabelOptions,
    ShippingLabelResult,
    CancelShipmentResult,
    RateCheckParams,
    RateCheckResult,
    PincodeCheckResult,
    ReversePickupRequest,
    ReversePickupResult,
    ReversePickupServiceability,
    TrackingData,
    TrackingStatus,
} from './types.js';

class IThinkLogisticsClient {
    private ctx: ClientContext;

    constructor() {
        this.ctx = {
            trackingBaseUrl: 'https://api.ithinklogistics.com/api_v3',
            orderBaseUrl: 'https://my.ithinklogistics.com/api_v3',
            accessToken: process.env.ITHINK_ACCESS_TOKEN || null,
            secretKey: process.env.ITHINK_SECRET_KEY || null,
            pickupAddressId: process.env.ITHINK_PICKUP_ADDRESS_ID || null,
            returnAddressId: process.env.ITHINK_RETURN_ADDRESS_ID || null,
            defaultLogistics: process.env.ITHINK_DEFAULT_LOGISTICS || 'delhivery',
        };
    }

    // Config
    async loadFromDatabase(): Promise<void> {
        return configModule.loadFromDatabase(this.ctx);
    }
    async updateConfig(config: IThinkConfig): Promise<void> {
        return configModule.updateConfig(this.ctx, config);
    }
    isConfigured(): boolean {
        return configModule.isConfigured(this.ctx);
    }
    isFullyConfigured(): boolean {
        return configModule.isFullyConfigured(this.ctx);
    }
    getConfig(): ConfigStatus {
        return configModule.getConfig(this.ctx);
    }

    // Tracking
    async trackShipments(
        awbNumbers: string | string[],
        storeResponse: boolean = false
    ): Promise<Record<string, IThinkRawTrackingResponse>> {
        return trackingModule.trackShipments(this.ctx, awbNumbers, storeResponse);
    }
    async getTrackingStatus(awbNumber: string): Promise<TrackingData | null> {
        return trackingModule.getTrackingStatus(this.ctx, awbNumber);
    }
    mapToInternalStatus(statusCode: string, statusText: string = ''): TrackingStatus {
        return trackingModule.mapToInternalStatus(statusCode, statusText);
    }

    // Shipments
    async createOrder(orderData: ShipmentRequest): Promise<CreateOrderResult> {
        return shipmentsModule.createOrder(this.ctx, orderData);
    }
    async getShippingLabel(awbNumbers: string | string[], options: LabelOptions = {}): Promise<ShippingLabelResult> {
        return shipmentsModule.getShippingLabel(this.ctx, awbNumbers, options);
    }
    async cancelShipment(awbNumbers: string | string[]): Promise<CancelShipmentResult> {
        return shipmentsModule.cancelShipment(this.ctx, awbNumbers);
    }

    // Rates
    async checkPincode(pincode: string): Promise<PincodeCheckResult> {
        return ratesModule.checkPincode(this.ctx, pincode);
    }
    async getRates(params: RateCheckParams): Promise<RateCheckResult> {
        return ratesModule.getRates(this.ctx, params);
    }

    // Returns
    async checkReversePickupServiceability(pincode: string): Promise<ReversePickupServiceability> {
        return returnsModule.checkReversePickupServiceability(this.ctx, pincode);
    }
    async createReversePickup(request: ReversePickupRequest): Promise<ReversePickupResult> {
        return returnsModule.createReversePickup(this.ctx, request);
    }

    // Remittance
    async getRemittances(remittanceDate: string): Promise<IThinkRemittanceSummary[]> {
        return remittanceModule.getRemittances(this.ctx, remittanceDate);
    }
    async getRemittanceDetails(remittanceDate: string): Promise<IThinkRemittanceDetail[]> {
        return remittanceModule.getRemittanceDetails(this.ctx, remittanceDate);
    }
}

export { IThinkLogisticsClient };
