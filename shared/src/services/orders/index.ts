/**
 * Orders Services
 *
 * Barrel export for order-related services.
 * These can be used by both Server Functions and Express routes.
 */

export {
    shipOrderLines,
    shipOrder,
    validateShipment,
    BusinessLogicError,
    type LineResult,
    type ShipResult,
    type ShipOptions,
    type ShipOrderOptions,
    type ValidationIssue,
    type ValidationResult,
    type ValidationOptions,
} from './shipService.js';
