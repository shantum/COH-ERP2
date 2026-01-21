/**
 * @deprecated This page has been split into two separate pages:
 * - /inventory-inward (Production, Adjustments)
 * - /returns-rto (Returns, RTO, Repacking)
 *
 * This file is kept for reference only. Route redirects to /inventory-inward.
 *
 * Inward Hub - Mode-Based Entry Point
 *
 * Users must select an inward type (mode) before scanning.
 * Each mode has its own interface and filtered recent history.
 */

import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useServerFn } from '@tanstack/react-start';
import { getRecentInwards } from '../server/functions/inventory';
import {
    ModeSelector,
    InwardModeHeader,
    ProductionInward,
    ReturnsInward,
    RtoInward,
    RepackingInward,
    AdjustmentsInward,
} from '../components/inward';
import type { InwardMode } from '../components/inward';

export default function InwardHub() {
    const [activeMode, setActiveMode] = useState<InwardMode | null>(null);

    // Server function hook
    const getRecentInwardsFn = useServerFn(getRecentInwards);

    // Fetch recent inwards for today's total (across all modes when on selector)
    const { data: recentInwards = [] } = useQuery({
        queryKey: ['recent-inwards', activeMode || 'all'],
        queryFn: () =>
            getRecentInwardsFn({
                data: {
                    limit: 50,
                    ...(activeMode ? { source: activeMode } : {}),
                },
            }),
        refetchInterval: 15000,
    });

    // Calculate today's total for the header
    const todayTotal = useMemo(() => {
        const today = new Date().toDateString();
        return recentInwards
            .filter(i => new Date(i.createdAt).toDateString() === today)
            .reduce((sum, i) => sum + i.qty, 0);
    }, [recentInwards]);

    // No mode selected - show mode selector
    if (!activeMode) {
        return <ModeSelector onSelectMode={setActiveMode} />;
    }

    // Mode selected - show mode header + mode-specific component
    return (
        <div className="min-h-screen bg-gray-50">
            <InwardModeHeader
                mode={activeMode}
                onExitMode={() => setActiveMode(null)}
                todayTotal={todayTotal}
            />

            <div className="p-4 md:p-6">
                {activeMode === 'production' && <ProductionInward />}
                {activeMode === 'returns' && <ReturnsInward />}
                {activeMode === 'rto' && <RtoInward />}
                {activeMode === 'repacking' && <RepackingInward />}
                {activeMode === 'adjustments' && <AdjustmentsInward />}
            </div>
        </div>
    );
}
