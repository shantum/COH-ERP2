/**
 * CustomerTab - Customer intelligence view within UnifiedOrderModal
 *
 * Displays customer profile, quick stats, style DNA, and order history
 * with navigation capability to other orders.
 */

import { useMemo } from 'react';
import {
  Mail, Phone, MessageCircle,
  Palette, Package, Layers,
  RotateCcw, Truck, ShoppingBag,
  AlertTriangle, AlertCircle, CheckCircle2
} from 'lucide-react';
import { OrderHistoryCard } from './OrderHistoryCard';
import {
  getTierConfig,
  calculateHealthScore,
  getHealthScoreColor,
  getHealthScoreLabel,
  calculateTierProgress,
  getColorHex,
  getInitials,
  type CustomerData as BaseCustomerData,
} from '../../../../utils/customerIntelligence';

// ============================================================================
// TYPES
// ============================================================================

interface OrderLine {
  id: string;
  qty: number;
  sku?: {
    size?: string;
    variation?: {
      colorName?: string;
      imageUrl?: string;
      product?: { name?: string; imageUrl?: string };
    };
  };
}

interface OrderSummary {
  id: string;
  orderNumber: string;
  status: string;
  totalAmount: number;
  orderDate: string;
  orderLines?: OrderLine[];
}

// Extended CustomerData with affinities and orders
interface CustomerData extends BaseCustomerData {
  colorAffinity?: Array<{ color: string; qty: number; hex?: string }> | null;
  productAffinity?: Array<{ productName: string; qty: number }> | null;
  fabricAffinity?: Array<{ fabricType: string; qty: number }> | null;
  orders?: OrderSummary[] | null;
}

interface CustomerTabProps {
  customer: CustomerData | null;
  currentOrderId: string;
  onSelectOrder: (orderId: string) => void;
  isLoading: boolean;
}

// ============================================================================
// SUB-COMPONENTS
// ============================================================================

