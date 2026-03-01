import { Outlet, Link, useNavigate, useRouterState } from '@tanstack/react-router';
import { useAuth } from '../hooks/useAuth';
import { isAdminUser } from '../types';
import {
    LayoutDashboard, ShoppingCart,
    Users, RotateCcw, Factory, LogOut, Menu, X, BookOpen, Settings, PackagePlus, Clipboard, BarChart3, UserCog, ChevronLeft, ChevronRight, Search, Package, PackageX, ChevronDown, Minimize2, Maximize2, Calculator, Truck, Store, FileSpreadsheet, FilePlus, ShoppingBag, HeartPulse, Upload, IndianRupee, Layers, Sliders, TrendingUp, ClipboardList
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
import { ChatButton } from './ChatAgent';

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
            { to: '/business', icon: HeartPulse, label: 'Business Pulse' },
            { to: '/order-search', icon: Search, label: 'Search' },
        ],
    },
    {
        label: 'Orders',
        items: [
            { to: '/orders', icon: ShoppingCart, label: 'Orders' },
            { to: '/quick-order', icon: FilePlus, label: 'Quick Order' },
            { to: '/channel-import', icon: Upload, label: 'Channel Import', permission: 'admin' },
        ],
    },
    {
        label: 'Catalog',
        items: [
            { to: '/products', icon: Package, label: 'Products' },
            { to: '/fabrics', icon: Layers, label: 'Fabrics' },
            { to: '/bom', icon: ClipboardList, label: 'Bill of Materials' },
            { to: '/shopify-catalog', icon: ShoppingBag, label: 'Shopify Catalog' },
            { to: '/facebook-feed-health', icon: HeartPulse, label: 'Feed Health', permission: 'admin' as const },
            { to: '/inventory', icon: Package, label: 'Inventory' },
        ],
    },
    {
        label: 'Shipping & Returns',
        collapsible: true,
        items: [
            { to: '/tracking', icon: Truck, label: 'Track Shipment' },
            { to: '/returns', icon: RotateCcw, label: 'Returns' },
            { to: '/returns-rto', icon: PackageX, label: 'RTO Inward' },
        ],
    },
    {
        label: 'Operations',
        items: [
            { to: '/production', icon: Factory, label: 'Production Plan' },
            { to: '/tailor-performance', icon: Users, label: 'Tailor Performance' },
            { to: '/inventory-inward', icon: PackagePlus, label: 'Inventory Inward' },
            { to: '/inventory-adjustments', icon: Sliders, label: 'Adjustments' },
        ],
    },
    {
        label: 'Finance',
        collapsible: true,
        items: [
            { to: '/finance', icon: IndianRupee, label: 'Finance' },
            { to: '/payroll', icon: Calculator, label: 'Payroll' },
        ],
    },
    {
        label: 'Counts',
        collapsible: true,
        items: [
            { to: '/inventory-count', icon: Clipboard, label: 'Inventory Count' },
            { to: '/fabric-count', icon: ClipboardList, label: 'Fabric Count' },
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
            { to: '/demand-forecast', icon: TrendingUp, label: 'Demand Forecast', access: 'manage-users' },
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
    const { hasPermission } = usePermissions();
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
        if (saved) {
            try { return JSON.parse(saved); } catch { /* ignore */ }
        }
        return {};
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

    // Restricted user: only sees fabric-count, no sidebar
    const isRestricted = user?.email === 'prabhakar@coh.one';
    if (isRestricted) {
        return (
            <div className="min-h-screen bg-warm-50">
                <div className="flex items-center justify-between px-4 h-14 bg-white border-b border-warm-300">
                    <div className="flex items-center gap-2">
                        <span className="font-display text-lg font-bold text-warm-900 tracking-tight">COH</span>
                        <span className="text-xs font-medium text-warm-600 uppercase tracking-widest">ERP</span>
                    </div>
                    <div className="flex items-center gap-3">
                        <span className="text-sm text-warm-800">{user?.name}</span>
                        <button
                            onClick={() => { logout(); navigate({ to: '/login' }); }}
                            className="p-1.5 text-warm-600 hover:text-warm-800 rounded-lg hover:bg-warm-200/50"
                            title="Logout"
                        >
                            <LogOut size={18} />
                        </button>
                    </div>
                </div>
                <div className="p-4 md:p-6 lg:p-8">
                    <Outlet />
                </div>
            </div>
        );
    }

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
            // Special case: 'admin' means admin-equivalent access
            if (item.permission === 'admin') return isAdminUser(user);
            return hasPermission(item.permission);
        });
    };

    const isCompact = collapsed && !isHovering;

    // Generate user initials for avatar
    const userInitials = user?.name
        ? user.name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2)
        : '?';

    return (
        <div className="min-h-screen bg-warm-50">
            {/* Sidebar */}
            <aside
                className={`fixed inset-y-0 left-0 z-40 bg-warm-100 border-r border-warm-300 transform transition-all duration-200 ease-in-out ${
                    sidebarOpen ? 'translate-x-0' : '-translate-x-full'
                } lg:translate-x-0 ${
                    isCompact ? 'lg:w-16' : 'w-56 lg:w-56'
                }`}
                onMouseEnter={() => collapsed && setIsHovering(true)}
                onMouseLeave={() => setIsHovering(false)}
            >
                <div className="flex flex-col h-full">
                    {/* Brand */}
                    <div className={`flex items-center h-14 transition-all duration-200 ${
                        isCompact ? 'px-3 justify-center' : 'px-5'
                    }`}>
                        {isCompact ? (
                            <span className="font-display text-lg font-bold text-warm-900 tracking-tight">C</span>
                        ) : (
                            <>
                                <span className="font-display text-[22px] font-bold text-warm-900 tracking-tight">COH</span>
                                <span className="ml-2 text-xs font-medium text-warm-600 uppercase tracking-widest">ERP</span>
                                {/* Close button - mobile only */}
                                <button
                                    onClick={() => setSidebarOpen(false)}
                                    className="ml-auto p-1.5 rounded-lg bg-warm-200 text-warm-800 lg:hidden"
                                >
                                    <X size={16} />
                                </button>
                            </>
                        )}
                    </div>

                    {/* Navigation */}
                    <nav className={`flex-1 py-2 overflow-y-auto ${isCompact ? 'px-2' : 'px-3'}`}>
                        {orderedNavGroups.map((group, groupIndex) => {
                            const filteredItems = filterItems(group.items);
                            if (filteredItems.length === 0) return null;

                            const groupActive = isGroupActive(filteredItems);
                            const isGroupCollapsed = group.collapsible && collapsedGroups[group.label] && !groupActive;

                            return (
                                <div key={group.label || groupIndex}>
                                    {/* Divider before first labelled group */}
                                    {groupIndex === 1 && (
                                        <div className="h-px bg-warm-300 mx-1 my-2" />
                                    )}

                                    {/* Group header */}
                                    {group.label && !isCompact && (
                                        <div
                                            className={`flex items-center justify-between px-3 py-1.5 mt-1 text-[10px] font-semibold uppercase tracking-[0.1em] text-warm-500 ${
                                                group.collapsible ? 'cursor-pointer hover:text-warm-800' : ''
                                            }`}
                                            onClick={() => group.collapsible && toggleGroup(group.label)}
                                        >
                                            <span>{group.label}</span>
                                            {group.collapsible && (
                                                <ChevronDown
                                                    size={12}
                                                    className={`transition-transform ${isGroupCollapsed ? '-rotate-90' : ''}`}
                                                />
                                            )}
                                        </div>
                                    )}

                                    {/* Compact mode: divider between groups */}
                                    {isCompact && groupIndex > 0 && group.label && (
                                        <div className="h-px bg-warm-300 mx-2 my-2" />
                                    )}

                                    {/* Group items */}
                                    {!isGroupCollapsed && (
                                        <div className="space-y-0.5">
                                            {filteredItems.map((item) => {
                                                const [path, queryString] = item.to.split('?');
                                                const searchParams = queryString
                                                    ? Object.fromEntries(new URLSearchParams(queryString))
                                                    : undefined;

                                                const isActive = location.pathname === path ||
                                                    (path !== '/' && location.pathname.startsWith(path));

                                                return (
                                                    <Link
                                                        key={item.to}
                                                        to={path as '/'}
                                                        search={searchParams as Record<string, string>}
                                                        onClick={() => setSidebarOpen(false)}
                                                        className={`flex items-center rounded-lg text-[13px] transition-all duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-warm-accent ${
                                                            isCompact
                                                                ? 'px-3 py-2 justify-center'
                                                                : 'px-3 py-2 gap-2.5'
                                                        } ${isActive
                                                            ? 'bg-warm-200 text-warm-900 font-semibold'
                                                            : 'text-warm-800 hover:bg-warm-200/50 hover:text-warm-900'
                                                        }`}
                                                        title={isCompact ? item.label : undefined}
                                                    >
                                                        <item.icon size={18} className={`flex-shrink-0 ${isActive ? 'text-warm-900' : 'text-warm-700'}`} />
                                                        {!isCompact && <span className="truncate">{item.label}</span>}
                                                    </Link>
                                                );
                                            })}
                                        </div>
                                    )}

                                    {/* Collapsed group indicator */}
                                    {isGroupCollapsed && !isCompact && (
                                        <div
                                            className="px-3 py-1 text-xs text-warm-500 cursor-pointer hover:text-warm-800"
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
                    <div className="hidden lg:block border-t border-warm-300">
                        <button
                            onClick={(e) => {
                                e.stopPropagation();
                                toggleCollapsed();
                            }}
                            className="w-full p-2.5 text-warm-600 hover:text-warm-800 hover:bg-warm-200/50 transition-colors flex items-center justify-center gap-2"
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
                    <div className={`p-2.5 border-t border-warm-300 ${isCompact ? 'px-2' : ''}`}>
                        <div className={`flex items-center ${isCompact ? 'justify-center' : 'gap-3'}`}>
                            {isCompact ? (
                                <div
                                    className="w-8 h-8 rounded-full bg-warm-accent flex items-center justify-center cursor-pointer"
                                    onClick={handleLogout}
                                    title="Logout"
                                >
                                    <span className="text-xs font-semibold text-white">{userInitials}</span>
                                </div>
                            ) : (
                                <>
                                    <div className="w-8 h-8 rounded-full bg-warm-accent flex items-center justify-center flex-shrink-0">
                                        <span className="text-xs font-semibold text-white">{userInitials}</span>
                                    </div>
                                    <div className="min-w-0 flex-1">
                                        <p className="text-sm font-medium text-warm-900 truncate">{user?.name}</p>
                                        <p className="text-xs text-warm-600 truncate">{user?.role}</p>
                                    </div>
                                    <button
                                        onClick={handleLogout}
                                        className="p-1.5 text-warm-600 hover:text-warm-800 rounded-lg hover:bg-warm-200/50 flex-shrink-0"
                                        title="Logout"
                                    >
                                        <LogOut size={16} />
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
                {/* Top bar */}
                <div className="flex items-center justify-between px-4 md:px-6 lg:px-8 h-14 bg-white border-b border-warm-300 sticky top-0 z-20">
                    {/* Mobile hamburger + breadcrumbs */}
                    <div className="flex items-center gap-3">
                        <button
                            onClick={() => setSidebarOpen(!sidebarOpen)}
                            className="lg:hidden p-1.5 rounded-lg text-warm-800 hover:bg-warm-200/50"
                        >
                            <Menu size={20} />
                        </button>
                        <Breadcrumbs />
                    </div>
                    <div className="flex items-center gap-3">
                        <LiveIndicator />
                        <button
                            onClick={toggleCompactMode}
                            className="p-1.5 text-warm-600 hover:text-warm-800 hover:bg-warm-200/50 rounded-lg transition-colors flex items-center gap-1.5"
                            title={isCompactMode ? 'Switch to normal density' : 'Switch to compact density'}
                        >
                            {isCompactMode ? <Maximize2 size={16} /> : <Minimize2 size={16} />}
                            <span className="text-xs hidden sm:inline">{isCompactMode ? 'Normal' : 'Compact'}</span>
                        </button>
                    </div>
                </div>
                {/* Page content */}
                <div className="p-4 md:p-6 lg:p-8">
                    <Outlet />
                </div>
            </main>

            {/* AI Chat Assistant (admin only) */}
            {isAdminUser(user) && <ChatButton />}

            {/* Overlay for mobile */}
            {sidebarOpen && (
                <div className="fixed inset-0 bg-black/35 z-30 lg:hidden" onClick={() => setSidebarOpen(false)} />
            )}
        </div>
    );
}
