/**
 * Fabrics Page — thin shell that renders tab components.
 */

import { useCallback } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { Route, type FabricsLoaderData } from '../routes/_authenticated/fabrics';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { AlertTriangle } from 'lucide-react';

import OverviewTab from './fabrics/OverviewTab';
import TransactionsTab from './fabrics/TransactionsTab';
import ReconciliationTab from './fabrics/ReconciliationTab';
import TrimsTab from './fabrics/TrimsTab';
import ServicesTab from './fabrics/ServicesTab';
import BomTab from '../components/bom/BomTab';

export default function Fabrics() {
    const { analysis, health, error } = Route.useLoaderData() as FabricsLoaderData;
    const search = Route.useSearch();
    const navigate = useNavigate();

    const setActiveTab = useCallback((tab: string) => {
        navigate({
            to: '/fabrics',
            search: { tab } as { tab: 'overview' | 'transactions' | 'reconciliation' | 'trims' | 'services' | 'bom' },
            replace: true,
        });
    }, [navigate]);

    return (
        <div className="flex h-full flex-col">
            {/* Error Banner */}
            {error && (
                <div className="mx-6 mt-4 flex items-center gap-2 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700 ring-1 ring-red-200">
                    <AlertTriangle className="h-4 w-4 shrink-0" />
                    {error}
                </div>
            )}

            {/* Tabs */}
            <Tabs value={search.tab} onValueChange={setActiveTab} className="flex flex-1 flex-col overflow-hidden">
                <div className="border-b bg-white px-6 pt-4">
                    <div className="flex items-center justify-between">
                        <h1 className="text-xl font-semibold text-slate-900">Fabrics</h1>
                    </div>
                    <TabsList className="mt-3 mb-0 w-auto">
                        <TabsTrigger value="overview">Overview</TabsTrigger>
                        <TabsTrigger value="transactions">Transactions</TabsTrigger>
                        <TabsTrigger value="reconciliation">Reconciliation</TabsTrigger>
                        <TabsTrigger value="trims">Trims</TabsTrigger>
                        <TabsTrigger value="services">Services</TabsTrigger>
                        <TabsTrigger value="bom">BOM</TabsTrigger>
                    </TabsList>
                </div>

                <div className="flex-1 overflow-hidden">
                    <TabsContent value="overview" className="h-full m-0">
                        <OverviewTab analysis={analysis} health={health} />
                    </TabsContent>
                    <TabsContent value="transactions" className="h-full m-0">
                        <TransactionsTab />
                    </TabsContent>
                    <TabsContent value="reconciliation" className="h-full m-0">
                        <ReconciliationTab />
                    </TabsContent>
                    <TabsContent value="trims" className="h-full m-0">
                        <TrimsTab />
                    </TabsContent>
                    <TabsContent value="services" className="h-full m-0">
                        <ServicesTab />
                    </TabsContent>
                    <TabsContent value="bom" className="h-full m-0">
                        <BomTab />
                    </TabsContent>
                </div>
            </Tabs>
        </div>
    );
}
