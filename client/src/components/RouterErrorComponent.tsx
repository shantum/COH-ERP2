/**
 * RouterErrorComponent
 *
 * Error boundary component for TanStack Router.
 * Shows error message with options to retry or copy diagnostics.
 */

import { useRouter } from '@tanstack/react-router';
import { AlertTriangle, Copy, RefreshCw, Home } from 'lucide-react';
import { Link } from '@tanstack/react-router';
import { Button } from '@/components/ui/button';
import { getDiagnostics } from '@/utils/breadcrumbTracker';
import { showSuccess } from '@/utils/toast';

interface RouterErrorComponentProps {
    error: Error;
}

export function RouterErrorComponent({ error }: RouterErrorComponentProps) {
    const router = useRouter();

    const handleCopyDiagnostics = () => {
        const diagnostics = getDiagnostics(error);
        navigator.clipboard.writeText(JSON.stringify(diagnostics, null, 2));
        showSuccess('Diagnostics copied to clipboard');
    };

    const handleRetry = () => {
        router.invalidate();
    };

    return (
        <div className="flex flex-col items-center justify-center min-h-[400px] p-8">
            <AlertTriangle className="h-12 w-12 text-red-500 mb-4" />
            <h1 className="text-xl font-semibold mb-2">Something went wrong</h1>
            <p className="text-gray-600 mb-6 text-center max-w-md">
                {error.message || 'An unexpected error occurred'}
            </p>

            <div className="flex flex-wrap gap-3 justify-center">
                <Button variant="outline" onClick={handleRetry}>
                    <RefreshCw className="h-4 w-4 mr-2" />
                    Retry
                </Button>
                <Button variant="outline" onClick={handleCopyDiagnostics}>
                    <Copy className="h-4 w-4 mr-2" />
                    Copy Diagnostics
                </Button>
                <Button asChild>
                    <Link to="/">
                        <Home className="h-4 w-4 mr-2" />
                        Dashboard
                    </Link>
                </Button>
            </div>

            {/* Technical details (collapsed by default) */}
            <details className="mt-6 w-full max-w-lg text-sm">
                <summary className="cursor-pointer text-gray-500 hover:text-gray-700">
                    Technical details
                </summary>
                <pre className="mt-2 p-3 bg-gray-100 rounded-md overflow-x-auto text-xs text-gray-700">
                    {error.stack || error.message}
                </pre>
            </details>
        </div>
    );
}
