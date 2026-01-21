/**
 * InspectorTab component
 * Database inspector with dynamic table views - shows ALL tables automatically
 * Features: live table counts, column auto-detection, smart value formatting
 *
 * Uses Server Functions for data fetching.
 */

import { useState, useEffect } from 'react';
import { getTables, inspectTable, type TableInfo } from '../../../server/functions/admin';
import { Database, Eye, RefreshCw, Table2, Layers, Search } from 'lucide-react';

export function InspectorTab() {
    const [tables, setTables] = useState<TableInfo[]>([]);
    const [tablesLoading, setTablesLoading] = useState(true);
    const [selectedTable, setSelectedTable] = useState<string>('');
    const [tableSearch, setTableSearch] = useState('');
    const [inspectorLimit, setInspectorLimit] = useState(100);
    const [inspectorData, setInspectorData] = useState<any>(null);
    const [inspectorLoading, setInspectorLoading] = useState(false);

    // Fetch all tables on mount
    useEffect(() => {
        const fetchTablesData = async () => {
            try {
                const result = await getTables();
                if (result.success && result.data) {
                    setTables(result.data.tables || []);
                    // Select Order table by default if available
                    const orderTable = result.data.tables?.find((t: TableInfo) => t.name === 'order');
                    if (orderTable) {
                        setSelectedTable('order');
                    } else if (result.data.tables?.length > 0) {
                        setSelectedTable(result.data.tables[0].name);
                    }
                }
            } catch (err) {
                console.error('Failed to fetch tables:', err);
            } finally {
                setTablesLoading(false);
            }
        };
        fetchTablesData();
    }, []);

    const fetchData = async () => {
        if (!selectedTable) return;
        setInspectorLoading(true);
        try {
            const result = await inspectTable({
                data: { tableName: selectedTable, limit: inspectorLimit, offset: 0 },
            }) as { success: boolean; data?: { data: unknown[]; total: number; table: string }; error?: { message: string } };
            if (result.success && result.data) {
                setInspectorData(result.data);
            } else {
                alert(result.error?.message || 'Failed to fetch data');
            }
        } catch (err) {
            console.error(err);
            alert('Failed to fetch data');
        } finally {
            setInspectorLoading(false);
        }
    };

    const refreshTables = async () => {
        setTablesLoading(true);
        try {
            const result = await getTables();
            if (result.success && result.data) {
                setTables(result.data.tables || []);
            }
        } catch (err) {
            console.error('Failed to refresh tables:', err);
        } finally {
            setTablesLoading(false);
        }
    };

    const selectedTableInfo = tables.find(t => t.name === selectedTable);
    const filteredTables = tableSearch
        ? tables.filter(t => t.displayName.toLowerCase().includes(tableSearch.toLowerCase()))
        : tables;

    const totalRecords = tables.reduce((sum, t) => sum + t.count, 0);

    return (
        <div className="space-y-6">
            {/* Header Card */}
            <div className="bg-gradient-to-br from-slate-800 to-slate-900 rounded-xl p-6 text-white shadow-lg">
                <div className="flex items-center justify-between">
                    <div className="flex items-center gap-4">
                        <div className="p-3 bg-white/10 rounded-lg backdrop-blur">
                            <Database size={24} />
                        </div>
                        <div>
                            <h2 className="text-xl font-semibold">Database Inspector</h2>
                            <p className="text-slate-400 text-sm mt-0.5">
                                Browse and inspect all database tables
                            </p>
                        </div>
                    </div>
                    <div className="flex items-center gap-6">
                        <div className="text-right">
                            <div className="text-2xl font-bold">{tables.length}</div>
                            <div className="text-xs text-slate-400 uppercase tracking-wider">Tables</div>
                        </div>
                        <div className="w-px h-10 bg-slate-600" />
                        <div className="text-right">
                            <div className="text-2xl font-bold">{totalRecords.toLocaleString()}</div>
                            <div className="text-xs text-slate-400 uppercase tracking-wider">Total Records</div>
                        </div>
                        <button
                            onClick={refreshTables}
                            disabled={tablesLoading}
                            className="p-2 rounded-lg bg-white/10 hover:bg-white/20 transition-colors disabled:opacity-50"
                            title="Refresh table list"
                        >
                            <RefreshCw size={18} className={tablesLoading ? 'animate-spin' : ''} />
                        </button>
                    </div>
                </div>
            </div>

            <div className="grid grid-cols-12 gap-6">
                {/* Table Selector Sidebar */}
                <div className="col-span-3">
                    <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
                        <div className="px-4 py-3 border-b border-gray-100 bg-gray-50">
                            <div className="flex items-center gap-2 text-sm font-medium text-gray-700">
                                <Layers size={16} />
                                Select Table
                            </div>
                        </div>

                        {/* Search */}
                        <div className="p-3 border-b border-gray-100">
                            <div className="relative">
                                <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                                <input
                                    type="text"
                                    placeholder="Search tables..."
                                    value={tableSearch}
                                    onChange={(e) => setTableSearch(e.target.value)}
                                    className="w-full pl-9 pr-3 py-2 text-sm border border-gray-200 rounded-lg focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 outline-none"
                                />
                            </div>
                        </div>

                        {/* Table List */}
                        <div className="max-h-[500px] overflow-y-auto">
                            {tablesLoading ? (
                                <div className="p-4 text-center text-gray-400">
                                    <RefreshCw size={20} className="animate-spin mx-auto mb-2" />
                                    Loading tables...
                                </div>
                            ) : filteredTables.length === 0 ? (
                                <div className="p-4 text-center text-gray-400 text-sm">
                                    No tables found
                                </div>
                            ) : (
                                <div className="divide-y divide-gray-100">
                                    {filteredTables.map((table) => (
                                        <button
                                            key={table.name}
                                            onClick={() => {
                                                setSelectedTable(table.name);
                                                setInspectorData(null);
                                            }}
                                            className={`w-full flex items-center justify-between px-4 py-2.5 text-left transition-colors ${
                                                selectedTable === table.name
                                                    ? 'bg-blue-50 border-l-2 border-l-blue-500'
                                                    : 'hover:bg-gray-50 border-l-2 border-l-transparent'
                                            }`}
                                        >
                                            <div className="flex items-center gap-2">
                                                <Table2 size={14} className={selectedTable === table.name ? 'text-blue-600' : 'text-gray-400'} />
                                                <span className={`text-sm ${selectedTable === table.name ? 'font-medium text-blue-700' : 'text-gray-700'}`}>
                                                    {table.displayName}
                                                </span>
                                            </div>
                                            <span className={`text-xs px-2 py-0.5 rounded-full ${
                                                selectedTable === table.name
                                                    ? 'bg-blue-100 text-blue-700'
                                                    : 'bg-gray-100 text-gray-500'
                                            }`}>
                                                {table.count.toLocaleString()}
                                            </span>
                                        </button>
                                    ))}
                                </div>
                            )}
                        </div>
                    </div>
                </div>

                {/* Data Panel */}
                <div className="col-span-9">
                    <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
                        {/* Toolbar */}
                        <div className="px-4 py-3 border-b border-gray-100 bg-gray-50 flex items-center justify-between">
                            <div className="flex items-center gap-3">
                                <div className="flex items-center gap-2">
                                    <Table2 size={16} className="text-gray-500" />
                                    <span className="font-medium text-gray-700">
                                        {selectedTableInfo?.displayName || 'Select a table'}
                                    </span>
                                    {selectedTableInfo && (
                                        <span className="text-xs text-gray-400">
                                            ({selectedTableInfo.count.toLocaleString()} records)
                                        </span>
                                    )}
                                </div>
                            </div>
                            <div className="flex items-center gap-2">
                                <select
                                    value={inspectorLimit}
                                    onChange={(e) => setInspectorLimit(Number(e.target.value))}
                                    className="text-sm border border-gray-200 rounded-lg px-3 py-1.5 bg-white focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 outline-none"
                                >
                                    <option value={50}>50 rows</option>
                                    <option value={100}>100 rows</option>
                                    <option value={250}>250 rows</option>
                                    <option value={500}>500 rows</option>
                                    <option value={1000}>1,000 rows</option>
                                    <option value={2000}>2,000 rows</option>
                                </select>
                                <button
                                    className="flex items-center gap-2 px-4 py-1.5 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                                    onClick={fetchData}
                                    disabled={inspectorLoading || !selectedTable}
                                >
                                    <Eye size={15} />
                                    {inspectorLoading ? 'Loading...' : 'Fetch Data'}
                                </button>
                            </div>
                        </div>

                        {/* Data Content */}
                        {inspectorData ? (
                            <div>
                                <div className="px-4 py-2 bg-gray-50/50 border-b border-gray-100 flex items-center justify-between text-sm">
                                    <span className="text-gray-600">
                                        Showing <span className="font-medium">{inspectorData.data?.length || 0}</span> of{' '}
                                        <span className="font-medium">{inspectorData.total || 0}</span> records
                                        {inspectorData.data?.length > 0 && (
                                            <span className="text-gray-400 ml-2">
                                                • {getAllKeys(inspectorData.data).length} columns
                                            </span>
                                        )}
                                    </span>
                                    <button
                                        className="text-red-500 hover:text-red-600 text-sm"
                                        onClick={() => setInspectorData(null)}
                                    >
                                        Clear
                                    </button>
                                </div>
                                <div className="max-h-[600px] overflow-auto">
                                    <InspectorTable data={inspectorData.data} />
                                </div>
                            </div>
                        ) : (
                            <div className="p-12 text-center">
                                <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-gray-100 flex items-center justify-center">
                                    <Eye size={24} className="text-gray-400" />
                                </div>
                                <h3 className="text-gray-700 font-medium mb-1">No Data Loaded</h3>
                                <p className="text-gray-500 text-sm max-w-xs mx-auto">
                                    Select a table from the sidebar and click "Fetch Data" to inspect records.
                                </p>
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
}

// Format cell value for display
function formatCellValue(value: any, key: string): React.ReactNode {
    if (value === null || value === undefined) return <span className="text-gray-300">—</span>;

    // Handle booleans
    if (typeof value === 'boolean') {
        return value
            ? <span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-green-100 text-green-600 text-xs">✓</span>
            : <span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-red-100 text-red-500 text-xs">✗</span>;
    }

    // Handle dates
    if (key.toLowerCase().includes('at') || key.toLowerCase().includes('date')) {
        const date = new Date(value);
        if (!isNaN(date.getTime())) {
            return (
                <span className="whitespace-nowrap text-gray-600">
                    {date.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: '2-digit' })}
                    <span className="text-gray-400 ml-1">
                        {date.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}
                    </span>
                </span>
            );
        }
    }

    // Handle IDs (show truncated)
    if (key === 'id' && typeof value === 'string' && value.length > 20) {
        return (
            <span className="font-mono text-xs bg-gray-100 px-1.5 py-0.5 rounded" title={value}>
                {value.slice(0, 8)}…
            </span>
        );
    }

    // Handle foreign key IDs
    if (key.endsWith('Id') && typeof value === 'string' && value.length > 20) {
        return (
            <span className="font-mono text-xs bg-purple-50 text-purple-600 px-1.5 py-0.5 rounded" title={value}>
                {value.slice(0, 8)}…
            </span>
        );
    }

    // Handle objects (nested data)
    if (typeof value === 'object') {
        if (Array.isArray(value)) {
            return (
                <span className="text-xs bg-blue-50 text-blue-600 px-1.5 py-0.5 rounded">
                    [{value.length}]
                </span>
            );
        }
        const preview = JSON.stringify(value).slice(0, 40);
        return (
            <span
                className="text-purple-600 font-mono text-xs bg-purple-50 px-1.5 py-0.5 rounded cursor-help"
                title={JSON.stringify(value, null, 2)}
            >
                {preview}{preview.length >= 40 ? '…' : ''}
            </span>
        );
    }

    // Handle numbers (format currency-like fields)
    if (typeof value === 'number') {
        if (key.toLowerCase().includes('amount') || key.toLowerCase().includes('price') || key.toLowerCase().includes('cost') || key.toLowerCase().includes('mrp') || key.toLowerCase().includes('spent') || key.toLowerCase().includes('balance')) {
            return <span className="font-mono text-emerald-600">₹{value.toLocaleString()}</span>;
        }
        return <span className="font-mono">{value.toLocaleString()}</span>;
    }

    // Handle status fields
    if (key === 'status' || key === 'lineStatus' || key === 'trackingStatus') {
        const statusColors: Record<string, string> = {
            open: 'bg-amber-100 text-amber-700',
            pending: 'bg-amber-100 text-amber-700',
            shipped: 'bg-blue-100 text-blue-700',
            delivered: 'bg-green-100 text-green-700',
            cancelled: 'bg-red-100 text-red-700',
            completed: 'bg-green-100 text-green-700',
            running: 'bg-blue-100 text-blue-700',
            failed: 'bg-red-100 text-red-700',
            allocated: 'bg-purple-100 text-purple-700',
            picked: 'bg-cyan-100 text-cyan-700',
            packed: 'bg-emerald-100 text-emerald-700',
        };
        const color = statusColors[value] || 'bg-gray-100 text-gray-700';
        return <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${color}`}>{value}</span>;
    }

    // Default: show as string (truncated if too long)
    const str = String(value);
    if (str.length > 80) {
        return <span title={str} className="cursor-help">{str.slice(0, 80)}…</span>;
    }
    return str;
}

// Get all unique keys from data array
function getAllKeys(data: any[]): string[] {
    const keySet = new Set<string>();
    for (const row of data) {
        for (const key of Object.keys(row)) {
            keySet.add(key);
        }
    }
    // Sort keys to put important ones first
    const priorityKeys = ['id', 'orderNumber', 'name', 'skuCode', 'email', 'status', 'lineStatus'];
    const sorted = Array.from(keySet).sort((a, b) => {
        const aIndex = priorityKeys.indexOf(a);
        const bIndex = priorityKeys.indexOf(b);
        if (aIndex !== -1 && bIndex !== -1) return aIndex - bIndex;
        if (aIndex !== -1) return -1;
        if (bIndex !== -1) return 1;
        // Put timestamps at the end
        if (a.includes('At') || a.includes('Date')) return 1;
        if (b.includes('At') || b.includes('Date')) return -1;
        return a.localeCompare(b);
    });
    return sorted;
}

// Inspector Table component for table view - shows ALL columns dynamically
function InspectorTable({ data }: { data: any[] }) {
    if (!data || data.length === 0) {
        return (
            <div className="p-8 text-center text-gray-400">
                <Table2 size={32} className="mx-auto mb-2 opacity-50" />
                <p>No records found</p>
            </div>
        );
    }

    // Get all unique keys from the data
    const columns = getAllKeys(data);

    return (
        <table className="w-full text-sm">
            <thead className="bg-gray-50 sticky top-0 z-10">
                <tr>
                    <th className="px-3 py-2.5 text-left font-semibold text-gray-500 text-xs uppercase tracking-wider border-b border-gray-200">
                        #
                    </th>
                    {columns.map((col) => (
                        <th
                            key={col}
                            className="px-3 py-2.5 text-left font-semibold text-gray-500 text-xs uppercase tracking-wider whitespace-nowrap border-b border-gray-200"
                        >
                            {col}
                        </th>
                    ))}
                </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
                {data.map((row, rowIndex) => (
                    <tr key={row.id || rowIndex} className="hover:bg-blue-50/30 transition-colors">
                        <td className="px-3 py-2 text-gray-400 text-xs font-mono">{rowIndex + 1}</td>
                        {columns.map((col) => (
                            <td key={col} className="px-3 py-2 text-gray-700 text-xs max-w-[300px]">
                                {formatCellValue(row[col], col)}
                            </td>
                        ))}
                    </tr>
                ))}
            </tbody>
        </table>
    );
}

export default InspectorTab;
