/**
 * CustomerSearch - Shared component for searching and selecting customers
 *
 * A dropdown search component that queries the customers API and displays
 * matching results. Supports debounced search, loading states, and
 * customizable styling variants.
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
import { Search, User, Mail, Phone } from 'lucide-react';
import { customersApi } from '../../services/api';

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
  /** Visual variant - 'default' uses gray tones, 'slate' uses slate tones */
  variant?: 'default' | 'slate';
  /** Whether to show customer tags in results */
  showTags?: boolean;
  /** Placeholder text for the search input */
  placeholder?: string;
  /** Custom class name for the container */
  className?: string;
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
  variant = 'default',
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

  // Fetch customers with server-side search
  const { data: customersData, isLoading } = useQuery({
    queryKey: ['customers-search', debouncedQuery],
    queryFn: () => {
      const params: Record<string, string> = { limit: '50' };
      if (debouncedQuery.trim()) {
        params.search = debouncedQuery.trim();
      }
      return customersApi.getAll(params);
    },
    staleTime: 30 * 1000, // Cache for 30 seconds
  });

  // API returns array directly via axios .data
  const customers: Customer[] = customersData?.data || [];

  // Auto-focus the input on mount
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // Variant-specific styles
  const styles = {
    default: {
      container: 'border-gray-200 bg-white shadow-lg',
      header: 'border-gray-100',
      input: 'border-gray-200 bg-gray-50 focus:bg-white focus:border-blue-400 focus:ring-blue-100',
      inputIcon: 'text-gray-400',
      divider: 'divide-gray-50',
      resultItem: 'hover:bg-blue-50',
      resultName: 'text-gray-900',
      resultMeta: 'text-gray-500',
      metaIcon: 'text-gray-400',
      footer: 'border-gray-100 bg-gray-50',
      cancelBtn: 'text-gray-600 hover:text-gray-800 hover:bg-gray-200',
      countText: 'text-gray-400',
      emptyIcon: 'text-gray-300',
      emptyText: 'text-gray-500',
      emptyHint: 'text-gray-400',
      loadingSpinner: 'border-blue-500',
    },
    slate: {
      container: 'border-slate-200 bg-white shadow-xl',
      header: 'border-slate-100 bg-slate-50/50',
      input: 'border-slate-200 bg-white focus:border-sky-400 focus:ring-sky-100',
      inputIcon: 'text-slate-400',
      divider: 'divide-slate-50',
      resultItem: 'hover:bg-sky-50',
      resultName: 'text-slate-800',
      resultMeta: 'text-slate-500',
      metaIcon: 'text-slate-400',
      footer: 'border-slate-100 bg-slate-50/50',
      cancelBtn: 'text-slate-500 hover:text-slate-700',
      countText: 'text-slate-400',
      emptyIcon: 'text-slate-300',
      emptyText: 'text-slate-500',
      emptyHint: 'text-slate-400',
      loadingSpinner: 'border-sky-500',
    },
  };

  const s = styles[variant];

  return (
    <div className={`absolute z-50 w-full mt-1 border rounded-xl overflow-hidden ${s.container} ${className}`}>
      {/* Search Input */}
      <div className={`p-2 border-b ${s.header}`}>
        <div className="relative">
          <Search size={14} className={`absolute left-2.5 top-1/2 -translate-y-1/2 ${s.inputIcon}`} />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={placeholder}
            className={`w-full pl-8 pr-3 py-2 text-sm border rounded-lg focus:ring-1 outline-none transition-all ${s.input}`}
            autoComplete="off"
          />
        </div>
      </div>

      {/* Results */}
      <div className="max-h-48 overflow-y-auto">
        {isLoading ? (
          <div className="p-4 text-center">
            <div className={`animate-spin w-5 h-5 border-2 border-t-transparent rounded-full mx-auto mb-2 ${s.loadingSpinner}`} />
            <p className={`text-xs ${s.emptyText}`}>Searching...</p>
          </div>
        ) : customers.length === 0 ? (
          <div className="p-4 text-center">
            <User size={20} className={`mx-auto mb-1 ${s.emptyIcon}`} />
            <p className={`text-xs ${s.emptyText}`}>
              {query.trim() ? 'No customers found' : 'Type to search customers'}
            </p>
            <p className={`text-xs mt-1 ${s.emptyHint}`}>Or enter details for new customer</p>
          </div>
        ) : (
          <div className={`divide-y ${s.divider}`}>
            {customers.map((customer) => (
              <button
                key={customer.id}
                type="button"
                onClick={() => onSelect(customer)}
                className={`w-full px-3 py-2 flex items-start justify-between transition-colors text-left ${s.resultItem}`}
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className={`text-sm font-medium ${s.resultName}`}>
                      {getDisplayName(customer)}
                    </span>
                    {showTags && customer.tags && (
                      <span className="shrink-0 px-1.5 py-0.5 text-[10px] bg-purple-100 text-purple-600 rounded">
                        {Array.isArray(customer.tags) ? customer.tags[0] : customer.tags.split(',')[0]}
                      </span>
                    )}
                  </div>
                  <div className={`flex items-center gap-2 mt-0.5 text-xs ${s.resultMeta}`}>
                    {customer.email && (
                      <span className="flex items-center gap-1">
                        <Mail size={10} className={s.metaIcon} />
                        {customer.email}
                      </span>
                    )}
                    {customer.phone && (
                      <>
                        <span className="text-gray-300">·</span>
                        <span className="flex items-center gap-1">
                          <Phone size={10} className={s.metaIcon} />
                          {customer.phone}
                        </span>
                      </>
                    )}
                  </div>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Footer */}
      <div className={`px-3 py-2 border-t flex items-center justify-between ${s.footer}`}>
        <span className={`text-xs ${s.countText}`}>
          {customers.length} customer{customers.length !== 1 ? 's' : ''}{customers.length >= 50 ? '+' : ''}
        </span>
        <button
          type="button"
          onClick={onCancel}
          className={`px-2 py-1 text-xs rounded transition-colors ${s.cancelBtn}`}
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

export default CustomerSearch;