function TierBadge({ tier }: { tier: string }) {
  const config = getTierConfig(tier);
  const Icon = config.icon;

  return (
    <div className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border ${config.bg} ${config.text} ${config.border}`}>
      <Icon size={12} />
      <span className="text-[10px] font-bold tracking-wider">{config.label}</span>
    </div>
  );
}

function CompactHealthGauge({ score }: { score: number }) {
  const color = getHealthScoreColor(score);
  const label = getHealthScoreLabel(score);
  const circumference = 2 * Math.PI * 20;
  const offset = circumference - (score / 100) * circumference;

  return (
    <div className="flex items-center gap-3">
      <div className="relative w-12 h-12">
        <svg className="w-full h-full transform -rotate-90" viewBox="0 0 50 50">
          <circle cx="25" cy="25" r="20" fill="none" stroke="#e5e7eb" strokeWidth="4" />
          <circle
            cx="25" cy="25" r="20" fill="none" stroke={color} strokeWidth="4"
            strokeLinecap="round" strokeDasharray={circumference} strokeDashoffset={offset}
            style={{ transition: 'stroke-dashoffset 0.5s ease-out' }}
          />
        </svg>
        <div className="absolute inset-0 flex items-center justify-center">
          <span className="text-sm font-bold" style={{ color }}>{score}</span>
        </div>
      </div>
      <div>
        <div className="text-xs font-medium text-slate-600">Health Score</div>
        <div className="text-[10px] text-slate-400">{label}</div>
      </div>
    </div>
  );
}

function QuickStatCard({ label, value, icon: Icon, color = 'slate' }: {
  label: string;
  value: string | number;
  icon: React.ElementType;
  color?: string;
}) {
  const colorClasses: Record<string, { iconBg: string; iconText: string }> = {
    sky: { iconBg: 'bg-sky-50', iconText: 'text-sky-600' },
    slate: { iconBg: 'bg-slate-50', iconText: 'text-slate-600' },
    red: { iconBg: 'bg-red-50', iconText: 'text-red-600' },
    amber: { iconBg: 'bg-amber-50', iconText: 'text-amber-600' },
  };
  const classes = colorClasses[color] || colorClasses.slate;

  return (
    <div className="bg-white rounded-lg p-3 border border-slate-100">
      <div className="flex items-center gap-2 mb-1">
        <div className={`p-1.5 rounded ${classes.iconBg}`}>
          <Icon size={12} className={classes.iconText} />
        </div>
      </div>
      <div className="font-bold text-lg text-slate-900 tabular-nums">{value}</div>
      <div className="text-[9px] uppercase tracking-wider text-slate-500">{label}</div>
    </div>
  );
}

function ColorSwatch({ color, qty, total, hex: providedHex }: { color: string; qty: number; total: number; hex?: string | null }) {
  const hex = providedHex || getColorHex(color);
  const percentage = (qty / total) * 100;

  const isLight = (() => {
    const hexClean = hex.replace('#', '');
    const r = parseInt(hexClean.substring(0, 2), 16);
    const g = parseInt(hexClean.substring(2, 4), 16);
    const b = parseInt(hexClean.substring(4, 6), 16);
    return (0.299 * r + 0.587 * g + 0.114 * b) / 255 > 0.7;
  })();

  return (
    <div className="flex flex-col items-center gap-1 group">
      <div
        className={`w-8 h-8 rounded-full shadow-sm border ${isLight ? 'border-slate-200' : 'border-white'} transition-transform group-hover:scale-110`}
        style={{ backgroundColor: hex }}
        title={`${color}: ${qty} items`}
      />
      <span className="text-[8px] text-slate-500 max-w-[40px] truncate text-center">{color}</span>
      <div className="w-8 h-0.5 bg-slate-100 rounded-full overflow-hidden">
        <div className="h-full bg-purple-400 rounded-full" style={{ width: `${percentage}%` }} />
      </div>
    </div>
  );
}

function RiskAlert({ type, message, severity }: { type: string; message: string; severity: 'high' | 'medium' | 'low' }) {
  const config = {
    high: { bg: 'bg-red-50', border: 'border-red-200', text: 'text-red-700', icon: AlertCircle },
    medium: { bg: 'bg-amber-50', border: 'border-amber-200', text: 'text-amber-700', icon: AlertTriangle },
    low: { bg: 'bg-sky-50', border: 'border-sky-200', text: 'text-sky-700', icon: AlertCircle }
  };

  const { bg, border, text, icon: Icon } = config[severity];

  return (
    <div className={`flex items-start gap-2 p-2 rounded-lg ${bg} border ${border}`}>
      <Icon size={14} className={text} />
      <div>
        <div className={`text-xs font-medium ${text}`}>{type}</div>
        <div className="text-[10px] text-slate-600">{message}</div>
      </div>
    </div>
  );
}

function TierProgressBar({ progress, nextTier, amountToNext, shouldUpgrade }: { progress: number; nextTier: string | null; amountToNext: number; shouldUpgrade?: boolean }) {
  if (!nextTier) {
    return (
      <div className="flex items-center gap-1.5 text-[10px] text-slate-500">
        <CheckCircle2 size={12} className="text-purple-500" />
        <span>Highest tier achieved</span>
      </div>
    );
  }

  if (shouldUpgrade) {
    return (
      <div className="space-y-1">
        <div className="flex items-center gap-1.5 text-[10px] text-emerald-600">
          <CheckCircle2 size={12} />
          <span className="font-medium">Qualifies for {nextTier}!</span>
        </div>
        <div className="h-1.5 bg-slate-100 rounded-full overflow-hidden">
          <div className="h-full bg-gradient-to-r from-emerald-400 to-emerald-600 rounded-full w-full" />
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-1">
      <div className="flex justify-between text-[10px]">
        <span className="text-slate-500">Progress to {nextTier}</span>
        <span className="font-medium text-slate-700">{Math.round(progress)}%</span>
      </div>
      <div className="h-1.5 bg-slate-100 rounded-full overflow-hidden">
        <div className="h-full bg-gradient-to-r from-sky-400 to-sky-600 rounded-full transition-all duration-500" style={{ width: `${progress}%` }} />
      </div>
      <p className="text-[9px] text-slate-400">{amountToNext.toLocaleString()} more to reach {nextTier}</p>
    </div>
  );
}

// ============================================================================
// MAIN COMPONENT
// ============================================================================

export function CustomerTab({ customer, currentOrderId, onSelectOrder, isLoading }: CustomerTabProps) {
  // Calculate size preferences from orders
  const sizePreferences = useMemo(() => {
    if (!customer?.orders) return [];
    const sizeCounts: Record<string, number> = {};
    customer.orders.forEach((order) => {
      order.orderLines?.forEach((line) => {
        const size = line.sku?.size;
        if (size) {
          sizeCounts[size] = (sizeCounts[size] || 0) + line.qty;
        }
      });
    });
    return Object.entries(sizeCounts)
      .map(([size, count]) => ({ size, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 5);
  }, [customer?.orders]);

  // Loading state
  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-16">
        <div className="flex flex-col items-center gap-3">
          <div className="animate-spin rounded-full h-8 w-8 border-2 border-slate-200 border-t-sky-500" />
          <span className="text-sm text-slate-500">Loading customer profile...</span>
        </div>
      </div>
    );
  }

  // No customer data
  if (!customer) {
    return (
      <div className="flex flex-col items-center justify-center py-16">
        <div className="w-14 h-14 rounded-full bg-slate-100 flex items-center justify-center mb-3">
          <AlertCircle size={28} className="text-slate-400" />
        </div>
        <p className="text-slate-600 font-medium">No customer linked</p>
        <p className="text-sm text-slate-400 mt-1">This order has no associated customer</p>
      </div>
    );
  }

  // Calculated metrics
  const healthScore = calculateHealthScore(customer);
  const tierProgress = calculateTierProgress(
    customer.lifetimeValue || 0,
    customer.customerTier || 'bronze'
  );
  const daysSinceOrder = customer.lastOrderDate
    ? Math.floor((Date.now() - new Date(customer.lastOrderDate).getTime()) / (1000 * 60 * 60 * 24))
    : null;

  // Calculate AVG order value
  const avgOrderValue = customer.avgOrderValue ||
    (customer.totalOrders && customer.totalOrders > 0 ? Math.round((customer.lifetimeValue || 0) / customer.totalOrders) : 0);

  // Risk indicators
  const risks: Array<{ type: string; message: string; severity: 'high' | 'medium' | 'low' }> = [];

  if (daysSinceOrder !== null && daysSinceOrder > 90) {
    risks.push({
      type: 'Inactive Customer',
      message: `No orders in ${daysSinceOrder} days`,
      severity: daysSinceOrder > 180 ? 'high' : 'medium'
    });
  }

  if ((customer.returnRate || 0) > 25) {
    risks.push({
      type: 'High Return Rate',
      message: `${(customer.returnRate || 0).toFixed(1)}% return rate`,
      severity: (customer.returnRate || 0) > 40 ? 'high' : 'medium'
    });
  }

  if ((customer.rtoCount || 0) > 2) {
    risks.push({
      type: 'Multiple RTOs',
      message: `${customer.rtoCount} RTO incidents`,
      severity: (customer.rtoCount || 0) > 5 ? 'high' : 'medium'
    });
  }

  const totalColorQty = customer.colorAffinity?.reduce((sum, c) => sum + c.qty, 0) || 1;
  const tierConfig = TIER_CONFIG[customer.customerTier?.toLowerCase() as keyof typeof TIER_CONFIG] || TIER_CONFIG.bronze;

  return (
    <div className="space-y-5">
      {/* Header: Customer Info + Quick Stats */}
      <div className="flex gap-4">
        {/* Left: Customer Identity */}
        <div className="bg-gradient-to-br from-slate-50 via-white to-slate-50 rounded-xl p-4 border border-slate-100 min-w-[240px]">
          <div className="flex items-center gap-3 mb-3">
            <div className={`w-12 h-12 rounded-full flex items-center justify-center ${tierConfig.bg} text-white text-lg font-bold shadow-md`}>
              {getInitials(customer.firstName, customer.lastName)}
            </div>
            <div>
              <h3 className="font-semibold text-slate-900">
                {customer.firstName} {customer.lastName}
              </h3>
              <TierBadge tier={customer.customerTier || 'bronze'} />
            </div>
          </div>

          {/* Contact Actions */}
          <div className="flex gap-1.5 mb-3">
            {customer.email && (
              <a
                href={`mailto:${customer.email}`}
                className="p-2 rounded-lg bg-white border border-slate-200 hover:border-sky-300 hover:bg-sky-50 transition-colors group"
                title={customer.email}
              >
                <Mail size={14} className="text-slate-400 group-hover:text-sky-600" />
              </a>
            )}
            {customer.phone && (
              <>
                <a
                  href={`tel:${customer.phone}`}
                  className="p-2 rounded-lg bg-white border border-slate-200 hover:border-sky-300 hover:bg-sky-50 transition-colors group"
                  title={customer.phone}
                >
                  <Phone size={14} className="text-slate-400 group-hover:text-sky-600" />
                </a>
                <a
                  href={`https://wa.me/${customer.phone.replace(/\D/g, '')}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="p-2 rounded-lg bg-white border border-slate-200 hover:border-green-300 hover:bg-green-50 transition-colors group"
                  title="WhatsApp"
                >
                  <MessageCircle size={14} className="text-slate-400 group-hover:text-green-600" />
                </a>
              </>
            )}
          </div>

          {/* Contact Info */}
          <div className="space-y-1 text-xs text-slate-600 mb-4">
            {customer.email && (
              <div className="truncate">{customer.email}</div>
            )}
            {customer.phone && (
              <div>{customer.phone}</div>
            )}
          </div>

          {/* Tier Progress */}
          <TierProgressBar
            progress={tierProgress.progress}
            nextTier={tierProgress.nextTier}
            amountToNext={tierProgress.amountToNext}
            shouldUpgrade={tierProgress.shouldUpgrade}
          />
        </div>

        {/* Right: Stats Grid */}
        <div className="flex-1 space-y-3">
          {/* LTV + Health Score Row */}
          <div className="flex gap-3">
            {/* LTV Card */}
            <div className="flex-1 bg-gradient-to-br from-sky-500 to-sky-600 rounded-xl p-4 text-white relative overflow-hidden">
              <div className="absolute inset-0 opacity-10" style={{
                backgroundImage: 'radial-gradient(circle at 2px 2px, white 1px, transparent 0)',
                backgroundSize: '16px 16px'
              }} />
              <div className="relative">
                <div className="text-[10px] uppercase tracking-wider text-sky-100 mb-0.5">Lifetime Value</div>
                <div className="text-2xl font-bold tabular-nums">
                  {(customer.lifetimeValue || 0).toLocaleString('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 })}
                </div>
                <div className="mt-2 flex items-center gap-3 text-sky-100 text-xs">
                  <div>
                    <span className="font-semibold text-white">{customer.totalOrders || 0}</span> orders
                  </div>
                  <div>
                    <span className="font-semibold text-white">{avgOrderValue.toLocaleString('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 })}</span> avg
                  </div>
                </div>
              </div>
            </div>

            {/* Health Score */}
            <div className="bg-white rounded-xl p-4 border border-slate-100 flex items-center justify-center">
              <CompactHealthGauge score={healthScore} />
            </div>
          </div>

          {/* Quick Stats Grid */}
          <div className="grid grid-cols-4 gap-2">
            <QuickStatCard label="Orders" value={customer.totalOrders || 0} icon={ShoppingBag} color="sky" />
            <QuickStatCard label="Return Rate" value={`${(customer.returnRate || 0).toFixed(1)}%`} icon={RotateCcw} color={(customer.returnRate || 0) > 20 ? 'red' : 'slate'} />
            <QuickStatCard label="Exchanges" value={customer.exchangeCount || 0} icon={Package} color="amber" />
            <QuickStatCard label="RTOs" value={customer.rtoCount || 0} icon={Truck} color={(customer.rtoCount || 0) > 2 ? 'red' : 'slate'} />
          </div>

          {/* Risk Alerts */}
          {risks.length > 0 && (
            <div className="grid grid-cols-2 gap-2">
              {risks.slice(0, 2).map((risk, i) => (
                <RiskAlert key={i} {...risk} />
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Style DNA Section */}
      {(customer.colorAffinity?.length || customer.productAffinity?.length || customer.fabricAffinity?.length || sizePreferences.length) && (
        <div className="bg-white rounded-xl border border-slate-100 overflow-hidden">
          <div className="px-4 py-2.5 bg-gradient-to-r from-slate-50 to-white border-b border-slate-100">
            <h4 className="text-xs font-semibold uppercase tracking-wider text-slate-600 flex items-center gap-2">
              <Palette size={12} />
              Style DNA
            </h4>
          </div>

          <div className="p-4 space-y-4">
            {/* Color Palette */}
            {customer.colorAffinity && customer.colorAffinity.length > 0 && (
              <div>
                <div className="text-[9px] uppercase tracking-wider text-slate-500 mb-2">Color Palette</div>
                <div className="flex gap-3 overflow-x-auto pb-1">
                  {customer.colorAffinity.slice(0, 8).map((c, i) => (
                    <ColorSwatch key={i} color={c.color} qty={c.qty} total={totalColorQty} hex={c.hex} />
                  ))}
                </div>
              </div>
            )}

            {/* Products + Fabrics inline */}
            <div className="flex gap-6">
              {customer.productAffinity && customer.productAffinity.length > 0 && (
                <div className="flex-1">
                  <div className="text-[9px] uppercase tracking-wider text-slate-500 mb-2 flex items-center gap-1">
                    <Package size={10} />
                    Top Products
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {customer.productAffinity.slice(0, 4).map((p, i) => (
                      <span key={i} className="px-2 py-1 bg-slate-100 rounded-md text-xs">
                        {p.productName} <span className="text-slate-400">({p.qty})</span>
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {customer.fabricAffinity && customer.fabricAffinity.length > 0 && (
                <div className="flex-1">
                  <div className="text-[9px] uppercase tracking-wider text-slate-500 mb-2 flex items-center gap-1">
                    <Layers size={10} />
                    Fabrics
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {customer.fabricAffinity.slice(0, 3).map((f, i) => (
                      <span key={i} className="px-2 py-1 bg-amber-50 text-amber-800 rounded-md text-xs">
                        {f.fabricType} <span className="text-amber-500">({f.qty})</span>
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* Size Preferences */}
            {sizePreferences.length > 0 && (
              <div>
                <div className="text-[9px] uppercase tracking-wider text-slate-500 mb-2">Size Preferences</div>
                <div className="flex flex-wrap gap-1.5">
                  {sizePreferences.map(({ size, count }) => (
                    <span key={size} className="px-2 py-1 bg-sky-50 text-sky-800 rounded-md text-xs font-medium">
                      {size} <span className="text-sky-500 font-normal">({count})</span>
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Order History */}
      {customer.orders && customer.orders.length > 0 && (
        <div className="bg-white rounded-xl border border-slate-100 overflow-hidden">
          <div className="px-4 py-2.5 bg-gradient-to-r from-slate-50 to-white border-b border-slate-100 flex items-center justify-between">
            <h4 className="text-xs font-semibold uppercase tracking-wider text-slate-600 flex items-center gap-2">
              <ShoppingBag size={12} />
              Order History
            </h4>
            <span className="text-xs text-slate-400">
              {customer.orders.length} order{customer.orders.length === 1 ? '' : 's'}
            </span>
          </div>

          <div className="p-3 space-y-2 max-h-[280px] overflow-y-auto">
            {customer.orders.map((order) => (
              <OrderHistoryCard
                key={order.id}
                order={order}
                isCurrent={order.id === currentOrderId}
                onClick={() => onSelectOrder(order.id)}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export default CustomerTab;
