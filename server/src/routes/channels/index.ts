/**
 * Channel Import Routes - Handles BT CSV report uploads for marketplace channels
 *
 * Features:
 * - CSV import for Myntra, Ajio, Nykaa order data from BT reports
 * - Additive import: uploading Jan + Feb data combines them
 * - Deduplication on channel + channelOrderId + channelItemId
 * - Import batch tracking for audit trail
 * - Channel Order Import: creates real ERP Orders from BT CSV data
 *
 * Key Patterns:
 * - Multer memory storage for file uploads (10MB limit for large reports)
 * - Row-by-row upsert with error collection
 * - Price stored in paise for precision (analytics), rupees for ERP Orders
 */

export { default } from './routes.js';
