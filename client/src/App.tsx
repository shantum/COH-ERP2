import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import ErrorBoundary from './components/ErrorBoundary';
import Layout from './components/Layout';
import Dashboard from './pages/Dashboard';
import Products from './pages/Products';
import Inventory from './pages/Inventory';
import Fabrics from './pages/Fabrics';
import FabricReconciliation from './pages/FabricReconciliation';
import Orders from './pages/Orders';
import Customers from './pages/Customers';
import Returns from './pages/Returns';
import ReturnInward from './pages/ReturnInward';
import Production from './pages/Production';
import ProductionInward from './pages/ProductionInward';
import Picklist from './pages/Picklist';
import Ledgers from './pages/Ledgers';
import Settings from './pages/Settings';
import Login from './pages/Login';
import { AuthProvider, useAuth } from './hooks/useAuth';
import './index.css';

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
              <Route path="/login" element={<Login />} />
              <Route path="/" element={
                <ProtectedRoute>
                  <Layout />
                </ProtectedRoute>
              }>
                <Route index element={<ErrorBoundary><Dashboard /></ErrorBoundary>} />
                <Route path="products" element={<ErrorBoundary><Products /></ErrorBoundary>} />
                <Route path="inventory" element={<ErrorBoundary><Inventory /></ErrorBoundary>} />
                <Route path="fabrics" element={<ErrorBoundary><Fabrics /></ErrorBoundary>} />
                <Route path="fabric-reconciliation" element={<ErrorBoundary><FabricReconciliation /></ErrorBoundary>} />
                <Route path="orders" element={<ErrorBoundary><Orders /></ErrorBoundary>} />
                <Route path="customers" element={<ErrorBoundary><Customers /></ErrorBoundary>} />
                <Route path="returns" element={<ErrorBoundary><Returns /></ErrorBoundary>} />
                <Route path="return-inward" element={<ErrorBoundary><ReturnInward /></ErrorBoundary>} />
                <Route path="production" element={<ErrorBoundary><Production /></ErrorBoundary>} />
                <Route path="production-inward" element={<ErrorBoundary><ProductionInward /></ErrorBoundary>} />
                <Route path="picklist" element={<ErrorBoundary><Picklist /></ErrorBoundary>} />
                <Route path="ledgers" element={<ErrorBoundary><Ledgers /></ErrorBoundary>} />
                <Route path="settings" element={<ErrorBoundary><Settings /></ErrorBoundary>} />
              </Route>
            </Routes>
          </BrowserRouter>
        </AuthProvider>
      </QueryClientProvider>
    </ErrorBoundary>
  );
}

export default App;
