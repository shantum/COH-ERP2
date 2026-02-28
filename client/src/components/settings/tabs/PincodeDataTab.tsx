/**
 * PincodeDataTab component
 * Upload and manage pincode data for geographic analysis
 */

import { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import { pincodeApi } from '../../../services/api';
import { Upload, MapPin, Database } from 'lucide-react';

interface UploadStats {
    totalRows: number;
    uniquePincodes: number;
    inserted: number;
    uploadedAt: string;
}

export function PincodeDataTab() {
    const [uploadFile, setUploadFile] = useState<File | null>(null);
    const [uploadResult, setUploadResult] = useState<{ message: string; stats: UploadStats } | null>(null);

    // Fetch current stats
    const { data: stats, refetch: refetchStats } = useQuery({
        queryKey: ['pincode-stats'],
        queryFn: async () => {
            const res = await pincodeApi.getStats();
            return res.data as { totalPincodes: number; lastUploadedAt: string | null };
        },
    });

    const uploadMutation = useMutation({
        mutationFn: async () => {
            if (!uploadFile) throw new Error('No file selected');
            return pincodeApi.upload(uploadFile);
        },
        onSuccess: (res) => {
            setUploadResult(res.data);
            setUploadFile(null);
            refetchStats();
        },
        onError: (error: unknown) => {
            toast.error(error instanceof Error ? error.message : 'Upload failed');
        },
    });

    const formatDate = (dateStr: string | null) => {
        if (!dateStr) return 'Never';
        return new Date(dateStr).toLocaleString();
    };

    return (
        <div className="space-y-6">
            {/* Stats Card */}
            <div className="card">
                <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
                    <Database size={20} /> Pincode Database
                </h2>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="p-4 bg-blue-50 border border-blue-200 rounded-lg">
                        <div className="text-sm text-blue-600 font-medium">Total Pincodes</div>
                        <div className="text-2xl font-bold text-blue-900">{stats?.totalPincodes?.toLocaleString() || 0}</div>
                    </div>
                    <div className="p-4 bg-green-50 border border-green-200 rounded-lg">
                        <div className="text-sm text-green-600 font-medium">Last Updated</div>
                        <div className="text-lg font-semibold text-green-900">{formatDate(stats?.lastUploadedAt || null)}</div>
                    </div>
                </div>
            </div>

            {/* Upload Card */}
            <div className="card">
                <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
                    <Upload size={20} /> Upload Pincode Data
                </h2>

                <div className="max-w-xl space-y-4">
                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">CSV File</label>
                        <input
                            type="file"
                            accept=".csv"
                            className="input"
                            onChange={(e) => setUploadFile(e.target.files?.[0] || null)}
                        />
                    </div>

                    <button
                        className="btn btn-primary flex items-center gap-2"
                        onClick={() => uploadMutation.mutate()}
                        disabled={!uploadFile || uploadMutation.isPending}
                    >
                        <Upload size={16} />
                        {uploadMutation.isPending ? 'Uploading...' : 'Upload & Replace All Data'}
                    </button>

                    {/* Upload Result */}
                    {uploadResult && (
                        <div className="p-4 bg-green-50 border border-green-200 rounded-lg">
                            <p className="font-medium text-green-800 mb-2">{uploadResult.message}</p>
                            <div className="text-sm text-green-700 space-y-1">
                                <p>Total rows in CSV: {uploadResult.stats.totalRows.toLocaleString()}</p>
                                <p>Unique pincodes: {uploadResult.stats.uniquePincodes.toLocaleString()}</p>
                                <p>Inserted: {uploadResult.stats.inserted.toLocaleString()}</p>
                                <p>Uploaded at: {formatDate(uploadResult.stats.uploadedAt)}</p>
                            </div>
                        </div>
                    )}
                </div>

                <div className="mt-4 p-4 bg-blue-50 border border-blue-200 rounded-lg">
                    <p className="text-sm text-blue-800 font-medium mb-2 flex items-center gap-2">
                        <MapPin size={16} /> CSV Format Information
                    </p>
                    <ul className="text-sm text-blue-700 list-disc list-inside space-y-1">
                        <li>Required columns: <code className="bg-blue-100 px-1 rounded">pincode</code>, <code className="bg-blue-100 px-1 rounded">district</code>, <code className="bg-blue-100 px-1 rounded">state</code> (or <code className="bg-blue-100 px-1 rounded">statename</code>)</li>
                        <li>Optional columns: <code className="bg-blue-100 px-1 rounded">region</code>, <code className="bg-blue-100 px-1 rounded">regionname</code>, <code className="bg-blue-100 px-1 rounded">division</code>, <code className="bg-blue-100 px-1 rounded">divisionname</code></li>
                        <li>Duplicate pincodes will be automatically removed (first occurrence kept)</li>
                        <li>Upload replaces all existing pincode data (clean slate approach)</li>
                        <li>Other columns in CSV (like latitude, longitude) will be ignored</li>
                    </ul>
                </div>

                <div className="mt-4 p-4 bg-amber-50 border border-amber-200 rounded-lg">
                    <p className="text-sm text-amber-800 font-semibold mb-1">⚠️ Warning</p>
                    <p className="text-sm text-amber-700">
                        Uploading a new file will delete all existing pincode data. Make sure your CSV contains all pincodes you need.
                    </p>
                </div>
            </div>

            {/* Usage Info */}
            <div className="card">
                <h2 className="text-lg font-semibold mb-4">Usage</h2>
                <div className="prose prose-sm max-w-none">
                    <p className="text-gray-700">
                        Pincode data enables geographic analysis of orders by district and state. Once uploaded, the system can:
                    </p>
                    <ul className="text-gray-700 list-disc list-inside space-y-1 mt-2">
                        <li>Lookup district and state for any pincode</li>
                        <li>Generate district-wise and state-wise sales reports</li>
                        <li>Analyze order distribution across regions</li>
                        <li>Identify high-performing and underperforming areas</li>
                    </ul>
                    <p className="text-gray-600 text-sm mt-3">
                        Analytics features using this data will be added in future updates.
                    </p>
                </div>
            </div>
        </div>
    );
}

export default PincodeDataTab;
