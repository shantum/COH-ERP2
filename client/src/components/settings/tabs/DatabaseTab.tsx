/**
 * DatabaseTab component
 * Database statistics, danger zone for clearing data, and deployment guide
 *
 * Uses Server Functions for data fetching and mutations.
 */

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { getDatabaseStats, clearTables } from '../../../server/functions/admin';
import { Database, RefreshCw, AlertOctagon, Trash2 } from 'lucide-react';

export function DatabaseTab() {
    const queryClient = useQueryClient();
    const [clearConfirm, setClearConfirm] = useState('');
    const [selectedTables, setSelectedTables] = useState<string[]>([]);

    const { data: stats, isLoading: statsLoading } = useQuery({
        queryKey: ['dbStats'],
        queryFn: async () => {
            const result = await getDatabaseStats();
            if (!result.success || !result.data) {
                throw new Error(result.error?.message || 'Failed to fetch database stats');
            }
            return result.data;
        },
    });

    const clearMutation = useMutation({
        mutationFn: async () => {
            const result = await clearTables({
                data: { tables: selectedTables, confirmPhrase: clearConfirm },
            });
            if (!result.success) {
                throw new Error(result.error?.message || 'Failed to clear database');
            }
            return result.data;
        },
        onSuccess: (data) => {
            queryClient.invalidateQueries();
            setClearConfirm('');
            setSelectedTables([]);
            toast.success(`Database cleared! Deleted: ${JSON.stringify(data?.deleted)}`);
        },
        onError: (error: Error) => {
            toast.error(error.message || 'Failed to clear database');
        },
    });

    const tableOptions = [
        { id: 'orders', label: 'Orders & Order Lines', count: stats?.orders },
        { id: 'customers', label: 'Customers', count: stats?.customers },
        { id: 'products', label: 'Products, Variations & SKUs', count: stats?.products },
        { id: 'fabrics', label: 'Fabrics & Fabric Types', count: stats?.fabrics },
        { id: 'inventoryTransactions', label: 'Inventory Transactions', count: stats?.inventoryTransactions },
    ];

    const toggleTable = (id: string) => {
        if (id === 'all') {
            setSelectedTables(selectedTables.includes('all') ? [] : ['all']);
        } else {
            setSelectedTables(prev =>
                prev.includes(id) ? prev.filter(t => t !== id) : [...prev.filter(t => t !== 'all'), id]
            );
        }
    };

    return (
        <div className="space-y-6">
            {/* Database Stats */}
            <div className="card">
                <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
                    <Database size={20} /> Database Statistics
                </h2>

                {statsLoading ? (
                    <div className="flex justify-center p-4">
                        <RefreshCw size={24} className="animate-spin text-gray-400" />
                    </div>
                ) : (
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                        <div className="p-4 bg-gray-50 rounded-lg text-center">
                            <p className="text-2xl font-bold text-gray-900">{stats?.products || 0}</p>
                            <p className="text-sm text-gray-500">Products</p>
                        </div>
                        <div className="p-4 bg-gray-50 rounded-lg text-center">
                            <p className="text-2xl font-bold text-gray-900">{stats?.skus || 0}</p>
                            <p className="text-sm text-gray-500">SKUs</p>
                        </div>
                        <div className="p-4 bg-gray-50 rounded-lg text-center">
                            <p className="text-2xl font-bold text-gray-900">{stats?.orders || 0}</p>
                            <p className="text-sm text-gray-500">Orders</p>
                        </div>
                        <div className="p-4 bg-gray-50 rounded-lg text-center">
                            <p className="text-2xl font-bold text-gray-900">{stats?.customers || 0}</p>
                            <p className="text-sm text-gray-500">Customers</p>
                        </div>
                        <div className="p-4 bg-gray-50 rounded-lg text-center">
                            <p className="text-2xl font-bold text-gray-900">{stats?.fabrics || 0}</p>
                            <p className="text-sm text-gray-500">Fabrics</p>
                        </div>
                        <div className="p-4 bg-gray-50 rounded-lg text-center">
                            <p className="text-2xl font-bold text-gray-900">{stats?.variations || 0}</p>
                            <p className="text-sm text-gray-500">Variations</p>
                        </div>
                        <div className="p-4 bg-gray-50 rounded-lg text-center col-span-2">
                            <p className="text-2xl font-bold text-gray-900">{stats?.inventoryTransactions || 0}</p>
                            <p className="text-sm text-gray-500">Inventory Transactions</p>
                        </div>
                    </div>
                )}
            </div>

            {/* Danger Zone */}
            <div className="card border-2 border-red-200">
                <h2 className="text-lg font-semibold mb-4 flex items-center gap-2 text-red-700">
                    <AlertOctagon size={20} /> Danger Zone
                </h2>

                <p className="text-sm text-gray-600 mb-4">
                    Clear data from the database. This action cannot be undone. Select the tables you want to clear:
                </p>

                <div className="space-y-2 mb-4">
                    <label className="flex items-center gap-2 p-2 rounded hover:bg-red-50 cursor-pointer">
                        <input
                            type="checkbox"
                            checked={selectedTables.includes('all')}
                            onChange={() => toggleTable('all')}
                            className="rounded border-gray-300 text-red-600 focus:ring-red-500"
                        />
                        <span className="font-medium text-red-700">Clear ALL Data</span>
                    </label>
                    <div className="border-t pt-2 ml-4 space-y-1">
                        {tableOptions.map(table => (
                            <label key={table.id} className="flex items-center gap-2 p-1 rounded hover:bg-gray-50 cursor-pointer">
                                <input
                                    type="checkbox"
                                    checked={selectedTables.includes('all') || selectedTables.includes(table.id)}
                                    onChange={() => toggleTable(table.id)}
                                    disabled={selectedTables.includes('all')}
                                    className="rounded border-gray-300 text-red-600 focus:ring-red-500"
                                />
                                <span className="text-gray-700">{table.label}</span>
                                <span className="text-gray-400 text-sm">({table.count || 0})</span>
                            </label>
                        ))}
                    </div>
                </div>

                {selectedTables.length > 0 && (
                    <div className="bg-red-50 border border-red-200 rounded-lg p-4">
                        <p className="text-sm text-red-700 mb-3">
                            Type <code className="bg-red-100 px-1 rounded font-mono">DELETE ALL DATA</code> to confirm:
                        </p>
                        <input
                            type="text"
                            className="input mb-3"
                            placeholder="Type confirmation phrase..."
                            value={clearConfirm}
                            onChange={(e) => setClearConfirm(e.target.value)}
                        />
                        <button
                            className="btn bg-red-600 text-white hover:bg-red-700 flex items-center gap-2"
                            onClick={() => clearMutation.mutate()}
                            disabled={clearConfirm !== 'DELETE ALL DATA' || clearMutation.isPending}
                        >
                            <Trash2 size={16} />
                            {clearMutation.isPending ? 'Clearing...' : 'Clear Selected Data'}
                        </button>
                    </div>
                )}
            </div>

            {/* Deployment Info */}
            <div className="card">
                <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
                    <Database size={20} /> Deployment Guide
                </h2>

                <div className="prose prose-sm max-w-none">
                    <p className="text-gray-600 mb-4">
                        Current database: <code className="bg-gray-100 px-2 py-1 rounded">SQLite</code> (development only)
                    </p>

                    <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 mb-4">
                        <p className="font-medium text-blue-800 mb-2">For Production Deployment:</p>
                        <ol className="list-decimal list-inside text-sm text-blue-700 space-y-2">
                            <li><strong>Switch to PostgreSQL</strong> - Update <code>schema.prisma</code> provider and <code>DATABASE_URL</code></li>
                            <li><strong>Use a cloud database</strong> - Supabase, Neon, or PlanetScale</li>
                            <li><strong>Deploy backend</strong> - Hetzner, Render, or Fly.io</li>
                            <li><strong>Deploy frontend</strong> - Vercel, Netlify, or Cloudflare Pages</li>
                        </ol>
                    </div>

                    <div className="bg-gray-50 border border-gray-200 rounded-lg p-4">
                        <p className="font-medium text-gray-800 mb-2">Quick Steps to Switch to PostgreSQL:</p>
                        <pre className="text-xs bg-gray-800 text-gray-100 p-3 rounded overflow-x-auto">
{`# 1. Update prisma/schema.prisma
datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

# 2. Update .env
DATABASE_URL="postgresql://user:pass@host:5432/db"

# 3. Run migrations
npx prisma migrate dev --name init
npx prisma generate`}
                        </pre>
                    </div>
                </div>
            </div>
        </div>
    );
}

export default DatabaseTab;
