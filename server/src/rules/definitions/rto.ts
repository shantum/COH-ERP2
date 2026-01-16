/**
 * RTO (Return to Origin) Rules
 * Rules for initiating and receiving RTO packages
 */

import { defineRule, simpleBooleanRule } from '../core/defineRule.js';

// ============================================
// TYPE DEFINITIONS
// ============================================

interface InitiateRtoData {
    order: {
        id: string;
        status: string;
        rtoInitiatedAt?: Date | null;
    };
}

interface ReceiveRtoData {
    order: {
        id: string;
        status: string;
        rtoInitiatedAt?: Date | null;
        rtoReceivedAt?: Date | null;
    };
}

// ============================================
// INITIATE RTO RULES
// ============================================

/**
 * Order must be shipped to initiate RTO
 */
export const orderMustBeShippedForRto = defineRule<InitiateRtoData>({
    id: 'rto.initiate.order_shipped',
    name: 'Order Must Be Shipped',
    description: 'Order must be shipped to initiate RTO',
    category: 'rto',
    errorCode: 'ORDER_NOT_SHIPPED',
    operations: ['initiateRto'],
    evaluate: async ({ data }) => {
        if (data.order.status === 'shipped') {
            return true;
        }
        return {
            passed: false,
            message: `Order must be shipped to initiate RTO (current: ${data.order.status})`,
        };
    },
});

/**
 * RTO not already initiated (warning - allows re-initiation but notifies)
 */
export const rtoNotAlreadyInitiated = defineRule<InitiateRtoData>({
    id: 'rto.initiate.not_already_initiated',
    name: 'RTO Not Already Initiated',
    description: 'RTO has already been initiated for this order',
    category: 'rto',
    severity: 'warning',
    errorCode: 'RTO_ALREADY_INITIATED',
    operations: ['initiateRto'],
    evaluate: async ({ data }) => {
        if (!data.order.rtoInitiatedAt) {
            return true;
        }
        return {
            passed: false,
            message: 'RTO has already been initiated for this order',
        };
    },
});

// ============================================
// RECEIVE RTO RULES
// ============================================

/**
 * RTO must be initiated before receiving
 */
export const rtoMustBeInitiated = simpleBooleanRule<ReceiveRtoData>({
    id: 'rto.receive.must_be_initiated',
    name: 'RTO Must Be Initiated',
    description: 'RTO must be initiated first',
    category: 'rto',
    errorCode: 'RTO_NOT_INITIATED',
    operations: ['receiveRto'],
    condition: ({ data }) => Boolean(data.order.rtoInitiatedAt),
});

/**
 * RTO not already received
 */
export const rtoNotAlreadyReceived = simpleBooleanRule<ReceiveRtoData>({
    id: 'rto.receive.not_already_received',
    name: 'RTO Not Already Received',
    description: 'RTO already received',
    category: 'rto',
    errorCode: 'RTO_ALREADY_RECEIVED',
    operations: ['receiveRto'],
    condition: ({ data }) => !data.order.rtoReceivedAt,
});

// ============================================
// EXPORTS
// ============================================

/**
 * All RTO rules
 */
export const rtoRules = [
    orderMustBeShippedForRto,
    rtoNotAlreadyInitiated,
    rtoMustBeInitiated,
    rtoNotAlreadyReceived,
];
