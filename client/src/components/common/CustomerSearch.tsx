/**
 * CustomerSearch - Shared component for searching and selecting customers
 *
 * A dropdown search component that queries the customers API and displays
 * matching results. Also supports searching by order number.
 *
 * Usage:
 * ```tsx
 * <CustomerSearch
 *   onSelect={(customer) => handleSelectCustomer(customer)}
 *   onCancel={() => setIsSearching(false)}
 *   initialQuery="John"
 *   variant="default"
 * />
 * ```
 */

import { useState, useEffect, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useServerFn } from '@tanstack/react-start';
import { Search, User, Mail, Phone, Package } from 'lucide-react';
import { searchCustomers } from '../../server/functions/customers';
import { searchAllOrders } from '../../server/functions/orders';

export interface Customer {
  id: string;
  firstName?: string;
  lastName?: string;
  email?: string;
  phone?: string;
  tags?: string | string[];
}

export interface CustomerSearchProps {
  /** Called when a customer is selected */
  onSelect: (customer: Customer) => void;
  /** Called when the search is cancelled */
  onCancel: () => void;
  /** Initial search query value */
  initialQuery?: string;
  /** Whether to show customer tags in results */
  showTags?: boolean;
  /** Placeholder text for the search input */
  placeholder?: string;
  /** Custom class name for the container */
  className?: string;
  /** Visual variant for styling */
  variant?: 'default' | 'slate';
}

/**
 * Get display name for a customer
 */
function getDisplayName(customer: Customer): string {
  const firstName = customer.firstName || '';
  const lastName = customer.lastName || '';
  if (firstName || lastName) {
    return `${firstName} ${lastName}`.trim();
  }
  return customer.email?.split('@')[0] || 'Unknown';
}

