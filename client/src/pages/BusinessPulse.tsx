/**
 * Business Pulse Page
 *
 * SSR-optimized business snapshot with pre-fetched pulse data.
 * Uses Route.useLoaderData() for SSR hydration.
 */
import {
    AlertCircle,
    RefreshCcw,
    IndianRupee,
    ShoppingCart,
    Package,
    Factory,
    Landmark,
    FileText,
    Truck,
    Scissors,
    TrendingUp,
    Activity,
} from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { Route } from '../routes/_authenticated/business/index';
import { getRecentEventsFn } from '../server/functions/business';
import type {
    BusinessPulse,
    PulseTopProduct,
} from '@coh/shared/services/business/types';

const inr = (n: number) => `₹${n.toLocaleString('en-IN')}`;

function StatRow({ label, value, sub }: { label: string; value: string; sub?: string }) {
    return (
        <div className="flex items-center justify-between py-1">
            <span className="text-sm text-gray-500">{label}</span>
            <div className="text-right">
                <span className="text-sm font-semibold text-gray-900">{value}</span>
                {sub && <span className="text-xs text-gray-400 ml-1">{sub}</span>}
            </div>
        </div>
    );
}

function PipelineBar({ label, count, total }: { label: string; count: number; total: number }) {
    const pct = total > 0 ? (count / total) * 100 : 0;
    return (
        <div className="space-y-0.5">
            <div className="flex justify-between text-xs">
                <span className="text-gray-600">{label}</span>
                <span className="font-medium text-gray-900">{count}</span>
            </div>
            <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
                <div className="h-full bg-blue-500 rounded-full" style={{ width: `${pct}%` }} />
            </div>
        </div>
    );
}

function Card({
    title,
    icon: Icon,
    children,
}: {
    title: string;
    icon: typeof IndianRupee;
    children: React.ReactNode;
}) {
    return (
        <div className="bg-white rounded-lg border border-gray-200 p-4 shadow-sm">
            <div className="flex items-center gap-2 mb-3">
                <Icon size={16} className="text-gray-400" />
                <h3 className="text-sm font-semibold text-gray-700">{title}</h3>
            </div>
            {children}
        </div>
    );
}

function RevenueCard({ revenue }: { revenue: BusinessPulse['revenue'] }) {
    return (
        <Card title="Revenue" icon={IndianRupee}>
            <StatRow label="Today" value={inr(revenue.today)} sub={`${revenue.todayOrderCount} orders`} />
            <StatRow label="Last 7 days" value={inr(revenue.last7Days)} />
            <StatRow label="Last 30 days" value={inr(revenue.last30Days)} sub={`${revenue.last30DaysOrderCount} orders`} />
            <StatRow label="MTD" value={inr(revenue.mtd)} />
            <div className="mt-2 pt-2 border-t border-gray-100 flex gap-3 text-xs text-gray-500">
                <span>New: <span className="font-medium text-gray-700">{revenue.newVsReturning.newCustomers}</span></span>
                <span>Returning: <span className="font-medium text-gray-700">{revenue.newVsReturning.returningCustomers}</span></span>
            </div>
        </Card>
    );
}

function OrderPipelineCard({ pipeline }: { pipeline: BusinessPulse['orderPipeline'] }) {
    const total = pipeline.pendingLines + pipeline.allocatedLines + pipeline.pickedLines + pipeline.packedLines;
    return (
        <Card title="Order Pipeline" icon={ShoppingCart}>
            <div className="space-y-2">
                <PipelineBar label="Pending" count={pipeline.pendingLines} total={total} />
                <PipelineBar label="Allocated" count={pipeline.allocatedLines} total={total} />
                <PipelineBar label="Picked" count={pipeline.pickedLines} total={total} />
                <PipelineBar label="Packed" count={pipeline.packedLines} total={total} />
            </div>
            <div className="mt-2 pt-2 border-t border-gray-100 text-xs text-gray-500">
                {pipeline.totalOrders} orders / {pipeline.totalUnits} units
            </div>
        </Card>
    );
}

function InventoryCard({ inventory }: { inventory: BusinessPulse['inventory'] }) {
    return (
        <Card title="Inventory" icon={Package}>
            <StatRow label="Total SKUs" value={inventory.totalSkus.toLocaleString('en-IN')} />
            <StatRow label="Total units" value={inventory.totalUnits.toLocaleString('en-IN')} />
            <StatRow
                label="Low stock"
                value={inventory.lowStockSkuCount.toString()}
                sub={inventory.lowStockSkuCount > 0 ? 'SKUs' : ''}
            />
        </Card>
    );
}

