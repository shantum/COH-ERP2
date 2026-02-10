/**
 * RouterNotFoundComponent
 *
 * 404 page component for TanStack Router.
 * Shows navigation links to common pages.
 */

import { Link } from '@tanstack/react-router';
import { Home, ShoppingCart, Search } from 'lucide-react';
import { Button } from '@/components/ui/button';

export function RouterNotFoundComponent() {
    return (
        <div className="flex flex-col items-center justify-center min-h-[400px] p-8">
            <div className="text-6xl font-bold text-gray-200 mb-4">404</div>
            <h1 className="text-xl font-semibold mb-2">Page not found</h1>
            <p className="text-gray-600 mb-6 text-center max-w-md">
                The page you're looking for doesn't exist or has been moved.
            </p>

            <div className="flex flex-wrap gap-3 justify-center">
                <Button asChild>
                    <Link to="/">
                        <Home className="h-4 w-4 mr-2" />
                        Dashboard
                    </Link>
                </Button>
                <Button variant="outline" asChild>
                    <Link to="/orders" search={{ view: 'all', page: 1, limit: 250 }}>
                        <ShoppingCart className="h-4 w-4 mr-2" />
                        Orders
                    </Link>
                </Button>
                <Button variant="outline" asChild>
                    <Link to="/products" search={{ tab: 'products', view: 'tree' }}>
                        <Search className="h-4 w-4 mr-2" />
                        Products
                    </Link>
                </Button>
            </div>
        </div>
    );
}
