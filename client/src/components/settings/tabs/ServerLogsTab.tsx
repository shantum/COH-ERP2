/**
 * ServerLogsTab component
 * Real-time server logs viewer with filtering and search
 *
 * Uses Server Functions for data fetching and mutations.
 */

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { getServerLogs, getLogStats, clearLogs } from '../../../server/functions/admin';
import {
    Terminal, RefreshCw, Trash2, Search, AlertCircle, Info, AlertTriangle,
    XCircle, Filter, Clock, Activity, TrendingUp
} from 'lucide-react';

type LogLevel = 'all' | 'error' | 'warn' | 'info' | 'debug';

// Extended LogEntry with id for the frontend display
interface LogEntry {
    id?: string;
    timestamp: string;
    level: string;
    message: string;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    meta?: Record<string, any>;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    context?: Record<string, any>;
}

export function ServerLogsTab() {
    const queryClient = useQueryClient();
    const [selectedLevel, setSelectedLevel] = useState<LogLevel>('all');
    const [searchTerm, setSearchTerm] = useState('');
    const [autoRefresh, setAutoRefresh] = useState(true);
    const [limit] = useState(100);

    // Fetch logs — keepPreviousData prevents layout flash during refetch
    const { data: logsData, isLoading, refetch } = useQuery({
        queryKey: ['serverLogs', selectedLevel, searchTerm, limit],
        queryFn: async () => {
            const result = await getServerLogs({
                data: {
                    level: selectedLevel,
                    limit,
                    offset: 0,
                    search: searchTerm || null,
                },
            });
            if (!result.success || !result.data) {
                throw new Error(result.error?.message || 'Failed to fetch logs');
            }
            return result.data;
        },
        refetchInterval: autoRefresh ? 3000 : false,
        placeholderData: (prev) => prev,
    });

    // Fetch log stats — keepPreviousData prevents stats section from vanishing during refetch
    const { data: stats } = useQuery({
        queryKey: ['logStats'],
        queryFn: async () => {
            const result = await getLogStats();
            if (!result.success || !result.data) {
                throw new Error(result.error?.message || 'Failed to fetch log stats');
            }
            return result.data;
        },
        refetchInterval: autoRefresh ? 5000 : false,
        placeholderData: (prev) => prev,
    });

    // Clear logs mutation
    const clearLogsMutation = useMutation({
        mutationFn: async () => {
            const result = await clearLogs();
            if (!result.success) {
                throw new Error(result.error?.message || 'Failed to clear logs');
            }
            return result.data;
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['serverLogs'] });
            queryClient.invalidateQueries({ queryKey: ['logStats'] });
        },
    });

    const handleClearLogs = () => {
        if (confirm('Are you sure you want to clear all server logs?')) {
            clearLogsMutation.mutate();
        }
    };

    const getLevelIcon = (level: string) => {
        switch (level) {
            case 'error':
            case 'fatal':
                return <XCircle size={14} className="text-red-500" />;
            case 'warn':
                return <AlertTriangle size={14} className="text-yellow-500" />;
            case 'info':
                return <Info size={14} className="text-blue-500" />;
            case 'debug':
            case 'trace':
                return <Activity size={14} className="text-gray-400" />;
            default:
                return <Info size={14} className="text-gray-500" />;
        }
    };

    const getLevelColor = (level: string) => {
        switch (level) {
            case 'error':
            case 'fatal':
                return 'bg-red-100 text-red-800 border-red-300';
            case 'warn':
                return 'bg-yellow-100 text-yellow-800 border-yellow-300';
            case 'info':
                return 'bg-blue-100 text-blue-800 border-blue-300';
            case 'debug':
            case 'trace':
                return 'bg-gray-100 text-gray-600 border-gray-300';
            default:
                return 'bg-gray-100 text-gray-800 border-gray-300';
        }
    };

    const formatTimestamp = (timestamp: string) => {
        const date = new Date(timestamp);
        return date.toLocaleTimeString('en-US', {
            hour12: false,
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
            fractionalSecondDigits: 3,
        });
    };

    return (
        <div className="space-y-6">
            {/* Header Stats */}
            {stats && (
                <div className="card">
                    <div className="flex items-center gap-2 mb-4">
                        <TrendingUp size={20} className="text-primary-600" />
                        <h2 className="text-lg font-semibold">Log Statistics</h2>
                    </div>

                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
                        <div className="bg-gradient-to-br from-gray-50 to-gray-100 rounded-lg p-3 border border-gray-200">
                            <p className="text-2xl font-bold text-gray-900">
                                {stats.total.toLocaleString()} / {stats.maxSize.toLocaleString()}
                            </p>
                            <p className="text-xs text-gray-600">Logs (Current / Max)</p>
                        </div>
                        <div className="bg-gradient-to-br from-red-50 to-red-100 rounded-lg p-3 border border-red-200">
                            <p className="text-2xl font-bold text-red-700">{stats.byLevel.error.toLocaleString()}</p>
                            <p className="text-xs text-red-600">Errors</p>
                        </div>
                        <div className="bg-gradient-to-br from-yellow-50 to-yellow-100 rounded-lg p-3 border border-yellow-200">
                            <p className="text-2xl font-bold text-yellow-700">{stats.byLevel.warn.toLocaleString()}</p>
                            <p className="text-xs text-yellow-600">Warnings</p>
                        </div>
                        <div className="bg-gradient-to-br from-blue-50 to-blue-100 rounded-lg p-3 border border-blue-200">
                            <p className="text-2xl font-bold text-blue-700">{stats.byLevel.info.toLocaleString()}</p>
                            <p className="text-xs text-blue-600">Info</p>
                        </div>
                    </div>

                    <div className="grid md:grid-cols-2 gap-4 text-sm">
                        <div className="bg-gradient-to-br from-indigo-50 to-purple-50 rounded-lg p-3 border border-indigo-200">
                            <div className="flex items-center gap-2 mb-2">
                                <Clock size={16} className="text-indigo-600" />
                                <span className="font-semibold text-indigo-800">Last Hour</span>
                            </div>
                            <div className="flex gap-4 text-xs">
                                <span className="text-gray-700">Total: <span className="font-semibold">{stats.lastHour.total}</span></span>
                                <span className="text-red-600">Errors: <span className="font-semibold">{stats.lastHour.byLevel.error}</span></span>
                                <span className="text-yellow-600">Warns: <span className="font-semibold">{stats.lastHour.byLevel.warn}</span></span>
                            </div>
                        </div>
                        <div className="bg-gradient-to-br from-green-50 to-emerald-50 rounded-lg p-3 border border-green-200">
                            <div className="flex items-center gap-2 mb-2">
                                <Activity size={16} className="text-green-600" />
                                <span className="font-semibold text-green-800">Last 24 Hours</span>
                            </div>
                            <div className="flex gap-4 text-xs">
                                <span className="text-gray-700">Total: <span className="font-semibold">{stats.last24Hours.total}</span></span>
                                <span className="text-red-600">Errors: <span className="font-semibold">{stats.last24Hours.byLevel.error}</span></span>
                                <span className="text-yellow-600">Warns: <span className="font-semibold">{stats.last24Hours.byLevel.warn}</span></span>
                            </div>
                        </div>
                    </div>

                    {/* Storage Information */}
                    <div className="mt-4 grid md:grid-cols-3 gap-3 text-xs">
                        <div className="bg-white rounded-lg p-3 border border-gray-200">
                            <p className="font-semibold text-gray-700 mb-1">Storage Type</p>
                            <p className="text-gray-600">
                                {stats.isPersistent ? 'Persistent (file-based)' : 'In-memory only'}
                            </p>
                        </div>
                        <div className="bg-white rounded-lg p-3 border border-gray-200">
                            <p className="font-semibold text-gray-700 mb-1">Retention Period</p>
                            <p className="text-gray-600">{stats.retentionHours} hours</p>
                        </div>
                        <div className="bg-white rounded-lg p-3 border border-gray-200">
                            <p className="font-semibold text-gray-700 mb-1">File Size</p>
                            <p className="text-gray-600">
                                {stats.fileSizeKB !== undefined
                                    ? stats.fileSizeKB < 1024
                                        ? `${stats.fileSizeKB} KB`
                                        : `${stats.fileSizeMB} MB`
                                    : 'N/A'}
                            </p>
                        </div>
                    </div>

                    <div className="mt-3 grid md:grid-cols-3 gap-3 text-xs">
                        <div className="bg-white rounded-lg p-3 border border-gray-200">
                            <p className="font-semibold text-gray-700 mb-1">Oldest Log</p>
                            <p className="text-gray-600">
                                {stats.oldestLog ? new Date(stats.oldestLog).toLocaleString() : 'N/A'}
                            </p>
                        </div>
                        <div className="bg-white rounded-lg p-3 border border-gray-200">
                            <p className="font-semibold text-gray-700 mb-1">Newest Log</p>
                            <p className="text-gray-600">
                                {stats.newestLog ? new Date(stats.newestLog).toLocaleString() : 'N/A'}
                            </p>
                        </div>
                        <div className="bg-white rounded-lg p-3 border border-gray-200">
                            <p className="font-semibold text-gray-700 mb-1">Next Cleanup</p>
                            <p className="text-gray-600">
                                {stats.nextCleanup ? new Date(stats.nextCleanup).toLocaleString() : 'N/A'}
                            </p>
                        </div>
                    </div>
                </div>
            )}

            {/* Controls */}
            <div className="card">
                <div className="flex flex-col md:flex-row gap-4">
                    {/* Level Filter */}
                    <div className="flex items-center gap-2">
                        <Filter size={16} className="text-gray-500" />
                        <select
                            value={selectedLevel}
                            onChange={(e) => setSelectedLevel(e.target.value as LogLevel)}
                            className="input py-2 text-sm"
                        >
                            <option value="all">All Levels</option>
                            <option value="error">Errors Only</option>
                            <option value="warn">Warnings Only</option>
                            <option value="info">Info Only</option>
                            <option value="debug">Debug Only</option>
                        </select>
                    </div>

                    {/* Search */}
                    <div className="flex-1 relative">
                        <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                        <input
                            type="text"
                            placeholder="Search logs..."
                            value={searchTerm}
                            onChange={(e) => setSearchTerm(e.target.value)}
                            className="input pl-9 w-full"
                        />
                    </div>

                    {/* Auto Refresh Toggle */}
                    <button
                        onClick={() => setAutoRefresh(!autoRefresh)}
                        className={`btn ${autoRefresh ? 'btn-primary' : 'btn-secondary'} flex items-center gap-2`}
                    >
                        <RefreshCw size={16} className={autoRefresh ? 'animate-spin' : ''} />
                        {autoRefresh ? 'Auto-refresh ON' : 'Auto-refresh OFF'}
                    </button>

                    {/* Manual Refresh */}
                    <button
                        onClick={() => refetch()}
                        disabled={isLoading}
                        className="btn btn-secondary flex items-center gap-2"
                    >
                        <RefreshCw size={16} className={isLoading ? 'animate-spin' : ''} />
                        Refresh
                    </button>

                    {/* Clear Logs */}
                    <button
                        onClick={handleClearLogs}
                        disabled={clearLogsMutation.isPending}
                        className="btn bg-red-100 text-red-700 hover:bg-red-200 flex items-center gap-2"
                    >
                        <Trash2 size={16} />
                        Clear
                    </button>
                </div>
            </div>

            {/* Logs Display */}
            <div className="card">
                <div className="flex items-center justify-between mb-4">
                    <div className="flex items-center gap-2">
                        <Terminal size={20} className="text-primary-600" />
                        <h2 className="text-lg font-semibold">Server Logs</h2>
                        {logsData && (
                            <span className="text-sm text-gray-500">
                                ({logsData.logs.length} / {logsData.total} shown)
                            </span>
                        )}
                    </div>
                    {autoRefresh && (
                        <div className="flex items-center gap-2 text-xs text-green-600">
                            <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse"></div>
                            Live
                        </div>
                    )}
                </div>

                {/* Log Entries */}
                <div className="bg-gray-900 rounded-lg p-4 font-mono text-sm overflow-auto min-h-[200px] max-h-[600px]">
                    {isLoading && !logsData && (
                        <div className="flex justify-center items-center h-32">
                            <RefreshCw size={24} className="animate-spin text-gray-500" />
                        </div>
                    )}

                    {!isLoading && logsData?.logs.length === 0 && (
                        <div className="text-center text-gray-500 py-8">
                            <AlertCircle size={32} className="mx-auto mb-2 opacity-50" />
                            <p>No logs found</p>
                            {searchTerm && (
                                <p className="text-xs mt-1">Try a different search term</p>
                            )}
                        </div>
                    )}

                    {logsData?.logs && logsData.logs.length > 0 && (
                        <div className="space-y-2">
                            {logsData.logs.map((log: LogEntry, index: number) => (
                                <div
                                    key={log.id || `log-${index}`}
                                    className="flex gap-3 hover:bg-gray-800 p-2 rounded transition-colors"
                                >
                                    {/* Timestamp */}
                                    <span className="text-gray-500 flex-shrink-0 text-xs">
                                        {formatTimestamp(log.timestamp)}
                                    </span>

                                    {/* Level Badge */}
                                    <span className={`flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium flex-shrink-0 border ${getLevelColor(log.level)}`}>
                                        {getLevelIcon(log.level)}
                                        {log.level.toUpperCase()}
                                    </span>

                                    {/* Message */}
                                    <div className="flex-1 min-w-0">
                                        <p className="text-gray-100 break-words whitespace-pre-wrap">
                                            {log.message}
                                        </p>
                                        {log.context && Object.keys(log.context).length > 0 && (
                                            <details className="mt-1">
                                                <summary className="text-xs text-gray-400 cursor-pointer hover:text-gray-300">
                                                    Context
                                                </summary>
                                                <pre className="text-xs text-gray-400 mt-1 bg-gray-950 p-2 rounded overflow-x-auto">
                                                    {JSON.stringify(log.context, null, 2)}
                                                </pre>
                                            </details>
                                        )}
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            </div>

            {/* Info Banner */}
            <div className="p-4 bg-blue-50 border border-blue-200 rounded-lg">
                <div className="flex items-start gap-3">
                    <Info size={20} className="text-blue-600 flex-shrink-0 mt-0.5" />
                    <div className="text-sm text-blue-800">
                        <p className="font-medium mb-1">About Server Logs</p>
                        <ul className="list-disc list-inside space-y-1 text-xs">
                            <li>Logs persist across server restarts (file-based storage)</li>
                            <li>24-hour retention with automatic cleanup every hour</li>
                            <li>Maximum capacity: 50,000 log entries (circular buffer)</li>
                            <li>Auto-refresh updates every 3 seconds when enabled</li>
                            <li>Use search to filter by message content or context data</li>
                        </ul>
                    </div>
                </div>
            </div>
        </div>
    );
}

export default ServerLogsTab;
