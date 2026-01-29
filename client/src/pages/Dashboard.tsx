/**
 * Dashboard Page
 *
 * SSR-optimized dashboard with pre-fetched analytics data.
 * Uses Route.useLoaderData() for SSR hydration.
 */
import { AlertCircle, RefreshCcw } from 'lucide-react';
import { Route } from '../routes/_authenticated/index';
import { OrdersAnalyticsBar } from '../components/orders/OrdersAnalyticsBar';
import { TopProductsCard } from '../components/dashboard/TopProductsCard';
import { TopFabricsCard } from '../components/dashboard/TopFabricsCard';
import { TopCustomersCard } from '../components/dashboard/TopCustomersCard';

export default function Dashboard() {
    // Get SSR pre-fetched data from route loader
    const loaderData = Route.useLoaderData();

    // Show error state if loader failed and no data
    if (loaderData.error && !loaderData.analytics) {
        return (
            <div className="p-4 sm:p-6">
                <h1 className="text-lg sm:text-xl md:text-2xl font-bold text-gray-900 mb-4">Dashboard</h1>
                <div className="bg-red-50 border border-red-200 rounded-lg p-4 flex items-start gap-3">
                    <AlertCircle className="w-5 h-5 text-red-500 flex-shrink-0 mt-0.5" />
                    <div>
                        <h2 className="text-red-800 font-semibold">Failed to load dashboard</h2>
                        <p className="text-red-600 text-sm mt-1">{loaderData.error}</p>
                        <button
                            onClick={() => window.location.reload()}
                            className="mt-3 inline-flex items-center gap-1.5 text-sm text-red-700 hover:text-red-800 font-medium"
                        >
                            <RefreshCcw className="w-4 h-4" />
                            Refresh page
                        </button>
                    </div>
                </div>
            </div>
        );
    }

    return (
        <div className="space-y-3 sm:space-y-4 md:space-y-6 px-2 sm:px-0">
            <h1 className="text-lg sm:text-xl md:text-2xl font-bold text-gray-900">Dashboard</h1>

            {/* Orders Analytics Bar - pass SSR data for instant render */}
            <OrdersAnalyticsBar initialData={loaderData.analytics} />

            {/* Analytics Cards Grid - Responsive 1/2/3 column layout */}
            <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-3 sm:gap-4 md:gap-6">
                {/* Top Products */}
                <TopProductsCard />

                {/* Top Fabrics */}
                <TopFabricsCard />

                {/* Top Customers */}
                <TopCustomersCard />
            </div>
        </div>
    );
}
