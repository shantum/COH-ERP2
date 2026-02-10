import { Outlet, Link, useNavigate, useRouterState } from '@tanstack/react-router';
import { useAuth } from '../hooks/useAuth';
import {
    LayoutDashboard, ShoppingCart,
    Users, RotateCcw, Factory, LogOut, Menu, X, BookOpen, Settings, ClipboardCheck, PackagePlus, Clipboard, BarChart3, UserCog, ChevronLeft, ChevronRight, Search, Package, PackageX, ChevronDown, Minimize2, Maximize2, Calculator, Truck, Store, RefreshCcw, FileSpreadsheet, FilePlus, ShoppingBag, HeartPulse
} from 'lucide-react';
import { usePermissions } from '../hooks/usePermissions';
import { useAccess, type AccessFeature } from '../hooks/useAccess';
import { useState, useEffect, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useServerFn } from '@tanstack/react-start';
import { getSidebarOrder } from '../server/functions/admin';
import type { LucideIcon } from 'lucide-react';
import { useDocumentTitle } from '../hooks/useDocumentTitle';
import { Breadcrumbs } from './ui/Breadcrumbs';
import { LiveIndicator } from './ui/LiveIndicator';
import { useCompactMode } from '../hooks/useCompactMode';

// Navigation structure with groups
interface NavItem {
    to: string;
    icon: LucideIcon;
    label: string;
    permission?: string;  // Legacy permission key
    access?: AccessFeature;  // New simplified access feature
}

interface NavGroup {
    label: string;
    items: NavItem[];
    collapsible?: boolean;
}

const navGroups: NavGroup[] = [
    {
        label: '',
        items: [
            { to: '/', icon: LayoutDashboard, label: 'Dashboard' },
            { to: '/order-search', icon: Search, label: 'Search' },
        ],
    },
    {
        label: 'Orders',
        items: [
            { to: '/orders', icon: ShoppingCart, label: 'Orders' },
            { to: '/new-order', icon: FilePlus, label: 'New Order' },
        ],
    },
    {
        label: 'Catalog',
        items: [
            { to: '/products', icon: Package, label: 'Products' },
            { to: '/shopify-catalog', icon: ShoppingBag, label: 'Shopify Catalog' },
            { to: '/facebook-feed-health', icon: HeartPulse, label: 'Feed Health' },
            { to: '/inventory', icon: Package, label: 'Inventory' },
            { to: '/inventory-mobile', icon: Package, label: 'Stock (Mobile)' },
        ],
    },
    {
        label: 'Shipping & Returns',
        collapsible: true,
        items: [
            { to: '/tracking', icon: Truck, label: 'Track Shipment' },
            { to: '/returns', icon: RotateCcw, label: 'Returns' },
            { to: '/returns-rto', icon: PackageX, label: 'RTO Inward' },
            { to: '/return-prime', icon: RefreshCcw, label: 'Return Prime' },
        ],
    },
    {
        label: 'Operations',
        items: [
            { to: '/production', icon: Factory, label: 'Production Plan' },
            { to: '/inventory-inward', icon: PackagePlus, label: 'Inventory Inward' },
            { to: '/fabric-receipt', icon: PackagePlus, label: 'Fabric Receipt' },
        ],
    },
    {
        label: 'Counts',
        collapsible: true,
        items: [
            { to: '/fabric-reconciliation', icon: ClipboardCheck, label: 'Fabric Count' },
            { to: '/inventory-count', icon: Clipboard, label: 'Inventory Count' },
        ],
    },
    {
        label: 'Reports',
        collapsible: true,
        items: [
            { to: '/customers', icon: Users, label: 'Customers' },
            { to: '/ledgers', icon: BookOpen, label: 'Ledgers' },
            { to: '/channels', icon: Store, label: 'Marketplaces' },
            { to: '/analytics', icon: BarChart3, label: 'Analytics', access: 'view-analytics' },
            { to: '/costing', icon: Calculator, label: 'Costing', access: 'costing-dashboard' },
            { to: '/stock-report', icon: Package, label: 'Stock Report' },
        ],
    },
    {
        label: 'Admin',
        collapsible: true,
        items: [
            { to: '/sheets-monitor', icon: FileSpreadsheet, label: 'Sheets', access: 'manage-users' },
            { to: '/settings', icon: Settings, label: 'Settings' },
            { to: '/users', icon: UserCog, label: 'Users', access: 'manage-users' },
        ],
    },
];

