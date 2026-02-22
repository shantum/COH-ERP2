/**
 * Business Graph Services
 *
 * Read-only layer that connects entities across domains.
 * Entity context resolvers + business pulse snapshot.
 */

// Types
export type {
  OrderContext,
  OrderContextLine,
  OrderContextPayment,
  OrderContextCustomer,
  ProductContext,
  ProductContextVariation,
  ProductContextSku,
  ProductContextSalesVelocity,
  CustomerContext,
  CustomerContextOrderSummary,
  BusinessPulse,
  PulseRevenue,
  PulseOrderPipeline,
  PulseInventory,
  PulseProduction,
  PulseCash,
  PulsePayables,
  PulseReceivables,
  PulseFulfillment,
  PulseMaterialHealth,
  PulseTopProduct,
} from './types.js';

// Entity context resolvers
export {
  getOrderContext,
  getProductContext,
  getCustomerContext,
} from './entityContext.js';

// Business pulse
export {
  getBusinessPulse,
} from './businessPulse.js';
