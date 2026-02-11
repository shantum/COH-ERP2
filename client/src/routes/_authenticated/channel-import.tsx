import { createFileRoute } from '@tanstack/react-router';
import { lazy } from 'react';

const ChannelImport = lazy(() => import('../../pages/ChannelImport'));

export const Route = createFileRoute('/_authenticated/channel-import')({
    component: ChannelImport,
});
