/**
 * Settings page - Main tab container
 * Uses extracted tab components for maintainability
 */

import { useState } from 'react';
import type { LucideIcon } from 'lucide-react';
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

interface TabConfig {
    key: SettingsTab;
    icon: LucideIcon;
    label: string;
    shortLabel?: string;
    adminOnly?: boolean;
}

const tabs: TabConfig[] = [
    { key: 'general', icon: SettingsIcon, label: 'General' },
    { key: 'shopify', icon: Store, label: 'Shopify', shortLabel: 'Shop' },
    { key: 'importExport', icon: FileSpreadsheet, label: 'CSV Import/Export', shortLabel: 'CSV', adminOnly: true },
    { key: 'remittance', icon: DollarSign, label: 'COD Remittance', shortLabel: 'COD' },
    { key: 'costing', icon: Calculator, label: 'Costing', shortLabel: 'Cost' },
    { key: 'pincodes', icon: MapPin, label: 'Pincode Data', shortLabel: 'PIN' },
    { key: 'database', icon: Database, label: 'Database', shortLabel: 'DB' },
    { key: 'inspector', icon: Eye, label: 'Inspector' },
    { key: 'logs', icon: Terminal, label: 'Server Logs', shortLabel: 'Logs' },
    { key: 'jobs', icon: RefreshCw, label: 'Background Jobs', shortLabel: 'Jobs' },
    { key: 'sheetSync', icon: Sheet, label: 'Sheet Sync', shortLabel: 'Sync', adminOnly: true },
    { key: 'sidebar', icon: PanelLeft, label: 'Sidebar', adminOnly: true },
];

const tabComponents: Record<SettingsTab, React.ComponentType> = {
    general: GeneralTab,
    shopify: ShopifyTab,
    importExport: ImportExportTab,
    remittance: RemittanceTab,
    costing: CostingTab,
    pincodes: PincodeDataTab,
    database: DatabaseTab,
    inspector: InspectorTab,
    logs: ServerLogsTab,
    jobs: BackgroundJobsTab,
    sheetSync: SheetSyncTab,
    sidebar: SidebarTab,
};

export default function Settings() {
    const { user } = useAuth();
    const [activeTab, setActiveTab] = useState<SettingsTab>('general');
    const isAdmin = user?.role === 'admin' || user?.role === 'owner'
        || (user?.permissions?.includes('users:create') ?? false);

    const visibleTabs = tabs.filter(t => !t.adminOnly || isAdmin);
    const ActiveComponent = tabComponents[activeTab];

    return (
        <div className="space-y-4 md:space-y-6">
            <h1 className="text-xl md:text-2xl font-bold text-gray-900">Settings</h1>

            {/* Tabs */}
            <div className="flex gap-1 md:gap-2 border-b overflow-x-auto scrollbar-hide" role="tablist">
                {visibleTabs.map(tab => (
                    <button
                        key={tab.key}
                        role="tab"
                        aria-selected={activeTab === tab.key}
                        className={`px-3 md:px-4 py-2 font-medium flex items-center gap-1.5 md:gap-2 text-sm whitespace-nowrap transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-1 rounded-t-md ${
                            activeTab === tab.key
                                ? 'text-primary-600 border-b-2 border-primary-600'
                                : 'text-gray-500 hover:text-gray-700'
                        }`}
                        onClick={() => setActiveTab(tab.key)}
                    >
                        <tab.icon size={16} />
                        {tab.shortLabel ? (
                            <>
                                <span className="hidden sm:inline">{tab.label}</span>
                                <span className="sm:hidden">{tab.shortLabel}</span>
                            </>
                        ) : (
                            tab.label
                        )}
                    </button>
                ))}
            </div>

            {/* Tab Content */}
            <div role="tabpanel">
                <ActiveComponent />
            </div>
        </div>
    );
}
