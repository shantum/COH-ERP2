/**
 * Stub for all Server Functions in SPA mode
 *
 * In SPA mode, Server Functions are not available. This stub exports
 * no-op functions that return null for all server function imports.
 */

// Generic no-op async function
const noopAsync = async () => null;

// Export common function names that might be imported
// These are placeholders - the actual Server Functions won't run
export const getOrders = noopAsync;
export const getOrderById = noopAsync;
export const getCustomers = noopAsync;
export const getCustomerById = noopAsync;
export const getProducts = noopAsync;
export const getProductsTree = noopAsync;
export const getMaterials = noopAsync;
export const getMaterialsTree = noopAsync;
export const getInventory = noopAsync;
export const getProduction = noopAsync;
export const getReturns = noopAsync;
export const getFabrics = noopAsync;
export const getCatalog = noopAsync;

// Mutations also return null
export const createOrder = noopAsync;
export const updateOrder = noopAsync;
export const deleteOrder = noopAsync;
export const allocateOrder = noopAsync;

// Auth
export const login = noopAsync;
export const logout = noopAsync;
export const getCurrentUser = noopAsync;
export const checkAuth = noopAsync;

// Default export for module resolution
export default {};
