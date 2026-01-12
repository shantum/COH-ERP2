import { OrdersAnalyticsBar } from '../components/orders/OrdersAnalyticsBar';
import { TopProductsCard } from '../components/dashboard/TopProductsCard';
import { TopFabricsCard } from '../components/dashboard/TopFabricsCard';
import { TopCustomersCard } from '../components/dashboard/TopCustomersCard';

export default function Dashboard() {
    return (
        <div className="space-y-3 sm:space-y-4 md:space-y-6 px-2 sm:px-0">
            <h1 className="text-lg sm:text-xl md:text-2xl font-bold text-gray-900">Dashboard</h1>

            {/* Orders Analytics Bar */}
            <OrdersAnalyticsBar />

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