function ProductionCard({ production }: { production: BusinessPulse['production'] }) {
    return (
        <Card title="Production" icon={Factory}>
            <StatRow label="Open batches" value={production.openBatches.toString()} />
            <StatRow label="Planned" value={production.unitsPlanned.toLocaleString('en-IN')} sub="units" />
            <StatRow label="Completed" value={production.unitsCompleted.toLocaleString('en-IN')} sub="units" />
        </Card>
    );
}

function CashCard({ cash }: { cash: BusinessPulse['cash'] }) {
    return (
        <Card title="Cash Position" icon={Landmark}>
            <StatRow label="HDFC" value={cash.hdfcBalance != null ? inr(cash.hdfcBalance) : '—'} />
            <StatRow label="RazorpayX" value={cash.razorpayxBalance != null ? inr(cash.razorpayxBalance) : '—'} />
        </Card>
    );
}

function PayablesReceivablesCard({
    payables,
    receivables,
}: {
    payables: BusinessPulse['payables'];
    receivables: BusinessPulse['receivables'];
}) {
    return (
        <Card title="Payables & Receivables" icon={FileText}>
            <div className="text-xs font-medium text-gray-400 uppercase tracking-wider mb-1">Payables</div>
            <StatRow label="Outstanding" value={inr(payables.outstandingAmount)} sub={`${payables.outstandingCount} items`} />
            <div className="text-xs font-medium text-gray-400 uppercase tracking-wider mb-1 mt-2">Receivables</div>
            <StatRow label="Outstanding" value={inr(receivables.outstandingAmount)} sub={`${receivables.outstandingCount} items`} />
        </Card>
    );
}

function FulfillmentReturnsCard({
    fulfillment,
    returnRate,
}: {
    fulfillment: BusinessPulse['fulfillment'];
    returnRate: number | null;
}) {
    return (
        <Card title="Fulfillment & Returns" icon={Truck}>
            <StatRow
                label="Avg days to ship (30d)"
                value={fulfillment.avgDaysToShip30d != null ? fulfillment.avgDaysToShip30d.toFixed(1) : '—'}
            />
            <StatRow
                label="Return rate (30d)"
                value={returnRate != null ? `${returnRate.toFixed(1)}%` : '—'}
            />
        </Card>
    );
}

function MaterialHealthCard({ materialHealth }: { materialHealth: BusinessPulse['materialHealth'] }) {
    return (
        <Card title="Material Health" icon={Scissors}>
            <StatRow
                label="Low-stock fabric colours"
                value={materialHealth.lowStockFabricColours.toString()}
            />
        </Card>
    );
}

function TopProductsCard({ products }: { products: PulseTopProduct[] }) {
    if (products.length === 0) {
        return (
            <Card title="Top Products (7d)" icon={TrendingUp}>
                <p className="text-sm text-gray-400">No sales data</p>
            </Card>
        );
    }
    return (
        <Card title="Top Products (7d)" icon={TrendingUp}>
            <div className="space-y-2">
                {products.map((p, i) => (
                    <div key={p.id} className="flex items-center gap-2">
                        <span className="text-xs text-gray-400 w-4">{i + 1}.</span>
                        {p.imageUrl ? (
                            <img src={p.imageUrl} alt="" className="w-7 h-7 rounded object-cover" />
                        ) : (
                            <div className="w-7 h-7 rounded bg-gray-100" />
                        )}
                        <div className="flex-1 min-w-0">
                            <p className="text-sm text-gray-800 truncate">{p.name}</p>
                            <p className="text-xs text-gray-400">{p.units} units</p>
                        </div>
                        <span className="text-sm font-medium text-gray-700">{inr(p.revenue)}</span>
                    </div>
                ))}
            </div>
        </Card>
    );
}

const DOMAIN_COLORS: Record<string, string> = {
    orders: 'bg-blue-100 text-blue-700',
    shipping: 'bg-amber-100 text-amber-700',
    returns: 'bg-purple-100 text-purple-700',
    finance: 'bg-emerald-100 text-emerald-700',
    inventory: 'bg-cyan-100 text-cyan-700',
    production: 'bg-orange-100 text-orange-700',
    customers: 'bg-pink-100 text-pink-700',
};

const DOMAIN_ICONS: Record<string, typeof ShoppingCart> = {
    orders: ShoppingCart,
    shipping: Truck,
    returns: Package,
    finance: Landmark,
    inventory: Package,
    production: Factory,
    customers: FileText,
};

