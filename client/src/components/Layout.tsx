import { Outlet, NavLink, useNavigate } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import {
    LayoutDashboard, Scissors, ShoppingCart, Truck,
    Users, RotateCcw, Factory, LogOut, Menu, X, BookOpen, Settings, ClipboardList, ClipboardCheck, PackagePlus, Clipboard, Table2, BarChart3, UserCog, ChevronLeft, ChevronRight, Search, Package, PackageX
} from 'lucide-react';
import { usePermissions } from '../hooks/usePermissions';
import { useState, useEffect } from 'react';

// Navigation items with optional permission requirement
const navItems = [
    { to: '/', icon: LayoutDashboard, label: 'Dashboard' },
    { to: '/order-search', icon: Search, label: 'Search' },
    { to: '/catalog', icon: Table2, label: 'Catalog' },
    { to: '/inventory', icon: Package, label: 'Inventory' },
    { to: '/fabrics', icon: Scissors, label: 'Fabrics' },
    { to: '/fabric-reconciliation', icon: ClipboardCheck, label: 'Fabric Count' },
    { to: '/inventory-count', icon: Clipboard, label: 'Inventory Count' },
    { to: '/orders', icon: ShoppingCart, label: 'Orders' },
    { to: '/shipments', icon: Truck, label: 'Shipments' },
    { to: '/picklist', icon: ClipboardList, label: 'Picklist' },
    { to: '/customers', icon: Users, label: 'Customers' },
    { to: '/returns', icon: RotateCcw, label: 'Returns' },
    { to: '/production', icon: Factory, label: 'Production' },
    { to: '/inventory-inward', icon: PackagePlus, label: 'Inventory Inward' },
    { to: '/returns-rto', icon: PackageX, label: 'Returns & RTO' },
    { to: '/ledgers', icon: BookOpen, label: 'Ledgers' },
    { to: '/analytics', icon: BarChart3, label: 'Analytics' },
    { to: '/settings', icon: Settings, label: 'Settings' },
    { to: '/users', icon: UserCog, label: 'Users', permission: 'users:view' },
];

export default function Layout() {
    const { user, logout } = useAuth();
    const { hasPermission } = usePermissions();
    const navigate = useNavigate();
    const [sidebarOpen, setSidebarOpen] = useState(false);
    const [collapsed, setCollapsed] = useState(() => {
        return localStorage.getItem('sidebar-collapsed') === 'true';
    });
    const [isHovering, setIsHovering] = useState(false);

    useEffect(() => {
        localStorage.setItem('sidebar-collapsed', String(collapsed));
    }, [collapsed]);

    const handleLogout = () => {
        logout();
        navigate('/login');
    };

    const toggleCollapsed = () => {
        setCollapsed(!collapsed);
    };

    // Filter nav items based on permissions
    const filteredNavItems = navItems.filter(item => {
        if (!item.permission) return true;
        return hasPermission(item.permission);
    });

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
                    collapsed && !isHovering ? 'lg:w-16' : 'w-56 lg:w-64'
                }`}
                onMouseEnter={() => collapsed && setIsHovering(true)}
                onMouseLeave={() => setIsHovering(false)}
            >
                <div className="flex flex-col h-full">
                    {/* Logo */}
                    <div className={`flex items-center h-14 border-b border-gray-200 transition-all duration-200 ${
                        collapsed && !isHovering ? 'px-3 justify-center' : 'px-4'
                    }`}>
                        <span className="text-xl font-bold text-brand-charcoal">COH</span>
                        {(!(collapsed && !isHovering)) && <span className="ml-2 text-sm text-gray-500">ERP</span>}
                    </div>

                    {/* Navigation */}
                    <nav className={`flex-1 py-4 space-y-1 overflow-y-auto ${collapsed && !isHovering ? 'px-2' : 'px-3'}`}>
                        {filteredNavItems.map((item) => (
                            <NavLink
                                key={item.to}
                                to={item.to}
                                onClick={() => setSidebarOpen(false)}
                                className={({ isActive }) =>
                                    `flex items-center rounded-lg text-sm font-medium transition-all duration-200 ${
                                        collapsed && !isHovering
                                            ? 'px-3 py-2.5 justify-center'
                                            : 'px-3 py-2.5'
                                    } ${isActive
                                        ? 'bg-primary-50 text-primary-700'
                                        : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900'
                                    }`
                                }
                                title={collapsed && !isHovering ? item.label : undefined}
                            >
                                <item.icon size={20} className={collapsed && !isHovering ? '' : 'mr-3 flex-shrink-0'} />
                                {(!(collapsed && !isHovering)) && <span className="whitespace-nowrap truncate">{item.label}</span>}
                            </NavLink>
                        ))}
                    </nav>

                    {/* Toggle button - Desktop only */}
                    <div className="hidden lg:block border-t border-gray-200">
                        <button
                            onClick={(e) => {
                                e.stopPropagation();
                                toggleCollapsed();
                            }}
                            className="w-full p-3 text-gray-500 hover:text-gray-700 hover:bg-gray-100 transition-colors flex items-center justify-center gap-2"
                            title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
                        >
                            {collapsed && !isHovering ? (
                                <ChevronRight size={20} />
                            ) : (
                                <>
                                    <ChevronLeft size={18} />
                                    <span className="text-xs">Collapse</span>
                                </>
                            )}
                        </button>
                    </div>

                    {/* User */}
                    <div className={`p-3 border-t border-gray-200 transition-all duration-200 ${
                        collapsed && !isHovering ? 'px-2' : ''
                    }`}>
                        <div className={`flex items-center ${
                            collapsed && !isHovering ? 'justify-center' : 'justify-between'
                        }`}>
                            {collapsed && !isHovering ? (
                                <button
                                    onClick={handleLogout}
                                    className="p-2 text-gray-400 hover:text-gray-600 rounded-lg hover:bg-gray-100"
                                    title="Logout"
                                >
                                    <LogOut size={20} />
                                </button>
                            ) : (
                                <>
                                    <div className="min-w-0">
                                        <p className="text-sm font-medium text-gray-900 truncate">{user?.name}</p>
                                        <p className="text-xs text-gray-500 truncate">{user?.role}</p>
                                    </div>
                                    <button
                                        onClick={handleLogout}
                                        className="p-2 text-gray-400 hover:text-gray-600 rounded-lg hover:bg-gray-100 flex-shrink-0"
                                        title="Logout"
                                    >
                                        <LogOut size={20} />
                                    </button>
                                </>
                            )}
                        </div>
                    </div>
                </div>
            </aside>

            {/* Main content */}
            <main className={`transition-all duration-200 ${
                collapsed ? 'lg:pl-16' : 'lg:pl-56 xl:pl-64'
            }`}>
                <div className="p-4 md:p-6 lg:p-8">
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
