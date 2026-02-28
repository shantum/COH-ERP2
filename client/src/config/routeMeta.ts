/**
 * Route Metadata Configuration
 *
 * Centralized configuration for route titles and breadcrumbs.
 * Used by useDocumentTitle hook and Breadcrumbs component.
 */

export interface RouteMeta {
  title: string;
  breadcrumb: string;
}

/**
 * Route metadata mapping
 * Key: route path, Value: title and breadcrumb text
 */
export const routeMeta: Record<string, RouteMeta> = {
  '/': { title: 'Dashboard', breadcrumb: 'Dashboard' },
  '/order-search': { title: 'Search Orders', breadcrumb: 'Search' },
  '/orders': { title: 'Orders', breadcrumb: 'Orders' },
  '/products': { title: 'Products', breadcrumb: 'Products' },
  '/inventory': { title: 'Inventory', breadcrumb: 'Inventory' },
  '/returns': { title: 'Returns', breadcrumb: 'Returns' },
  '/returns-rto': { title: 'RTO Inward', breadcrumb: 'RTO Inward' },
  '/production': { title: 'Production', breadcrumb: 'Production' },
  '/inventory-inward': { title: 'Inventory Inward', breadcrumb: 'Inventory Inward' },
  '/fabrics': { title: 'Fabrics', breadcrumb: 'Fabrics' },
  '/inventory-count': { title: 'Inventory Count', breadcrumb: 'Inventory Count' },
  '/fabric-count': { title: 'Fabric Count', breadcrumb: 'Fabric Count' },
  '/customers': { title: 'Customers', breadcrumb: 'Customers' },
  '/ledgers': { title: 'Ledgers', breadcrumb: 'Ledgers' },
  '/analytics': { title: 'Analytics', breadcrumb: 'Analytics' },
  '/settings': { title: 'Settings', breadcrumb: 'Settings' },
  '/users': { title: 'User Management', breadcrumb: 'Users' },
  '/login': { title: 'Login', breadcrumb: 'Login' },
};

export const APP_NAME = 'COH ERP';

/**
 * Get page title for document.title
 * @param path Route path
 * @returns Formatted title: "Page | COH ERP" or just "COH ERP"
 */
export function getPageTitle(path: string): string {
  const meta = routeMeta[path];
  return meta ? `${meta.title} | ${APP_NAME}` : APP_NAME;
}

/**
 * Get breadcrumb text for a route
 * @param path Route path
 * @returns Breadcrumb text or fallback
 */
export function getBreadcrumb(path: string): string {
  return routeMeta[path]?.breadcrumb || path.slice(1) || 'Home';
}
