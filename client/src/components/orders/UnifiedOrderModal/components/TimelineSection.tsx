/**
 * TimelineSection - Order history timeline with expandable events
 */

import { useState } from 'react';
import {
  Clock, ChevronDown, ChevronUp, Package, Truck, CheckCircle,
  XCircle, RefreshCw, CreditCard, Edit3, AlertTriangle
} from 'lucide-react';
import type { Order } from '../../../../types';

interface TimelineSectionProps {
  order: Order;
}

interface TimelineEvent {
  id: string;
  type: string;
  title: string;
  description?: string;
  timestamp: Date;
  icon: React.ReactNode;
  color: string;
}

// Format timestamp
const formatTimestamp = (date: Date) => {
  return date.toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
};

// Get icon and color for event type
const getEventConfig = (type: string): { icon: React.ReactNode; color: string } => {
  const configs: Record<string, { icon: React.ReactNode; color: string }> = {
    created: { icon: <Package size={14} />, color: 'bg-sky-100 text-sky-600 border-sky-200' },
    allocated: { icon: <CheckCircle size={14} />, color: 'bg-blue-100 text-blue-600 border-blue-200' },
    picked: { icon: <Package size={14} />, color: 'bg-indigo-100 text-indigo-600 border-indigo-200' },
    packed: { icon: <Package size={14} />, color: 'bg-violet-100 text-violet-600 border-violet-200' },
    shipped: { icon: <Truck size={14} />, color: 'bg-emerald-100 text-emerald-600 border-emerald-200' },
    delivered: { icon: <CheckCircle size={14} />, color: 'bg-green-100 text-green-600 border-green-200' },
    cancelled: { icon: <XCircle size={14} />, color: 'bg-red-100 text-red-600 border-red-200' },
    returned: { icon: <RefreshCw size={14} />, color: 'bg-amber-100 text-amber-600 border-amber-200' },
    payment: { icon: <CreditCard size={14} />, color: 'bg-emerald-100 text-emerald-600 border-emerald-200' },
    edited: { icon: <Edit3 size={14} />, color: 'bg-slate-100 text-slate-600 border-slate-200' },
    rto: { icon: <AlertTriangle size={14} />, color: 'bg-orange-100 text-orange-600 border-orange-200' },
  };
  return configs[type] || { icon: <Clock size={14} />, color: 'bg-slate-100 text-slate-500 border-slate-200' };
};

// Build timeline events from order data
function buildTimelineEvents(order: Order): TimelineEvent[] {
  const events: TimelineEvent[] = [];

  // Order created
  if (order.orderDate) {
    const config = getEventConfig('created');
    events.push({
      id: 'created',
      type: 'created',
      title: 'Order Created',
      description: `Order #${order.orderNumber} placed via ${order.channel || 'Shopify'}`,
      timestamp: new Date(order.orderDate),
      icon: config.icon,
      color: config.color,
    });
  }

  // Payment received (for prepaid)
  if (order.shopifyCache?.paymentMethod !== 'COD' && order.orderDate) {
    const config = getEventConfig('payment');
    events.push({
      id: 'payment',
      type: 'payment',
      title: 'Payment Received',
      description: 'Prepaid order confirmed',
      timestamp: new Date(new Date(order.orderDate).getTime() + 1000), // Just after creation
      icon: config.icon,
      color: config.color,
    });
  }

  // Shipped
  if (order.shippedAt) {
    const config = getEventConfig('shipped');
    events.push({
      id: 'shipped',
      type: 'shipped',
      title: 'Order Shipped',
      description: order.awbNumber ? `AWB: ${order.awbNumber} via ${order.courier || 'Courier'}` : 'Shipped',
      timestamp: new Date(order.shippedAt),
      icon: config.icon,
      color: config.color,
    });
  }

  // Delivered
  if (order.deliveredAt) {
    const config = getEventConfig('delivered');
    events.push({
      id: 'delivered',
      type: 'delivered',
      title: 'Order Delivered',
      description: 'Successfully delivered to customer',
      timestamp: new Date(order.deliveredAt),
      icon: config.icon,
      color: config.color,
    });
  }

  // RTO initiated
  if (order.rtoInitiatedAt) {
    const config = getEventConfig('rto');
    events.push({
      id: 'rto',
      type: 'rto',
      title: 'RTO Initiated',
      description: 'Return to origin process started',
      timestamp: new Date(order.rtoInitiatedAt),
      icon: config.icon,
      color: config.color,
    });
  }

  // Cancelled (use order date as fallback timestamp)
  if (order.status === 'cancelled' && order.orderDate) {
    const config = getEventConfig('cancelled');
    events.push({
      id: 'cancelled',
      type: 'cancelled',
      title: 'Order Cancelled',
      timestamp: new Date(order.orderDate),
      icon: config.icon,
      color: config.color,
    });
  }

  // Sort by timestamp ascending (chronological - oldest first)
  events.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());

  return events;
}

export function TimelineSection({ order }: TimelineSectionProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const events = buildTimelineEvents(order);

  if (events.length === 0) {
    return null;
  }

  const visibleEvents = isExpanded ? events : events.slice(0, 2);
  const hasMore = events.length > 2;

  return (
    <div className="bg-white rounded-xl border border-slate-200/80 overflow-hidden">
      <button
        type="button"
        onClick={() => setIsExpanded(!isExpanded)}
        className="w-full px-4 py-3 border-b border-slate-100 bg-gradient-to-r from-slate-50 to-white flex items-center justify-between"
      >
        <div className="flex items-center gap-2">
          <div className="p-1.5 bg-slate-100 rounded-lg">
            <Clock size={14} className="text-slate-500" />
          </div>
          <h3 className="text-sm font-semibold text-slate-700">Timeline</h3>
          <span className="px-2 py-0.5 bg-slate-100 text-slate-600 text-xs font-medium rounded-full">
            {events.length} events
          </span>
        </div>
        {hasMore && (
          isExpanded ? <ChevronUp size={16} className="text-slate-400" /> : <ChevronDown size={16} className="text-slate-400" />
        )}
      </button>

      <div className="p-4">
        <div className="relative">
          {/* Timeline line */}
          <div className="absolute left-[17px] top-2 bottom-2 w-px bg-gradient-to-b from-slate-200 via-slate-200 to-transparent" />

          {/* Events */}
          <div className="space-y-4">
            {visibleEvents.map((event) => (
              <div key={event.id} className="relative flex gap-3">
                {/* Icon */}
                <div className={`relative z-10 p-2 rounded-lg border ${event.color} shrink-0`}>
                  {event.icon}
                </div>

                {/* Content */}
                <div className="flex-1 min-w-0 pt-0.5">
                  <div className="flex items-center justify-between gap-2">
                    <h4 className="text-sm font-medium text-slate-800">{event.title}</h4>
                    <span className="text-xs text-slate-400 whitespace-nowrap">
                      {formatTimestamp(event.timestamp)}
                    </span>
                  </div>
                  {event.description && (
                    <p className="text-xs text-slate-500 mt-0.5">{event.description}</p>
                  )}
                </div>
              </div>
            ))}
          </div>

          {/* Show more/less */}
          {hasMore && !isExpanded && (
            <button
              type="button"
              onClick={() => setIsExpanded(true)}
              className="mt-3 ml-10 text-xs text-sky-600 hover:text-sky-700 font-medium"
            >
              Show {events.length - 2} more events
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
