/**
 * useDocumentTitle Hook
 *
 * Automatically updates the document title based on the current route.
 * Uses the route metadata from config/routeMeta.ts.
 *
 * Usage: Call once in Layout component
 *   useDocumentTitle();
 */

import { useEffect } from 'react';
import { useRouterState } from '@tanstack/react-router';
import { getPageTitle } from '../config/routeMeta';

export function useDocumentTitle() {
  const routerState = useRouterState();
  const pathname = routerState.location.pathname;

  useEffect(() => {
    document.title = getPageTitle(pathname);
  }, [pathname]);
}
