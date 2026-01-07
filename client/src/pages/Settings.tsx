/**
 * Settings page - Main tab container
 * Uses extracted tab components for maintainability
 */

import { useState } from 'react';
import {
    Store, Settings as SettingsIcon, FileSpreadsheet, Database, Eye, DollarSign
} from 'lucide-react';

// Tab components
import {
    GeneralTab,
    ShopifyTab,
    ImportExportTab,
    DatabaseTab,
    InspectorTab,
    RemittanceTab,
} from '../components/settings/tabs';

type SettingsTab = 'general' | 'shopify' | 'importExport' | 'remittance' | 'database' | 'inspector';

export default function Settings() {
    const [activeTab, setActiveTab] = useState<SettingsTab>('general');

    return (
        <div className="space-y-6">
            <h1 className="text-2xl font-bold text-gray-900">Settings</h1>

            {/* Tabs */}
            <div className="flex gap-2 border-b">
                <button
                    className={`px-4 py-2 font-medium flex items-center gap-2 ${
                        activeTab === 'general'
                            ? 'text-primary-600 border-b-2 border-primary-600'
                            : 'text-gray-500'
                    }`}
                    onClick={() => setActiveTab('general')}
                >
                    <SettingsIcon size={18} /> General
                </button>
                <button
                    className={`px-4 py-2 font-medium flex items-center gap-2 ${
                        activeTab === 'shopify'
                            ? 'text-primary-600 border-b-2 border-primary-600'
                            : 'text-gray-500'
                    }`}
                    onClick={() => setActiveTab('shopify')}
                >
                    <Store size={18} /> Shopify Integration
                </button>
                <button
                    className={`px-4 py-2 font-medium flex items-center gap-2 ${
                        activeTab === 'importExport'
                            ? 'text-primary-600 border-b-2 border-primary-600'
                            : 'text-gray-500'
                    }`}
                    onClick={() => setActiveTab('importExport')}
                >
                    <FileSpreadsheet size={18} /> CSV Import/Export
                </button>
                <button
                    className={`px-4 py-2 font-medium flex items-center gap-2 ${
                        activeTab === 'remittance'
                            ? 'text-primary-600 border-b-2 border-primary-600'
                            : 'text-gray-500'
                    }`}
                    onClick={() => setActiveTab('remittance')}
                >
                    <DollarSign size={18} /> COD Remittance
                </button>
                <button
                    className={`px-4 py-2 font-medium flex items-center gap-2 ${
                        activeTab === 'database'
                            ? 'text-primary-600 border-b-2 border-primary-600'
                            : 'text-gray-500'
                    }`}
                    onClick={() => setActiveTab('database')}
                >
                    <Database size={18} /> Database
                </button>
                <button
                    className={`px-4 py-2 font-medium flex items-center gap-2 ${
                        activeTab === 'inspector'
                            ? 'text-primary-600 border-b-2 border-primary-600'
                            : 'text-gray-500'
                    }`}
                    onClick={() => setActiveTab('inspector')}
                >
                    <Eye size={18} /> Data Inspector
                </button>
            </div>

            {/* Tab Content */}
            {activeTab === 'general' && <GeneralTab />}
            {activeTab === 'shopify' && <ShopifyTab />}
            {activeTab === 'importExport' && <ImportExportTab />}
            {activeTab === 'remittance' && <RemittanceTab />}
            {activeTab === 'database' && <DatabaseTab />}
            {activeTab === 'inspector' && <InspectorTab />}
        </div>
    );
}
