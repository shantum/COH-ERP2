/**
 * CommandPalette Component
 *
 * CMD/CTRL+K command palette for quick navigation.
 * Uses shadcn Command (cmdk) component.
 */

import { useEffect, useState, useCallback } from 'react';
import { useNavigate } from '@tanstack/react-router';
import {
    CommandDialog,
    CommandEmpty,
    CommandGroup,
    CommandInput,
    CommandItem,
    CommandList,
} from '@/components/ui/command';
import {
    LayoutDashboard,
    ShoppingCart,
    Package,
    Users,
    BarChart3,
    Factory,
    RotateCcw,
    Scissors,
    Settings,
    Search,
    BookOpen,
    PackagePlus,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

interface NavigationItem {
    label: string;
    icon: LucideIcon;
    to: string;
    search?: Record<string, string>;
    keywords?: string[];
}

const navigationItems: NavigationItem[] = [
    { label: 'Dashboard', icon: LayoutDashboard, to: '/', keywords: ['home', 'overview'] },
    { label: 'Search Orders', icon: Search, to: '/order-search', keywords: ['find', 'lookup'] },
    { label: 'Orders', icon: ShoppingCart, to: '/orders', keywords: ['fulfillment', 'shipping'] },
    { label: 'Products', icon: Package, to: '/products', keywords: ['catalog', 'sku', 'items'] },
    { label: 'Inventory', icon: Package, to: '/inventory', keywords: ['stock', 'warehouse'] },
    { label: 'Materials', icon: Scissors, to: '/products', search: { tab: 'materials' }, keywords: ['fabrics', 'textiles'] },
    { label: 'Production', icon: Factory, to: '/production', keywords: ['manufacturing', 'batches'] },
    { label: 'Inventory Inward', icon: PackagePlus, to: '/inventory-inward', keywords: ['receiving', 'inbound'] },
    { label: 'Returns', icon: RotateCcw, to: '/returns', keywords: ['refunds', 'rma'] },
    { label: 'Customers', icon: Users, to: '/customers', keywords: ['clients', 'contacts'] },
    { label: 'Ledgers', icon: BookOpen, to: '/ledgers', keywords: ['accounts', 'transactions'] },
    { label: 'Analytics', icon: BarChart3, to: '/analytics', keywords: ['reports', 'metrics', 'insights'] },
    { label: 'Settings', icon: Settings, to: '/settings', keywords: ['preferences', 'config'] },
];

export function CommandPalette() {
    const [open, setOpen] = useState(false);
    const navigate = useNavigate();

    // Handle keyboard shortcut
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
                e.preventDefault();
                setOpen((prev) => !prev);
            }
        };

        document.addEventListener('keydown', handleKeyDown);
        return () => document.removeEventListener('keydown', handleKeyDown);
    }, []);

    const handleSelect = useCallback(
        (item: NavigationItem) => {
            setOpen(false);
            navigate({ to: item.to as '/', search: item.search as Record<string, string> });
        },
        [navigate]
    );

    return (
        <CommandDialog open={open} onOpenChange={setOpen}>
            <CommandInput placeholder="Type to search pages..." />
            <CommandList>
                <CommandEmpty>No results found.</CommandEmpty>
                <CommandGroup heading="Navigation">
                    {navigationItems.map((item) => (
                        <CommandItem
                            key={item.to + (item.search?.tab || '')}
                            value={`${item.label} ${item.keywords?.join(' ') || ''}`}
                            onSelect={() => handleSelect(item)}
                            className="cursor-pointer"
                        >
                            <item.icon className="mr-2 h-4 w-4" />
                            <span>{item.label}</span>
                        </CommandItem>
                    ))}
                </CommandGroup>
            </CommandList>
        </CommandDialog>
    );
}
