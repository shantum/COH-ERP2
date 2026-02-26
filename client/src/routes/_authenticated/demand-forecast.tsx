/**
 * Demand Forecast Route - /demand-forecast
 */
import { createFileRoute } from '@tanstack/react-router';
import { lazy } from 'react';

const DemandForecast = lazy(() => import('../../pages/DemandForecast'));

export const Route = createFileRoute('/_authenticated/demand-forecast')({
    component: DemandForecast,
});
