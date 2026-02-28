/**
 * Business Pulse Route - /business
 *
 * Uses Route Loader to pre-fetch business pulse snapshot on the server (SSR).
 * Auth is verified by parent _authenticated layout's beforeLoad.
 */
import { createFileRoute } from '@tanstack/react-router';
import { getBusinessPulseFn } from '../../../server/functions/business';
import type { BusinessPulse } from '@coh/shared/services/business/types';
import { reportError } from '@/utils/errorReporter';

// Direct import (no lazy loading) for SSR routes with loader data
import BusinessPulsePage from '../../../pages/BusinessPulse';

export const Route = createFileRoute('/_authenticated/business/')({
    loader: async (): Promise<BusinessPulseLoaderData> => {
        try {
            const pulse = await getBusinessPulseFn();
            return { pulse, error: null };
        } catch (error) {
            console.error('[Business Pulse Loader] Error:', error);
            reportError(error, { loader: 'business-pulse' });
            return {
                pulse: null,
                error: error instanceof Error ? error.message : 'Failed to load business pulse',
            };
        }
    },
    component: BusinessPulsePage,
});

export interface BusinessPulseLoaderData {
    pulse: BusinessPulse | null;
    error: string | null;
}
