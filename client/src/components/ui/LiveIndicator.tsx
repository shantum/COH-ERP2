/**
 * LiveIndicator - Connection status dot for header
 *
 * Shows real-time connection status:
 * - Green pulse: Connected to real-time updates
 * - Red: Disconnected (will auto-reconnect)
 *
 * Subtle design - small dot with optional label on larger screens.
 */

import { usePulse } from '../../hooks/usePulse';

export function LiveIndicator() {
    const { isConnected } = usePulse();

    return (
        <div
            className="flex items-center gap-1.5 px-2 py-1 rounded-md text-xs"
            title={isConnected ? 'Real-time updates active' : 'Reconnecting to real-time updates...'}
        >
            <span
                className={`w-2 h-2 rounded-full transition-colors ${
                    isConnected
                        ? 'bg-green-500 animate-pulse'
                        : 'bg-red-500'
                }`}
            />
            <span className="hidden sm:inline text-gray-500">
                {isConnected ? 'Live' : 'Offline'}
            </span>
        </div>
    );
}
