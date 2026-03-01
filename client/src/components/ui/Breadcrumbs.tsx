/**
 * Breadcrumbs Component
 *
 * Displays navigation breadcrumbs based on current route.
 * Hidden on Dashboard and Login pages.
 *
 * Usage:
 *   <Breadcrumbs />
 */

import { Link, useRouterState } from '@tanstack/react-router';
import { ChevronRight, Home } from 'lucide-react';
import { getBreadcrumb } from '../../config/routeMeta';

export function Breadcrumbs() {
  const routerState = useRouterState();
  const pathname = routerState.location.pathname;

  // Don't show on dashboard or login
  if (pathname === '/' || pathname === '/login') {
    return null;
  }

  return (
    <nav aria-label="Breadcrumb" className="flex items-center gap-1.5 text-sm text-warm-600">
      <Link to="/" className="flex items-center gap-1 hover:text-warm-800 transition-colors">
        <Home size={14} />
        <span>Home</span>
      </Link>
      <ChevronRight size={14} className="text-warm-400" />
      <span className="text-warm-900 font-medium">{getBreadcrumb(pathname)}</span>
    </nav>
  );
}