export default function Layout() {
    const { user, logout } = useAuth();
    const { hasPermission, isOwner } = usePermissions();
    const { hasAccess } = useAccess();
    const navigate = useNavigate();
    const routerState = useRouterState();
    const location = routerState.location;
    const { isCompact: isCompactMode, toggle: toggleCompactMode } = useCompactMode();

    // Auto-update document title based on current route
    useDocumentTitle();
    const [sidebarOpen, setSidebarOpen] = useState(false);
    const [collapsed, setCollapsed] = useState(() => {
        if (typeof window === 'undefined') return false;
        return localStorage.getItem('sidebar-collapsed') === 'true';
    });
    const [isHovering, setIsHovering] = useState(false);
    const [collapsedGroups, setCollapsedGroups] = useState<Record<string, boolean>>(() => {
        if (typeof window === 'undefined') return {};
        const saved = localStorage.getItem('sidebar-collapsed-groups');
        return saved ? JSON.parse(saved) : {};
    });

    // Fetch admin-configured sidebar order (client-only to avoid SSR 401)
    const getSidebarOrderFn = useServerFn(getSidebarOrder);
    const { data: sidebarOrder } = useQuery({
        queryKey: ['sidebarOrder'],
        queryFn: async () => {
            const result = await getSidebarOrderFn();
            if (!result.success) {
                return null;
            }
            return result.data;
        },
        staleTime: 5 * 60 * 1000, // Cache for 5 minutes
        enabled: typeof window !== 'undefined', // Skip during SSR
    });

    // Reorder navGroups based on saved order
    const orderedNavGroups = useMemo(() => {
        if (!sidebarOrder) return navGroups;

        // Create a map for quick lookup
        const groupMap = new Map(navGroups.map(g => [g.label, g]));

        // Build ordered array
        const ordered: NavGroup[] = [];
        for (const label of sidebarOrder) {
            const group = groupMap.get(label);
            if (group) {
                ordered.push(group);
                groupMap.delete(label);
            }
        }

        // Add any remaining groups not in the saved order
        for (const group of groupMap.values()) {
            ordered.push(group);
        }

        return ordered;
    }, [sidebarOrder]);

    useEffect(() => {
        localStorage.setItem('sidebar-collapsed', String(collapsed));
    }, [collapsed]);

    useEffect(() => {
        localStorage.setItem('sidebar-collapsed-groups', JSON.stringify(collapsedGroups));
    }, [collapsedGroups]);

    const handleLogout = () => {
        logout();
        navigate({ to: '/login' });
    };

    const toggleCollapsed = () => {
        setCollapsed(!collapsed);
    };

    const toggleGroup = (label: string) => {
        setCollapsedGroups(prev => ({
            ...prev,
            [label]: !prev[label]
        }));
    };

    // Check if any item in a group is active
    const isGroupActive = (items: NavItem[]) => {
        return items.some(item => location.pathname === item.to);
    };

    // Filter items based on access and permissions
    const filterItems = (items: NavItem[]) => {
        return items.filter(item => {
            // Check new access system first
            if (item.access) {
                return hasAccess(item.access);
            }
            // Legacy permission check
            if (!item.permission) return true;
            // Special case: 'admin' means owner/admin only
            if (item.permission === 'admin') return isOwner;
            return hasPermission(item.permission);
        });
    };

    const isCompact = collapsed && !isHovering;

    return (
        <div className="min-h-screen bg-gray-50">
            {/* Mobile menu button */}
            <div className="lg:hidden fixed top-4 left-4 z-50">
                <button onClick={() => setSidebarOpen(!sidebarOpen)} className="p-2 rounded-lg bg-white shadow-md">
                    {sidebarOpen ? <X size={24} /> : <Menu size={24} />}
                </button>
            </div>

            {/* Sidebar */}
            <aside
                className={`fixed inset-y-0 left-0 z-40 bg-white border-r border-gray-200 transform transition-all duration-200 ease-in-out ${
                    sidebarOpen ? 'translate-x-0' : '-translate-x-full'
                } lg:translate-x-0 ${
                    isCompact ? 'lg:w-16' : 'w-56 lg:w-56'
                }`}
                onMouseEnter={() => collapsed && setIsHovering(true)}
                onMouseLeave={() => setIsHovering(false)}
            >
                <div className="flex flex-col h-full">
                    {/* Logo */}
                    <div className={`flex items-center h-14 border-b border-gray-200 transition-all duration-200 ${
                        isCompact ? 'px-3 justify-center' : 'px-4'
                    }`}>
                        <span className="text-xl font-bold text-brand-charcoal">COH</span>
                        {!isCompact && <span className="ml-2 text-sm text-gray-500">ERP</span>}
                    </div>

                    {/* Navigation */}
                    <nav className={`flex-1 py-2 overflow-y-auto ${isCompact ? 'px-2' : 'px-2'}`}>
                        {orderedNavGroups.map((group, groupIndex) => {
                            const filteredItems = filterItems(group.items);
                            if (filteredItems.length === 0) return null;

                            const groupActive = isGroupActive(filteredItems);
                            const isCollapsed = group.collapsible && collapsedGroups[group.label] && !groupActive;

                            return (
                                <div key={group.label || groupIndex} className={groupIndex > 0 ? 'mt-1' : ''}>
                                    {/* Group header */}
                                    {group.label && !isCompact && (
                                        <div
                                            className={`flex items-center justify-between px-2 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-gray-400 ${
                                                group.collapsible ? 'cursor-pointer hover:text-gray-600' : ''
                                            }`}
                                            onClick={() => group.collapsible && toggleGroup(group.label)}
                                        >
                                            <span>{group.label}</span>
                                            {group.collapsible && (
                                                <ChevronDown
                                                    size={12}
                                                    className={`transition-transform ${isCollapsed ? '-rotate-90' : ''}`}
                                                />
                                            )}
                                        </div>
                                    )}

                                    {/* Group items */}
                                    {!isCollapsed && (
                                        <div className="space-y-0.5">
                                            {filteredItems.map((item) => {
                                                // Parse URL to separate path and search params
                                                const [path, queryString] = item.to.split('?');
                                                const searchParams = queryString
                                                    ? Object.fromEntries(new URLSearchParams(queryString))
                                                    : undefined;

                                                // Check if this link is active
                                                const isActive = location.pathname === path ||
                                                    (path !== '/' && location.pathname.startsWith(path));

                                                return (
                                                    <Link
                                                        key={item.to}
                                                        to={path as '/'}
                                                        search={searchParams as Record<string, string>}
                                                        onClick={() => setSidebarOpen(false)}
                                                        className={`flex items-center rounded-md text-sm transition-all duration-150 ${
                                                            isCompact
                                                                ? 'px-3 py-2 justify-center'
                                                                : 'px-2.5 py-1.5'
                                                        } ${isActive
                                                            ? 'bg-primary-50 text-primary-700 font-medium'
                                                            : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900'
                                                        }`}
                                                        title={isCompact ? item.label : undefined}
                                                    >
                                                        <item.icon size={18} className={isCompact ? '' : 'mr-2.5 flex-shrink-0'} />
                                                        {!isCompact && <span className="truncate">{item.label}</span>}
                                                    </Link>
                                                );
                                            })}
                                        </div>
                                    )}

                                    {/* Collapsed group indicator */}
                                    {isCollapsed && !isCompact && (
                                        <div
                                            className="px-2.5 py-1 text-xs text-gray-400 cursor-pointer hover:text-gray-600"
                                            onClick={() => toggleGroup(group.label)}
                                        >
                                            {filteredItems.length} items hidden
                                        </div>
                                    )}
                                </div>
                            );
                        })}
                    </nav>

                    {/* Toggle button - Desktop only */}
                    <div className="hidden lg:block border-t border-gray-200">
                        <button
                            onClick={(e) => {
                                e.stopPropagation();
                                toggleCollapsed();
                            }}
                            className="w-full p-2.5 text-gray-400 hover:text-gray-600 hover:bg-gray-50 transition-colors flex items-center justify-center gap-2"
                            title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
                        >
                            {isCompact ? (
                                <ChevronRight size={18} />
                            ) : (
                                <>
                                    <ChevronLeft size={16} />
                                    <span className="text-xs">Collapse</span>
                                </>
                            )}
                        </button>
                    </div>

                    {/* User */}
                    <div className={`p-2.5 border-t border-gray-200 ${isCompact ? 'px-2' : ''}`}>
                        <div className={`flex items-center ${isCompact ? 'justify-center' : 'justify-between'}`}>
                            {isCompact ? (
                                <button
                                    onClick={handleLogout}
                                    className="p-2 text-gray-400 hover:text-gray-600 rounded-lg hover:bg-gray-100"
                                    title="Logout"
                                >
                                    <LogOut size={18} />
                                </button>
                            ) : (
                                <>
                                    <div className="min-w-0">
                                        <p className="text-sm font-medium text-gray-900 truncate">{user?.name}</p>
                                        <p className="text-xs text-gray-500 truncate">{user?.role}</p>
                                    </div>
                                    <button
                                        onClick={handleLogout}
                                        className="p-1.5 text-gray-400 hover:text-gray-600 rounded-lg hover:bg-gray-100 flex-shrink-0"
                                        title="Logout"
                                    >
                                        <LogOut size={18} />
                                    </button>
                                </>
                            )}
                        </div>
                    </div>
                </div>
            </aside>

            {/* Main content */}
            <main className={`transition-all duration-200 ${
                collapsed ? 'lg:pl-16' : 'lg:pl-56'
            }`}>
                <div className="p-4 md:p-6 lg:p-8">
                    {/* Top bar with live indicator and compact mode toggle */}
                    <div className="flex items-center justify-between mb-2">
                        <Breadcrumbs />
                        <div className="flex items-center gap-2">
                            <LiveIndicator />
                            <button
                                onClick={toggleCompactMode}
                                className="p-1.5 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg transition-colors flex items-center gap-1.5"
                                title={isCompactMode ? 'Switch to normal density' : 'Switch to compact density'}
                            >
                                {isCompactMode ? <Maximize2 size={16} /> : <Minimize2 size={16} />}
                                <span className="text-xs hidden sm:inline">{isCompactMode ? 'Normal' : 'Compact'}</span>
                            </button>
                        </div>
                    </div>
                    <Outlet />
                </div>
            </main>

            {/* Overlay for mobile */}
            {sidebarOpen && (
                <div className="fixed inset-0 bg-black/50 z-30 lg:hidden" onClick={() => setSidebarOpen(false)} />
            )}
        </div>
    );
}
