/**
 * Sheets Monitor Route - /sheets-monitor
 */
import { createFileRoute } from '@tanstack/react-router';
import { lazy } from 'react';

const SheetsMonitor = lazy(() => import('../../pages/SheetsMonitor'));

export const Route = createFileRoute('/_authenticated/sheets-monitor')({
    component: SheetsMonitor,
});
