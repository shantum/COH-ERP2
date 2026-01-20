/**
 * Route Tree Generator - TanStack Router
 *
 * This file manually constructs the route tree since we're not using
 * the Vite plugin for file-based routing. Each route is defined with
 * its proper parent relationship.
 */

import { createRoute, createRootRouteWithContext, redirect } from '@tanstack/react-router';
import type { RouterContext } from './routerContext';
import { lazy } from 'react';

// Import schemas
import {
    OrdersSearchParams,
    ProductsSearchParams,
    InventorySearchParams,
    CustomersSearchParams,
    ProductionSearchParams,
    ReturnsSearchParams,
    AnalyticsSearchParams,
    LedgersSearchParams,
    OrderSearchSearchParams,
} from '@coh/shared';

// Import query options for route loaders
import {
    ordersAnalyticsQueryOptions,
    topProductsQueryOptions,
    topFabricsQueryOptions,
    topCustomersQueryOptions,
} from './queries/dashboardQueries';

// Lazy load page components for code splitting
const Login = lazy(() => import('./pages/Login'));
const Dashboard = lazy(() => import('./pages/Dashboard'));
const Orders = lazy(() => import('./pages/Orders'));
const Products = lazy(() => import('./pages/Products'));
const Inventory = lazy(() => import('./pages/Inventory'));
const Customers = lazy(() => import('./pages/Customers'));
const Settings = lazy(() => import('./pages/Settings'));
const Production = lazy(() => import('./pages/Production'));
const Returns = lazy(() => import('./pages/Returns'));
const ReturnsRto = lazy(() => import('./pages/ReturnsRto'));
const InventoryInward = lazy(() => import('./pages/InventoryInward'));
const Analytics = lazy(() => import('./pages/Analytics'));
const Ledgers = lazy(() => import('./pages/Ledgers'));
const Fabrics = lazy(() => import('./pages/Fabrics'));
const FabricReconciliation = lazy(() => import('./pages/FabricReconciliation'));
const InventoryReconciliation = lazy(() => import('./pages/InventoryReconciliation'));
const OrderSearch = lazy(() => import('./pages/OrderSearch'));
const UserManagement = lazy(() => import('./pages/UserManagement'));
const Layout = lazy(() => import('./components/Layout'));

// Import root route component
import { RootComponent } from './routes/__root';
import { RouterErrorComponent } from './components/RouterErrorComponent';
import { RouterNotFoundComponent } from './components/RouterNotFoundComponent';

// ============================================
// ROOT ROUTE
// ============================================
export const rootRoute = createRootRouteWithContext<RouterContext>()({
    component: RootComponent,
    errorComponent: RouterErrorComponent,
    notFoundComponent: RouterNotFoundComponent,
});

// ============================================
// LOGIN ROUTE (Public)
// ============================================
export const loginRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/login',
    beforeLoad: ({ context }) => {
        if (context.auth.isAuthenticated) {
            throw redirect({ to: '/' });
        }
    },
    component: Login,
});

// ============================================
// AUTHENTICATED LAYOUT ROUTE
// ============================================
export const authenticatedRoute = createRoute({
    getParentRoute: () => rootRoute,
    id: '_authenticated',
    beforeLoad: ({ context }) => {
        if (context.auth.isLoading) {
            return;
        }
        if (!context.auth.isAuthenticated) {
            throw redirect({ to: '/login' });
        }
    },
    component: Layout,
});

// ============================================
// AUTHENTICATED CHILD ROUTES
// ============================================
export const indexRoute = createRoute({
    getParentRoute: () => authenticatedRoute,
    path: '/',
    loader: async ({ context }) => {
        const { queryClient } = context;

        // Prefetch all dashboard queries in parallel
        await Promise.all([
            queryClient.ensureQueryData(ordersAnalyticsQueryOptions),
            queryClient.ensureQueryData(topProductsQueryOptions(30, 'product')),
            queryClient.ensureQueryData(topFabricsQueryOptions(30, 'type')),
            queryClient.ensureQueryData(topCustomersQueryOptions('3months')),
        ]);

        return {}; // Components read from cache
    },
    component: Dashboard,
});

export const ordersRoute = createRoute({
    getParentRoute: () => authenticatedRoute,
    path: '/orders',
    validateSearch: (search) => OrdersSearchParams.parse(search),
    // Note: Orders data is fetched via tRPC in the component.
    // tRPC React hooks don't support raw queries in loaders without additional setup.
    // The hybrid loading strategy in useUnifiedOrdersData handles prefetching adjacent pages.
    component: Orders,
});

