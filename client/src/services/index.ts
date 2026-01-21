/**
 * Services Index
 *
 * Exports Axios APIs for operations that CANNOT use Server Functions:
 * - File uploads (multipart/form-data)
 * - Auth (cookie management)
 * - Shopify admin sync operations
 *
 * For all other data operations, use Server Functions:
 * @see client/src/server/functions/
 */

export * from './api';
