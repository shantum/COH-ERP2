import { Outlet, NavLink, useNavigate } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import {
    LayoutDashboard, Package, Boxes, Scissors, ShoppingCart,
    Users, RotateCcw, Factory, LogOut, Menu, X, BookOpen, Settings
} from 'lucide-react';
import { useState } from 'react';

const navItems = [
    { to: '/', icon: LayoutDashboard, label: 'Dashboard' },
    { to: '/products', icon: Package, label: 'Products' },
    { to: '/inventory', icon: Boxes, label: 'Inventory' },
    { to: '/fabrics', icon: Scissors, label: 'Fabrics' },
    { to: '/orders', icon: ShoppingCart, label: 'Orders' },
    { to: '/customers', icon: Users, label: 'Customers' },
    { to: '/returns', icon: RotateCcw, label: 'Returns' },
    { to: '/production', icon: Factory, label: 'Production' },
    { to: '/ledgers', icon: BookOpen, label: 'Ledgers' },
    { to: '/settings', icon: Settings, label: 'Settings' },
];

export default function Layout() {
    const { user, logout } = useAuth();
    const navigate = useNavigate();
    const [sidebarOpen, setSidebarOpen] = useState(false);

    const handleLogout = () => {
        logout();
        navigate('/login');
    };

    return (
        <div className="min-h-screen bg-gray-50">
            {/* Mobile menu button */}
            <div className="lg:hidden fixed top-4 left-4 z-50">
                <button onClick={() => setSidebarOpen(!sidebarOpen)} className="p-2 rounded-lg bg-white shadow-md">
                    {sidebarOpen ? <X size={24} /> : <Menu size={24} />}
                </button>
            </div>

            {/* Sidebar */}
            <aside className={`fixed inset-y-0 left-0 z-40 w-64 bg-white border-r border-gray-200 transform transition-transform duration-200 ease-in-out ${sidebarOpen ? 'translate-x-0' : '-translate-x-full'} lg:translate-x-0`}>
                <div className="flex flex-col h-full">
                    {/* Logo */}
                    <div className="flex items-center h-16 px-6 border-b border-gray-200">
                        <span className="text-xl font-bold text-brand-charcoal">COH</span>
                        <span className="ml-2 text-sm text-gray-500">ERP</span>
                    </div>

                    {/* Navigation */}
                    <nav className="flex-1 px-4 py-6 space-y-1 overflow-y-auto">
                        {navItems.map((item) => (
                            <NavLink
                                key={item.to}
                                to={item.to}
                                onClick={() => setSidebarOpen(false)}
                                className={({ isActive }) =>
                                    `flex items-center px-4 py-3 rounded-lg text-sm font-medium transition-colors ${isActive
                                        ? 'bg-primary-50 text-primary-700'
                                        : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900'
                                    }`
                                }
                            >
                                <item.icon size={20} className="mr-3" />
                                {item.label}
                            </NavLink>
                        ))}
                    </nav>

                    {/* User */}
                    <div className="p-4 border-t border-gray-200">
                        <div className="flex items-center justify-between">
                            <div>
                                <p className="text-sm font-medium text-gray-900">{user?.name}</p>
                                <p className="text-xs text-gray-500">{user?.role}</p>
                            </div>
                            <button onClick={handleLogout} className="p-2 text-gray-400 hover:text-gray-600 rounded-lg hover:bg-gray-100">
                                <LogOut size={20} />
                            </button>
                        </div>
                    </div>
                </div>
            </aside>

            {/* Main content */}
            <main className="lg:pl-64">
                <div className="p-6 lg:p-8">
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
