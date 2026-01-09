import { lazy, Suspense } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import ErrorBoundary from './components/ErrorBoundary';
import Layout from './components/Layout';
import { AuthProvider, useAuth } from './hooks/useAuth';
import './index.css';

// Lazy load pages for code splitting (40-50% faster initial load)
const Dashboard = lazy(() => import('./pages/Dashboard'));
const Catalog = lazy(() => import('./pages/Catalog'));
const Fabrics = lazy(() => import('./pages/Fabrics'));
const FabricReconciliation = lazy(() => import('./pages/FabricReconciliation'));
const InventoryReconciliation = lazy(() => import('./pages/InventoryReconciliation'));
const Orders = lazy(() => import('./pages/Orders'));
const Customers = lazy(() => import('./pages/Customers'));
const Returns = lazy(() => import('./pages/Returns'));
const Production = lazy(() => import('./pages/Production'));
const InwardHub = lazy(() => import('./pages/InwardHub'));
const Picklist = lazy(() => import('./pages/Picklist'));
const Ledgers = lazy(() => import('./pages/Ledgers'));
const Analytics = lazy(() => import('./pages/Analytics'));
const Settings = lazy(() => import('./pages/Settings'));
const Login = lazy(() => import('./pages/Login'));

// Loading spinner for Suspense fallback
const PageLoader = () => (
  <div className="min-h-[60vh] flex items-center justify-center">
    <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600"></div>
  </div>
);

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30000,
      retry: 1,
    },
  },
});

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, isLoading } = useAuth();

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600"></div>
      </div>
    );
  }

  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }

  return <>{children}</>;
}

function App() {
  return (
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <AuthProvider>
          <BrowserRouter>
            <Routes>
              <Route path="/login" element={<Suspense fallback={<PageLoader />}><Login /></Suspense>} />
              <Route path="/" element={
                <ProtectedRoute>
                  <Layout />
                </ProtectedRoute>
              }>
                <Route index element={<Suspense fallback={<PageLoader />}><ErrorBoundary><Dashboard /></ErrorBoundary></Suspense>} />
                <Route path="catalog" element={<Suspense fallback={<PageLoader />}><ErrorBoundary><Catalog /></ErrorBoundary></Suspense>} />
                {/* Redirects for old routes (bookmark compatibility) */}
                <Route path="products" element={<Navigate to="/catalog" replace />} />
                <Route path="inventory" element={<Navigate to="/catalog" replace />} />
                <Route path="fabrics" element={<Suspense fallback={<PageLoader />}><ErrorBoundary><Fabrics /></ErrorBoundary></Suspense>} />
                <Route path="fabric-reconciliation" element={<Suspense fallback={<PageLoader />}><ErrorBoundary><FabricReconciliation /></ErrorBoundary></Suspense>} />
                <Route path="inventory-count" element={<Suspense fallback={<PageLoader />}><ErrorBoundary><InventoryReconciliation /></ErrorBoundary></Suspense>} />
                <Route path="orders" element={<Suspense fallback={<PageLoader />}><ErrorBoundary><Orders /></ErrorBoundary></Suspense>} />
                <Route path="customers" element={<Suspense fallback={<PageLoader />}><ErrorBoundary><Customers /></ErrorBoundary></Suspense>} />
                <Route path="returns" element={<Suspense fallback={<PageLoader />}><ErrorBoundary><Returns /></ErrorBoundary></Suspense>} />
                <Route path="production" element={<Suspense fallback={<PageLoader />}><ErrorBoundary><Production /></ErrorBoundary></Suspense>} />
                <Route path="inward-hub" element={<Suspense fallback={<PageLoader />}><ErrorBoundary><InwardHub /></ErrorBoundary></Suspense>} />
                {/* Redirects for old routes (bookmark compatibility) */}
                <Route path="production-inward" element={<Navigate to="/inward-hub" replace />} />
                <Route path="return-inward" element={<Navigate to="/inward-hub" replace />} />
                <Route path="picklist" element={<Suspense fallback={<PageLoader />}><ErrorBoundary><Picklist /></ErrorBoundary></Suspense>} />
                <Route path="ledgers" element={<Suspense fallback={<PageLoader />}><ErrorBoundary><Ledgers /></ErrorBoundary></Suspense>} />
                <Route path="analytics" element={<Suspense fallback={<PageLoader />}><ErrorBoundary><Analytics /></ErrorBoundary></Suspense>} />
                <Route path="settings" element={<Suspense fallback={<PageLoader />}><ErrorBoundary><Settings /></ErrorBoundary></Suspense>} />
              </Route>
            </Routes>
          </BrowserRouter>
        </AuthProvider>
      </QueryClientProvider>
    </ErrorBoundary>
  );
}

export default App;
