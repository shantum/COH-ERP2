import { createFileRoute, redirect } from '@tanstack/react-router';
import { lazy } from 'react';
import { isAdminUser, type AuthUser } from '../../types';

const ChannelImport = lazy(() => import('../../pages/ChannelImport'));

export const Route = createFileRoute('/_authenticated/channel-import')({
    beforeLoad: ({ context }) => {
        if (!isAdminUser((context as { user?: AuthUser }).user)) {
            throw redirect({ to: '/' });
        }
    },
    component: ChannelImport,
});
