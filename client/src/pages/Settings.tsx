/**
 * Settings page - Main tab container
 * Uses extracted tab components for maintainability
 */

import { useState } from 'react';
import {
    Store, Settings as SettingsIcon, FileSpreadsheet, Database, Eye, DollarSign, Terminal, Calculator, RefreshCw, PanelLeft, MapPin, Sheet
} from 'lucide-react';
import { useAuth } from '../hooks/useAuth';

// Tab components
import {
    GeneralTab,
    ShopifyTab,
    ImportExportTab,
    DatabaseTab,
    InspectorTab,
    RemittanceTab,
    ServerLogsTab,
    CostingTab,
    BackgroundJobsTab,
    SidebarTab,
    PincodeDataTab,
    SheetSyncTab,
} from '../components/settings/tabs';

type SettingsTab = 'general' | 'shopify' | 'importExport' | 'remittance' | 'costing' | 'database' | 'inspector' | 'logs' | 'jobs' | 'sidebar' | 'pincodes' | 'sheetSync';

export default function Settings() {
    const { user } = useAuth();
    const [activeTab, setActiveTab] = useState<SettingsTab>('general');

    return (
        <div className="space-y-4 md:space-y-6">
            <h1 className="text-xl md:text-2xl font-bold text-gray-900">Settings</h1>

            {/* Tabs */}
            <div className="flex gap-1 md:gap-2 border-b overflow-x-auto">
                <button
                    className={`px-3 md:px-4 py-2 font-medium flex items-center gap-1.5 md:gap-2 text-sm whitespace-nowrap ${
                        activeTab === 'general'
                            ? 'text-primary-600 border-b-2 border-primary-600'
                            : 'text-gray-500'
                    }`}
                    onClick={() => setActiveTab('general')}
                >
                    <SettingsIcon size={16} /> General
                </button>
                <button
                    className={`px-3 md:px-4 py-2 font-medium flex items-center gap-1.5 md:gap-2 text-sm whitespace-nowrap ${
                        activeTab === 'shopify'
                            ? 'text-primary-600 border-b-2 border-primary-600'
                            : 'text-gray-500'
                    }`}
                    onClick={() => setActiveTab('shopify')}
                >
                    <Store size={16} /> <span className="hidden sm:inline">Shopify</span><span className="sm:hidden">Shop</span>
                </button>
                <button
                    className={`px-3 md:px-4 py-2 font-medium flex items-center gap-1.5 md:gap-2 text-sm whitespace-nowrap ${
                        activeTab === 'importExport'
                            ? 'text-primary-600 border-b-2 border-primary-600'
                            : 'text-gray-500'
                    }`}
                    onClick={() => setActiveTab('importExport')}
                >
                    <FileSpreadsheet size={16} /> <span className="hidden sm:inline">CSV Import/Export</span><span className="sm:hidden">CSV</span>
                </button>
                <button
                    className={`px-3 md:px-4 py-2 font-medium flex items-center gap-1.5 md:gap-2 text-sm whitespace-nowrap ${
                        activeTab === 'remittance'
                            ? 'text-primary-600 border-b-2 border-primary-600'
                            : 'text-gray-500'
                    }`}
                    onClick={() => setActiveTab('remittance')}
                >
                    <DollarSign size={16} /> <span className="hidden sm:inline">COD Remittance</span><span className="sm:hidden">COD</span>
                </button>
                <button
                    className={`px-3 md:px-4 py-2 font-medium flex items-center gap-1.5 md:gap-2 text-sm whitespace-nowrap ${
                        activeTab === 'costing'
                            ? 'text-primary-600 border-b-2 border-primary-600'
                            : 'text-gray-500'
                    }`}
                    onClick={() => setActiveTab('costing')}
                >
                    <Calculator size={16} /> <span className="hidden sm:inline">Costing</span><span className="sm:hidden">Cost</span>
                </button>
                <button
                    className={`px-3 md:px-4 py-2 font-medium flex items-center gap-1.5 md:gap-2 text-sm whitespace-nowrap ${
                        activeTab === 'pincodes'
                            ? 'text-primary-600 border-b-2 border-primary-600'
                            : 'text-gray-500'
                    }`}
                    onClick={() => setActiveTab('pincodes')}
                >
                    <MapPin size={16} /> <span className="hidden sm:inline">Pincode Data</span><span className="sm:hidden">PIN</span>
                </button>
                <button
                    className={`px-3 md:px-4 py-2 font-medium flex items-center gap-1.5 md:gap-2 text-sm whitespace-nowrap ${
                        activeTab === 'database'
                            ? 'text-primary-600 border-b-2 border-primary-600'
                            : 'text-gray-500'
                    }`}
                    onClick={() => setActiveTab('database')}
                >
                    <Database size={16} /> <span className="hidden sm:inline">Database</span><span className="sm:hidden">DB</span>
                </button>
                <button
                    className={`px-3 md:px-4 py-2 font-medium flex items-center gap-1.5 md:gap-2 text-sm whitespace-nowrap ${
                        activeTab === 'inspector'
                            ? 'text-primary-600 border-b-2 border-primary-600'
                            : 'text-gray-500'
                    }`}
                    onClick={() => setActiveTab('inspector')}
                >
                    <Eye size={16} /> Inspector
                </button>
                <button
                    className={`px-3 md:px-4 py-2 font-medium flex items-center gap-1.5 md:gap-2 text-sm whitespace-nowrap ${
                        activeTab === 'logs'
                            ? 'text-primary-600 border-b-2 border-primary-600'
                            : 'text-gray-500'
                    }`}
                    onClick={() => setActiveTab('logs')}
                >
                    <Terminal size={16} /> <span className="hidden sm:inline">Server Logs</span><span className="sm:hidden">Logs</span>
                </button>
                <button
                    className={`px-3 md:px-4 py-2 font-medium flex items-center gap-1.5 md:gap-2 text-sm whitespace-nowrap ${
                        activeTab === 'jobs'
                            ? 'text-primary-600 border-b-2 border-primary-600'
                            : 'text-gray-500'
                    }`}
                    onClick={() => setActiveTab('jobs')}
                >
                    <RefreshCw size={16} /> <span className="hidden sm:inline">Background Jobs</span><span className="sm:hidden">Jobs</span>
                </button>
                {user?.role === 'admin' && (
                    <button
                        className={`px-3 md:px-4 py-2 font-medium flex items-center gap-1.5 md:gap-2 text-sm whitespace-nowrap ${
                            activeTab === 'sheetSync'
                                ? 'text-primary-600 border-b-2 border-primary-600'
                                : 'text-gray-500'
                        }`}
                        onClick={() => setActiveTab('sheetSync')}
                    >
                        <Sheet size={16} /> <span className="hidden sm:inline">Sheet Sync</span><span className="sm:hidden">Sync</span>
                    </button>
                )}
                {user?.role === 'admin' && (
                    <button
                        className={`px-3 md:px-4 py-2 font-medium flex items-center gap-1.5 md:gap-2 text-sm whitespace-nowrap ${
                            activeTab === 'sidebar'
                                ? 'text-primary-600 border-b-2 border-primary-600'
                                : 'text-gray-500'
                        }`}
                        onClick={() => setActiveTab('sidebar')}
                    >
                        <PanelLeft size={16} /> Sidebar
                    </button>
                )}
            </div>

            {/* Tab Content */}
            {activeTab === 'general' && <GeneralTab />}
            {activeTab === 'shopify' && <ShopifyTab />}
            {activeTab === 'importExport' && <ImportExportTab />}
            {activeTab === 'remittance' && <RemittanceTab />}
            {activeTab === 'costing' && <CostingTab />}
            {activeTab === 'pincodes' && <PincodeDataTab />}
            {activeTab === 'database' && <DatabaseTab />}
            {activeTab === 'inspector' && <InspectorTab />}
            {activeTab === 'logs' && <ServerLogsTab />}
            {activeTab === 'jobs' && <BackgroundJobsTab />}
            {activeTab === 'sheetSync' && <SheetSyncTab />}
            {activeTab === 'sidebar' && <SidebarTab />}
        </div>
    );
}
