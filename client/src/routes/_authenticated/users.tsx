/**
 * Users Route - /users
 */
import { createFileRoute } from '@tanstack/react-router';
import { lazy } from 'react';

const UserManagement = lazy(() => import('../../pages/UserManagement'));

export const Route = createFileRoute('/_authenticated/users')({
    component: UserManagement,
});