export const productsRoute = createRoute({
    getParentRoute: () => authenticatedRoute,
    path: '/products',
    validateSearch: (search) => ProductsSearchParams.parse(search),
    component: Products,
});

export const inventoryRoute = createRoute({
    getParentRoute: () => authenticatedRoute,
    path: '/inventory',
    validateSearch: (search) => InventorySearchParams.parse(search),
    component: Inventory,
});

export const customersRoute = createRoute({
    getParentRoute: () => authenticatedRoute,
    path: '/customers',
    validateSearch: (search) => CustomersSearchParams.parse(search),
    component: Customers,
});

export const settingsRoute = createRoute({
    getParentRoute: () => authenticatedRoute,
    path: '/settings',
    component: Settings,
});

export const productionRoute = createRoute({
    getParentRoute: () => authenticatedRoute,
    path: '/production',
    validateSearch: (search) => ProductionSearchParams.parse(search),
    component: Production,
});

export const returnsRoute = createRoute({
    getParentRoute: () => authenticatedRoute,
    path: '/returns',
    validateSearch: (search) => ReturnsSearchParams.parse(search),
    component: Returns,
});

export const returnsRtoRoute = createRoute({
    getParentRoute: () => authenticatedRoute,
    path: '/returns-rto',
    component: ReturnsRto,
});

export const inventoryInwardRoute = createRoute({
    getParentRoute: () => authenticatedRoute,
    path: '/inventory-inward',
    component: InventoryInward,
});

export const analyticsRoute = createRoute({
    getParentRoute: () => authenticatedRoute,
    path: '/analytics',
    validateSearch: (search) => AnalyticsSearchParams.parse(search),
    component: Analytics,
});

export const ledgersRoute = createRoute({
    getParentRoute: () => authenticatedRoute,
    path: '/ledgers',
    validateSearch: (search) => LedgersSearchParams.parse(search),
    component: Ledgers,
});

export const fabricsRoute = createRoute({
    getParentRoute: () => authenticatedRoute,
    path: '/fabrics',
    component: Fabrics,
});

export const fabricReconciliationRoute = createRoute({
    getParentRoute: () => authenticatedRoute,
    path: '/fabric-reconciliation',
    component: FabricReconciliation,
});

export const inventoryCountRoute = createRoute({
    getParentRoute: () => authenticatedRoute,
    path: '/inventory-count',
    component: InventoryReconciliation,
});

export const orderSearchRoute = createRoute({
    getParentRoute: () => authenticatedRoute,
    path: '/order-search',
    validateSearch: (search) => OrderSearchSearchParams.parse(search),
    component: OrderSearch,
});

export const usersRoute = createRoute({
    getParentRoute: () => authenticatedRoute,
    path: '/users',
    component: UserManagement,
});

// ============================================
// REDIRECT ROUTES
// ============================================
export const catalogRedirectRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/catalog',
    beforeLoad: () => {
        throw redirect({ to: '/products', search: { tab: 'products' } as any });
    },
});

export const materialsRedirectRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/materials',
    beforeLoad: () => {
        throw redirect({ to: '/products', search: { tab: 'materials' } as any });
    },
});

export const shipmentsRedirectRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/shipments',
    beforeLoad: () => {
        throw redirect({ to: '/orders', search: { view: 'shipped' } as any });
    },
});

export const inwardHubRedirectRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/inward-hub',
    beforeLoad: () => {
        throw redirect({ to: '/inventory-inward' });
    },
});

export const productionInwardRedirectRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/production-inward',
    beforeLoad: () => {
        throw redirect({ to: '/inventory-inward' });
    },
});

export const returnInwardRedirectRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/return-inward',
    beforeLoad: () => {
        throw redirect({ to: '/returns-rto' });
    },
});

// ============================================
// ROUTE TREE
// ============================================
export const routeTree = rootRoute.addChildren([
    loginRoute,
    catalogRedirectRoute,
    materialsRedirectRoute,
    shipmentsRedirectRoute,
    inwardHubRedirectRoute,
    productionInwardRedirectRoute,
    returnInwardRedirectRoute,
    authenticatedRoute.addChildren([
        indexRoute,
        ordersRoute,
        productsRoute,
        inventoryRoute,
        customersRoute,
        settingsRoute,
        productionRoute,
        returnsRoute,
        returnsRtoRoute,
        inventoryInwardRoute,
        analyticsRoute,
        ledgersRoute,
        fabricsRoute,
        fabricReconciliationRoute,
        inventoryCountRoute,
        orderSearchRoute,
        usersRoute,
    ]),
]);