function timeAgo(date: Date | string): string {
    const now = new Date();
    const d = typeof date === 'string' ? new Date(date) : date;
    const diffMs = now.getTime() - d.getTime();
    const diffMin = Math.floor(diffMs / 60000);
    if (diffMin < 1) return 'just now';
    if (diffMin < 60) return `${diffMin}m ago`;
    const diffHr = Math.floor(diffMin / 60);
    if (diffHr < 24) return `${diffHr}h ago`;
    const diffDays = Math.floor(diffHr / 24);
    return `${diffDays}d ago`;
}

function RecentActivityCard() {
    const { data: events, isLoading } = useQuery({
        queryKey: ['business', 'recentEvents', 'getRecentEventsFn'],
        queryFn: () => getRecentEventsFn({ data: { limit: 20 } }),
        staleTime: 30_000,
    });

    return (
        <Card title="Recent Activity" icon={Activity}>
            {isLoading ? (
                <p className="text-sm text-gray-400">Loading...</p>
            ) : !events || events.length === 0 ? (
                <p className="text-sm text-gray-400">No recent activity</p>
            ) : (
                <div className="space-y-2 max-h-80 overflow-y-auto">
                    {events.map((ev) => {
                        const DomainIcon = DOMAIN_ICONS[ev.domain] ?? Activity;
                        const colorClass = DOMAIN_COLORS[ev.domain] ?? 'bg-gray-100 text-gray-700';
                        return (
                            <div key={ev.id} className="flex items-start gap-2 py-1">
                                <DomainIcon size={14} className="text-gray-400 mt-0.5 flex-shrink-0" />
                                <div className="flex-1 min-w-0">
                                    <div className="flex items-center gap-1.5">
                                        <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded ${colorClass}`}>
                                            {ev.domain}
                                        </span>
                                        <span className="text-[10px] text-gray-400">{ev.event}</span>
                                    </div>
                                    <p className="text-sm text-gray-700 truncate">{ev.summary}</p>
                                </div>
                                <span className="text-[10px] text-gray-400 whitespace-nowrap flex-shrink-0">
                                    {timeAgo(ev.createdAt)}
                                </span>
                            </div>
                        );
                    })}
                </div>
            )}
        </Card>
    );
}

export default function BusinessPulsePage() {
    const loaderData = Route.useLoaderData();

    if (loaderData.error && !loaderData.pulse) {
        return (
            <div className="p-4 sm:p-6">
                <h1 className="text-lg sm:text-xl md:text-2xl font-bold text-gray-900 mb-4">Business Pulse</h1>
                <div className="bg-red-50 border border-red-200 rounded-lg p-4 flex items-start gap-3">
                    <AlertCircle className="w-5 h-5 text-red-500 flex-shrink-0 mt-0.5" />
                    <div>
                        <h2 className="text-red-800 font-semibold">Failed to load business pulse</h2>
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

    const pulse = loaderData.pulse!;

    return (
        <div className="space-y-3 sm:space-y-4 md:space-y-6 px-2 sm:px-0">
            <div className="flex items-center justify-between">
                <h1 className="text-lg sm:text-xl md:text-2xl font-bold text-gray-900">Business Pulse</h1>
                <div className="flex items-center gap-3">
                    <span className="text-xs text-gray-400">
                        {new Date(pulse.generatedAt).toLocaleTimeString('en-IN', {
                            hour: '2-digit',
                            minute: '2-digit',
                        })}
                    </span>
                    <button
                        onClick={() => window.location.reload()}
                        className="inline-flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-700 font-medium"
                    >
                        <RefreshCcw className="w-4 h-4" />
                        Refresh
                    </button>
                </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                <RevenueCard revenue={pulse.revenue} />
                <OrderPipelineCard pipeline={pulse.orderPipeline} />
                <InventoryCard inventory={pulse.inventory} />
                <ProductionCard production={pulse.production} />
                <CashCard cash={pulse.cash} />
                <PayablesReceivablesCard payables={pulse.payables} receivables={pulse.receivables} />
                <FulfillmentReturnsCard fulfillment={pulse.fulfillment} returnRate={pulse.returnRate30d} />
                <MaterialHealthCard materialHealth={pulse.materialHealth} />
                <TopProductsCard products={pulse.topProducts7d} />
            </div>

            <div className="grid grid-cols-1 gap-4">
                <RecentActivityCard />
            </div>
        </div>
    );
}