export function CustomerSearch({
  onSelect,
  onCancel,
  initialQuery = '',
  showTags = false,
  placeholder = 'Search by name, email, or phone...',
  className = '',
}: CustomerSearchProps) {
  const [query, setQuery] = useState(initialQuery);
  const [debouncedQuery, setDebouncedQuery] = useState(initialQuery);
  const inputRef = useRef<HTMLInputElement>(null);

  // Debounce search query to avoid too many API calls
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedQuery(query);
    }, 300);
    return () => clearTimeout(timer);
  }, [query]);

  // Server Functions
  const searchCustomersFn = useServerFn(searchCustomers);
  const searchAllOrdersFn = useServerFn(searchAllOrders);

  // Check if query looks like an order number
  const isOrderNumberQuery = (q: string) => {
    const trimmed = q.trim().toUpperCase();
    return trimmed.startsWith('#') ||
           trimmed.startsWith('COH-') ||
           trimmed.startsWith('EXC-') ||
           /^\d{5,}$/.test(trimmed); // 5+ digit number
  };

  // Fetch customers with server-side search
  const { data: customersData, isLoading: isLoadingCustomers } = useQuery({
    queryKey: ['customers-search', debouncedQuery],
    queryFn: () => searchCustomersFn({
      data: {
        search: debouncedQuery.trim() || undefined,
        limit: 50,
      },
    }),
    staleTime: 30 * 1000,
  });

  // Fetch orders when query looks like an order number
  const { data: ordersData, isLoading: isLoadingOrders } = useQuery({
    queryKey: ['orders-search', debouncedQuery],
    queryFn: () => searchAllOrdersFn({
      data: {
        q: debouncedQuery.trim().replace('#', ''),
        limit: 10,
      },
    }),
    enabled: !!debouncedQuery.trim() && isOrderNumberQuery(debouncedQuery),
    staleTime: 30 * 1000,
  });

  const isLoading = isLoadingCustomers || isLoadingOrders;

  // Map Server Function response to Customer type
  const customers: Customer[] = (customersData || []).map((c) => ({
    id: c.id,
    firstName: c.firstName ?? undefined,
    lastName: c.lastName ?? undefined,
    email: c.email ?? undefined,
    phone: c.phone ?? undefined,
    tags: c.tags ?? undefined,
  }));

  // Extract customers from order results
  // Server Function returns { results: TabResult[] } where each TabResult has { orders: SearchResultOrder[] }
  const allOrders = ordersData?.results?.flatMap((tab) => tab.orders) || [];
  const orderCustomers: (Customer & { orderNumber?: string })[] = allOrders
    .filter((order: { customerName: string | null }) => order.customerName)
    .map((order: { id: string; orderNumber: string; customerName: string | null }) => ({
      id: `order-${order.id}`,
      firstName: order.customerName?.split(' ')[0] || '',
      lastName: order.customerName?.split(' ').slice(1).join(' ') || '',
      email: '',
      phone: '',
      orderNumber: order.orderNumber,
    }))
    // Remove duplicates by name
    .filter((c, i, arr) =>
      arr.findIndex((x) =>
        (x.firstName === c.firstName && x.lastName === c.lastName)) === i
    );

  // Auto-focus the input on mount
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  return (
    <div className={`absolute z-50 w-full mt-1 border border-border rounded-md overflow-hidden bg-popover text-popover-foreground shadow-md ${className}`}>
      {/* Search Input */}
      <div className="p-2 border-b border-border">
        <div className="relative">
          <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={placeholder}
            className="w-full h-9 pl-8 pr-3 text-sm border border-input rounded-md bg-transparent focus:outline-none focus:ring-1 focus:ring-ring transition-colors"
            autoComplete="off"
          />
        </div>
      </div>

      {/* Results */}
      <div className="max-h-56 overflow-y-auto">
        {isLoading ? (
          <div className="p-4 text-center">
            <div className="animate-spin w-5 h-5 border-2 border-primary border-t-transparent rounded-full mx-auto mb-2" />
            <p className="text-xs text-muted-foreground">Searching...</p>
          </div>
        ) : customers.length === 0 && orderCustomers.length === 0 ? (
          <div className="p-4 text-center">
            <User size={20} className="mx-auto mb-1 text-muted-foreground/50" />
            <p className="text-xs text-muted-foreground">
              {query.trim() ? 'No customers found' : 'Search by name, email, phone, or order #'}
            </p>
            <p className="text-xs mt-1 text-muted-foreground/70">Or enter details for new customer</p>
          </div>
        ) : (
          <div className="divide-y divide-border">
            {/* Order-based results */}
            {orderCustomers.length > 0 && (
              <>
                <div className="px-3 py-1.5 bg-muted/50 text-[10px] font-medium text-muted-foreground uppercase tracking-wide flex items-center gap-1.5">
                  <Package size={10} />
                  From Orders
                </div>
                {orderCustomers.map((customer) => (
                  <button
                    key={`order-${customer.id}`}
                    type="button"
                    onClick={() => onSelect(customer)}
                    className="w-full px-3 py-2 flex items-start justify-between transition-colors text-left hover:bg-accent"
                  >
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium">
                          {getDisplayName(customer)}
                        </span>
                        {customer.orderNumber && (
                          <span className="shrink-0 px-1.5 py-0.5 text-[10px] bg-blue-100 text-blue-600 rounded">
                            {customer.orderNumber}
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-2 mt-0.5 text-xs text-muted-foreground">
                        {customer.email && (
                          <span className="flex items-center gap-1">
                            <Mail size={10} />
                            {customer.email}
                          </span>
                        )}
                        {customer.phone && (
                          <>
                            <span className="opacity-50">·</span>
                            <span className="flex items-center gap-1">
                              <Phone size={10} />
                              {customer.phone}
                            </span>
                          </>
                        )}
                      </div>
                    </div>
                  </button>
                ))}
              </>
            )}
            {/* Customer results */}
            {customers.length > 0 && (
              <>
                {orderCustomers.length > 0 && (
                  <div className="px-3 py-1.5 bg-muted/50 text-[10px] font-medium text-muted-foreground uppercase tracking-wide flex items-center gap-1.5">
                    <User size={10} />
                    Customers
                  </div>
                )}
                {customers.map((customer) => (
                  <button
                    key={customer.id}
                    type="button"
                    onClick={() => onSelect(customer)}
                    className="w-full px-3 py-2 flex items-start justify-between transition-colors text-left hover:bg-accent"
                  >
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium">
                          {getDisplayName(customer)}
                        </span>
                        {showTags && customer.tags && (
                          <span className="shrink-0 px-1.5 py-0.5 text-[10px] bg-purple-100 text-purple-600 rounded">
                            {Array.isArray(customer.tags) ? customer.tags[0] : customer.tags.split(',')[0]}
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-2 mt-0.5 text-xs text-muted-foreground">
                        {customer.email && (
                          <span className="flex items-center gap-1">
                            <Mail size={10} />
                            {customer.email}
                          </span>
                        )}
                        {customer.phone && (
                          <>
                            <span className="opacity-50">·</span>
                            <span className="flex items-center gap-1">
                              <Phone size={10} />
                              {customer.phone}
                            </span>
                          </>
                        )}
                      </div>
                    </div>
                  </button>
                ))}
              </>
            )}
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="px-3 py-2 border-t border-border flex items-center justify-between bg-muted/50">
        <span className="text-xs text-muted-foreground">
          {customers.length + orderCustomers.length} result{(customers.length + orderCustomers.length) !== 1 ? 's' : ''}
        </span>
        <button
          type="button"
          onClick={onCancel}
          className="px-2 py-1 text-xs rounded-md text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

export default CustomerSearch;
