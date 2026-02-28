/**
 * Channels Dashboard Page
 *
 * Marketplace analytics dashboard for Myntra, Ajio, Nykaa orders.
 * Features:
 * - BT report CSV upload
 * - Revenue/Orders/AOV summary cards by channel
 * - Time series charts for revenue trends
 * - RTO/Return analytics
 * - Detailed orders table with filters
 */

import { useState, useMemo, useCallback } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useServerFn } from '@tanstack/react-start';
import { useNavigate } from '@tanstack/react-router';
import { Route } from '../routes/_authenticated/channels';
import { AgGridReact } from 'ag-grid-react';
import type { ColDef, ValueFormatterParams } from 'ag-grid-community';
import { AllCommunityModule, ModuleRegistry } from 'ag-grid-community';
import {
  Upload,
  TrendingUp,
  Package,
  ShoppingCart,
  DollarSign,
  RotateCcw,
  MapPin,
  BarChart3,
  FileText,
} from 'lucide-react';
import {
  getChannelSummary,
  getChannelTimeSeries,
  getChannelBreakdown,
  getChannelRTOAnalytics,
  getChannelOrders,
  getChannelFilterOptions,
  getImportHistory,
  getChannelTopProducts,
  getChannelTopStates,
  type ChannelOrderRow,
} from '../server/functions/channels';
import { channelQueryKeys } from '../constants/queryKeys';
import { compactThemeSmall } from '../utils/agGridHelpers';
import { getOptimizedImageUrl } from '../utils/imageOptimization';
import { Button } from '../components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../components/ui/tabs';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../components/ui/select';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card';
import { Badge } from '../components/ui/badge';
import { ChannelUploadModal } from '../components/channels/ChannelUploadModal';

ModuleRegistry.registerModules([AllCommunityModule]);

// ============================================
// TYPES
// ============================================

type TabValue = 'overview' | 'orders' | 'rto' | 'import';
type ChannelFilter = 'all' | 'myntra' | 'ajio' | 'nykaa';
type RangePreset = '7d' | '30d' | '90d' | 'mtd' | 'custom';

const CHANNEL_OPTIONS: { value: ChannelFilter; label: string; color: string }[] = [
  { value: 'all', label: 'All Channels', color: 'bg-gray-500' },
  { value: 'myntra', label: 'Myntra', color: 'bg-pink-500' },
  { value: 'ajio', label: 'Ajio', color: 'bg-orange-500' },
  { value: 'nykaa', label: 'Nykaa', color: 'bg-purple-500' },
];

const RANGE_OPTIONS: { value: RangePreset; label: string }[] = [
  { value: '7d', label: 'Last 7 days' },
  { value: '30d', label: 'Last 30 days' },
  { value: '90d', label: 'Last 90 days' },
  { value: 'mtd', label: 'Month to date' },
];

// ============================================
// HELPERS
// ============================================

function getDateRange(range: RangePreset, customStart?: string, customEnd?: string) {
  const now = new Date();
  let startDate: string;
  let endDate: string = now.toISOString().split('T')[0];

  switch (range) {
    case '7d':
      startDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
      break;
    case '30d':
      startDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
      break;
    case '90d':
      startDate = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
      break;
    case 'mtd':
      startDate = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split('T')[0];
      break;
    case 'custom':
      startDate = customStart || new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
      endDate = customEnd || endDate;
      break;
    default:
      startDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
  }

  return { startDate, endDate };
}

import { formatCurrency as _fmtShared, formatCurrencyFull } from '../utils/formatting';
function formatCurrency(value: number, compact = false): string {
  return compact ? _fmtShared(value) : formatCurrencyFull(value);
}

function formatNumber(value: number): string {
  return new Intl.NumberFormat('en-IN').format(value);
}

function getChannelColor(channel: string): string {
  switch (channel.toLowerCase()) {
    case 'myntra':
      return 'bg-pink-500';
    case 'ajio':
      return 'bg-orange-500';
    case 'nykaa':
      return 'bg-purple-500';
    default:
      return 'bg-gray-500';
  }
}

// ============================================
const DEFAULT_COL_DEF = {
  sortable: true,
  resizable: true,
  filter: true,
};

// MAIN COMPONENT
// ============================================

export default function Channels() {
  const navigate = useNavigate();
  const search = Route.useSearch();
  const { tab, channel, range, startDate, endDate, page, pageSize, sortBy, sortDir } = search;

  const [isUploadModalOpen, setIsUploadModalOpen] = useState(false);
  const [topProductsChannel, setTopProductsChannel] = useState<'all' | 'myntra' | 'ajio' | 'nykaa'>('all');

  // Calculate date range from preset
  const dateRange = useMemo(() => getDateRange(range, startDate, endDate), [range, startDate, endDate]);
  const channelParam = channel === 'all' ? undefined : channel;

  // Server functions
  const getChannelSummaryFn = useServerFn(getChannelSummary);
  const getChannelTimeSeriesFn = useServerFn(getChannelTimeSeries);
  const getChannelBreakdownFn = useServerFn(getChannelBreakdown);
  const getChannelRTOAnalyticsFn = useServerFn(getChannelRTOAnalytics);
  const getChannelOrdersFn = useServerFn(getChannelOrders);
  const getChannelFilterOptionsFn = useServerFn(getChannelFilterOptions);
  const getImportHistoryFn = useServerFn(getImportHistory);
  const getChannelTopProductsFn = useServerFn(getChannelTopProducts);
  const getChannelTopStatesFn = useServerFn(getChannelTopStates);

  // Queries
  const { data: summaryData, isLoading: isSummaryLoading } = useQuery({
    queryKey: channelQueryKeys.summary(channel, dateRange.startDate, dateRange.endDate),
    queryFn: () =>
      getChannelSummaryFn({
        data: {
          channel: channelParam,
          startDate: dateRange.startDate,
          endDate: dateRange.endDate,
        },
      }),
  });

  // Time series data - reserved for future chart implementation
  useQuery({
    queryKey: channelQueryKeys.timeSeries(channel, 'day', dateRange.startDate, dateRange.endDate),
    queryFn: () =>
      getChannelTimeSeriesFn({
        data: {
          channel: channelParam,
          startDate: dateRange.startDate,
          endDate: dateRange.endDate,
          groupBy: 'day',
        },
      }),
    enabled: tab === 'overview',
  });

  // Breakdown data - reserved for future chart implementation
  useQuery({
    queryKey: channelQueryKeys.breakdown(channel, 'channel', dateRange.startDate, dateRange.endDate),
    queryFn: () =>
      getChannelBreakdownFn({
        data: {
          channel: channelParam,
          startDate: dateRange.startDate,
          endDate: dateRange.endDate,
          groupBy: 'channel',
        },
      }),
    enabled: tab === 'overview',
  });

  const { data: rtoData } = useQuery({
    queryKey: channelQueryKeys.rtoAnalytics(channel, dateRange.startDate, dateRange.endDate),
    queryFn: () =>
      getChannelRTOAnalyticsFn({
        data: {
          channel: channelParam,
          startDate: dateRange.startDate,
          endDate: dateRange.endDate,
        },
      }),
    enabled: tab === 'overview' || tab === 'rto',
  });

  const { data: ordersData, isLoading: isOrdersLoading } = useQuery({
    queryKey: channelQueryKeys.orders({
      channel: channelParam,
      startDate: dateRange.startDate,
      endDate: dateRange.endDate,
      page,
      pageSize,
      sortBy,
      sortDir,
    }),
    queryFn: () =>
      getChannelOrdersFn({
        data: {
          channel: channelParam,
          startDate: dateRange.startDate,
          endDate: dateRange.endDate,
          page,
          pageSize,
          sortBy,
          sortDir,
        },
      }),
    enabled: tab === 'orders',
  });

  // Filter options - reserved for future advanced filtering
  useQuery({
    queryKey: channelQueryKeys.filterOptions,
    queryFn: () => getChannelFilterOptionsFn(),
  });

  const { data: importHistory } = useQuery({
    queryKey: channelQueryKeys.importHistory,
    queryFn: () => getImportHistoryFn(),
    enabled: tab === 'import',
  });

  // Top products with local channel filter (independent of main filter)
  const topProductsChannelParam = topProductsChannel === 'all' ? undefined : topProductsChannel;
  const { data: topProducts } = useQuery({
    queryKey: ['channels', 'topProducts', topProductsChannel, dateRange.startDate, dateRange.endDate],
    queryFn: () =>
      getChannelTopProductsFn({
        data: {
          channel: topProductsChannelParam,
          startDate: dateRange.startDate,
          endDate: dateRange.endDate,
          limit: 10,
          groupBy: 'variation',
        },
      }),
    enabled: tab === 'overview',
  });

  const { data: topStates } = useQuery({
    queryKey: channelQueryKeys.topStates(channel, dateRange.startDate, dateRange.endDate),
    queryFn: () =>
      getChannelTopStatesFn({
        data: {
          channel: channelParam,
          startDate: dateRange.startDate,
          endDate: dateRange.endDate,
          limit: 10,
        },
      }),
    enabled: tab === 'overview',
  });

  // Navigation handlers
  const handleTabChange = useCallback(
    (newTab: string) => {
      navigate({
        to: '/channels',
        search: { ...search, tab: newTab as TabValue },
      });
    },
    [navigate, search]
  );

  const handleChannelChange = useCallback(
    (newChannel: string) => {
      navigate({
        to: '/channels',
        search: { ...search, channel: newChannel as ChannelFilter },
      });
    },
    [navigate, search]
  );

  const handleRangeChange = useCallback(
    (newRange: string) => {
      navigate({
        to: '/channels',
        search: { ...search, range: newRange as RangePreset },
      });
    },
    [navigate, search]
  );

  // Column definitions for orders table
  const columnDefs: ColDef<ChannelOrderRow>[] = useMemo(
    () => [
      // Order Info
      {
        field: 'orderDate',
        headerName: 'Order Date',
        width: 145,
        valueFormatter: (params: ValueFormatterParams) =>
          params.value ? new Date(params.value).toLocaleString('en-IN', {
            day: '2-digit', month: 'short', year: '2-digit', hour: '2-digit', minute: '2-digit'
          }) : '',
      },
      {
        field: 'channel',
        headerName: 'Channel',
        width: 85,
        cellRenderer: (params: { value: string }) => (
          <Badge className={`${getChannelColor(params.value)} text-white text-xs`}>
            {params.value}
          </Badge>
        ),
      },
      {
        field: 'channelOrderId',
        headerName: 'Order ID',
        width: 130,
      },
      {
        field: 'channelRef',
        headerName: 'Ch. Ref',
        width: 120,
      },
      {
        field: 'invoiceNumber',
        headerName: 'Invoice #',
        width: 110,
      },
      // Product Info
      {
        field: 'skuCode',
        headerName: 'SKU',
        width: 100,
      },
      {
        field: 'productName',
        headerName: 'Product',
        width: 150,
        cellClass: 'truncate',
      },
      {
        field: 'variationColor',
        headerName: 'Color',
        width: 100,
      },
      {
        field: 'size',
        headerName: 'Size',
        width: 60,
      },
      // Pricing
      {
        field: 'quantity',
        headerName: 'Qty',
        width: 55,
        cellClass: 'text-right',
        headerClass: 'ag-right-aligned-header',
      },
      {
        field: 'shopifyMrp',
        headerName: 'MRP',
        width: 85,
        valueFormatter: (params: ValueFormatterParams) =>
          params.value ? formatCurrency(params.value / 100) : '-',
        cellClass: 'text-right text-muted-foreground',
        headerClass: 'ag-right-aligned-header',
      },
      {
        field: 'buyerPrice',
        headerName: 'Sell Price',
        width: 95,
        valueFormatter: (params: ValueFormatterParams) =>
          params.value ? formatCurrency(params.value / 100) : '',
        cellClass: 'text-right',
        headerClass: 'ag-right-aligned-header',
      },
      {
        field: 'itemTotal',
        headerName: 'Total',
        width: 95,
        valueFormatter: (params: ValueFormatterParams) =>
          params.value ? formatCurrency(params.value / 100) : '',
        cellClass: 'text-right font-medium',
        headerClass: 'ag-right-aligned-header',
      },
      {
        field: 'discountPercent',
        headerName: 'Disc %',
        width: 70,
        valueFormatter: (params: ValueFormatterParams) =>
          params.value != null ? `${params.value}%` : '',
        cellClass: (params) => {
          const val = params.value;
          if (val == null) return 'text-right';
          if (val >= 20) return 'text-right text-green-600 font-medium';
          if (val >= 10) return 'text-right text-amber-600';
          return 'text-right';
        },
        headerClass: 'ag-right-aligned-header',
      },
      // Customer
      {
        field: 'customerName',
        headerName: 'Customer',
        width: 130,
        cellClass: 'truncate',
      },
      {
        field: 'customerState',
        headerName: 'State',
        width: 100,
      },
      {
        field: 'orderType',
        headerName: 'Payment',
        width: 85,
        cellRenderer: (params: { value: string }) => (
          <Badge variant={params.value === 'COD' ? 'outline' : 'secondary'} className="text-xs">
            {params.value}
          </Badge>
        ),
      },
      // Status
      {
        field: 'fulfillmentStatus',
        headerName: 'Status',
        width: 110,
      },
      // Date Milestones
      {
        field: 'dispatchDate',
        headerName: 'Dispatched',
        width: 95,
        valueFormatter: (params: ValueFormatterParams) =>
          params.value ? new Date(params.value).toLocaleDateString('en-IN') : '',
      },
      {
        field: 'manifestedDate',
        headerName: 'Manifested',
        width: 95,
        valueFormatter: (params: ValueFormatterParams) =>
          params.value ? new Date(params.value).toLocaleDateString('en-IN') : '',
      },
      {
        field: 'deliveryDate',
        headerName: 'Delivered',
        width: 95,
        valueFormatter: (params: ValueFormatterParams) =>
          params.value ? new Date(params.value).toLocaleDateString('en-IN') : '',
      },
      // Tracking
      {
        field: 'courierName',
        headerName: 'Courier',
        width: 100,
      },
      {
        field: 'trackingNumber',
        headerName: 'AWB',
        width: 130,
      },
    ],
    []
  );

  return (
    <div className="flex flex-col h-full p-4 gap-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Marketplace Analytics</h1>
          <p className="text-sm text-muted-foreground">
            Revenue and order analytics for marketplace channels
          </p>
        </div>
        <div className="flex items-center gap-3">
          {/* Channel filter */}
          <Select value={channel} onValueChange={handleChannelChange}>
            <SelectTrigger className="w-[160px]">
              <SelectValue placeholder="Select channel" />
            </SelectTrigger>
            <SelectContent>
              {CHANNEL_OPTIONS.map((opt) => (
                <SelectItem key={opt.value} value={opt.value}>
                  <div className="flex items-center gap-2">
                    <div className={`w-2 h-2 rounded-full ${opt.color}`} />
                    {opt.label}
                  </div>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          {/* Date range filter */}
          <Select value={range} onValueChange={handleRangeChange}>
            <SelectTrigger className="w-[150px]">
              <SelectValue placeholder="Select range" />
            </SelectTrigger>
            <SelectContent>
              {RANGE_OPTIONS.map((opt) => (
                <SelectItem key={opt.value} value={opt.value}>
                  {opt.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          {/* Upload button */}
          <Button onClick={() => setIsUploadModalOpen(true)}>
            <Upload className="w-4 h-4 mr-2" />
            Import BT Report
          </Button>
        </div>
      </div>

      {/* Tabs */}
      <Tabs value={tab} onValueChange={handleTabChange} className="flex-1 flex flex-col">
        <TabsList>
          <TabsTrigger value="overview" className="gap-1.5">
            <BarChart3 className="w-4 h-4" />
            Overview
          </TabsTrigger>
          <TabsTrigger value="orders" className="gap-1.5">
            <ShoppingCart className="w-4 h-4" />
            Orders
          </TabsTrigger>
          <TabsTrigger value="rto" className="gap-1.5">
            <RotateCcw className="w-4 h-4" />
            RTO Analytics
          </TabsTrigger>
          <TabsTrigger value="import" className="gap-1.5">
            <FileText className="w-4 h-4" />
            Import History
          </TabsTrigger>
        </TabsList>

        {/* Overview Tab */}
        <TabsContent value="overview" className="flex-1 overflow-auto">
          <div className="space-y-4">
            {/* Summary Cards */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
              <Card>
                <CardHeader className="flex flex-row items-center justify-between pb-2">
                  <CardTitle className="text-sm font-medium">Total Revenue</CardTitle>
                  <DollarSign className="h-4 w-4 text-muted-foreground" />
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold">
                    {isSummaryLoading ? '...' : formatCurrency(summaryData?.totalRevenue || 0, true)}
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {dateRange.startDate} to {dateRange.endDate}
                  </p>
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="flex flex-row items-center justify-between pb-2">
                  <CardTitle className="text-sm font-medium">Total Orders</CardTitle>
                  <ShoppingCart className="h-4 w-4 text-muted-foreground" />
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold">
                    {isSummaryLoading ? '...' : formatNumber(summaryData?.totalOrders || 0)}
                  </div>
                  <p className="text-xs text-muted-foreground">Order lines imported</p>
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="flex flex-row items-center justify-between pb-2">
                  <CardTitle className="text-sm font-medium">Units Sold</CardTitle>
                  <Package className="h-4 w-4 text-muted-foreground" />
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold">
                    {isSummaryLoading ? '...' : formatNumber(summaryData?.totalUnits || 0)}
                  </div>
                  <p className="text-xs text-muted-foreground">Total quantity</p>
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="flex flex-row items-center justify-between pb-2">
                  <CardTitle className="text-sm font-medium">Avg Order Value</CardTitle>
                  <TrendingUp className="h-4 w-4 text-muted-foreground" />
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold">
                    {isSummaryLoading ? '...' : formatCurrency(summaryData?.avgOrderValue || 0)}
                  </div>
                  <p className="text-xs text-muted-foreground">Per order line</p>
                </CardContent>
              </Card>
            </div>

            {/* Channel Breakdown */}
            {summaryData?.byChannel && summaryData.byChannel.length > 0 && (
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Revenue by Channel</CardTitle>
                  <CardDescription>Breakdown across marketplace channels</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="space-y-4">
                    {summaryData.byChannel.map((ch) => {
                      const percent =
                        summaryData.totalRevenue > 0
                          ? (ch.revenue / summaryData.totalRevenue) * 100
                          : 0;
                      return (
                        <div key={ch.channel} className="space-y-2">
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2">
                              <div
                                className={`w-3 h-3 rounded-full ${getChannelColor(ch.channel)}`}
                              />
                              <span className="font-medium capitalize">{ch.channel}</span>
                            </div>
                            <div className="text-right">
                              <span className="font-medium">{formatCurrency(ch.revenue, true)}</span>
                              <span className="text-muted-foreground text-sm ml-2">
                                ({percent.toFixed(1)}%)
                              </span>
                            </div>
                          </div>
                          <div className="w-full bg-gray-100 rounded-full h-2">
                            <div
                              className={`h-2 rounded-full ${getChannelColor(ch.channel)}`}
                              style={{ width: `${percent}%` }}
                            />
                          </div>
                          <div className="flex justify-between text-xs text-muted-foreground">
                            <span>{formatNumber(ch.orders)} orders</span>
                            <span>{formatNumber(ch.units)} units</span>
                            <span>AOV: {formatCurrency(ch.aov)}</span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Two column layout for top products and states */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              {/* Top Products with Channel Tabs */}
              <Card>
                <CardHeader className="pb-2">
                  <div className="flex items-center justify-between">
                    <div>
                      <CardTitle className="text-base">Top Products</CardTitle>
                      <CardDescription>Best selling by revenue</CardDescription>
                    </div>
                  </div>
                  {/* Channel Tabs */}
                  <div className="flex gap-1 mt-2">
                    {(['all', 'myntra', 'ajio', 'nykaa'] as const).map((ch) => (
                      <button
                        key={ch}
                        onClick={() => setTopProductsChannel(ch)}
                        className={`px-3 py-1 text-xs rounded-full transition-colors ${
                          topProductsChannel === ch
                            ? ch === 'all'
                              ? 'bg-gray-800 text-white'
                              : ch === 'myntra'
                                ? 'bg-pink-500 text-white'
                                : ch === 'ajio'
                                  ? 'bg-orange-500 text-white'
                                  : 'bg-purple-500 text-white'
                            : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                        }`}
                      >
                        {ch === 'all' ? 'All' : ch.charAt(0).toUpperCase() + ch.slice(1)}
                      </button>
                    ))}
                  </div>
                </CardHeader>
                <CardContent>
                  {topProducts && topProducts.length > 0 ? (
                    <div className="space-y-3">
                      {topProducts.slice(0, 8).map((product, idx) => {
                        // Handle both variation and SKU response types
                        const isVariation = 'variationId' in product;
                        const key = isVariation ? product.variationId : product.skuCode;
                        const title = isVariation ? product.productName : product.skuCode;
                        const subtitle = isVariation ? product.colorName : product.skuTitle;
                        const imageUrl = isVariation ? product.imageUrl : null;

                        return (
                          <div
                            key={key}
                            className="flex items-center justify-between py-1.5 border-b last:border-0"
                          >
                            <div className="flex items-center gap-2.5">
                              <span className="text-muted-foreground text-sm w-5">{idx + 1}.</span>
                              {imageUrl && (
                                <img
                                  src={getOptimizedImageUrl(imageUrl, 'sm') || imageUrl}
                                  alt={title}
                                  className="w-10 h-10 object-cover rounded"
                                  loading="lazy"
                                />
                              )}
                              <div className="min-w-0">
                                <p className="font-medium text-sm truncate max-w-[180px]">
                                  {title}
                                </p>
                                {subtitle && (
                                  <p className="text-xs text-muted-foreground truncate max-w-[180px]">
                                    {subtitle}
                                  </p>
                                )}
                              </div>
                            </div>
                            <div className="text-right flex-shrink-0">
                              <p className="font-medium text-sm">{formatCurrency(product.revenue, true)}</p>
                              <p className="text-xs text-muted-foreground">{product.units} units</p>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                    <p className="text-sm text-muted-foreground text-center py-4">No data available</p>
                  )}
                </CardContent>
              </Card>

              {/* Top States */}
              {topStates && topStates.length > 0 && (
                <Card>
                  <CardHeader>
                    <CardTitle className="text-base">Top States</CardTitle>
                    <CardDescription>Highest revenue by location</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-3">
                      {topStates.slice(0, 8).map((state, idx) => (
                        <div
                          key={state.state}
                          className="flex items-center justify-between py-1 border-b last:border-0"
                        >
                          <div className="flex items-center gap-2">
                            <span className="text-muted-foreground text-sm w-5">{idx + 1}.</span>
                            <div className="flex items-center gap-1.5">
                              <MapPin className="w-3.5 h-3.5 text-muted-foreground" />
                              <span className="font-medium text-sm">{state.state}</span>
                            </div>
                          </div>
                          <div className="text-right">
                            <p className="font-medium text-sm">{formatCurrency(state.revenue, true)}</p>
                            <p className="text-xs text-muted-foreground">
                              {state.orderCount} orders
                            </p>
                          </div>
                        </div>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              )}
            </div>

            {/* RTO Summary */}
            {rtoData && (
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">RTO Overview</CardTitle>
                  <CardDescription>Return to origin analysis</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                    <div className="text-center p-4 bg-gray-50 rounded-lg">
                      <p className="text-2xl font-bold">{rtoData.rtoRate}%</p>
                      <p className="text-sm text-muted-foreground">RTO Rate</p>
                    </div>
                    <div className="text-center p-4 bg-gray-50 rounded-lg">
                      <p className="text-2xl font-bold">{formatNumber(rtoData.rtoOrders)}</p>
                      <p className="text-sm text-muted-foreground">RTO Orders</p>
                    </div>
                    <div className="text-center p-4 bg-gray-50 rounded-lg">
                      <p className="text-2xl font-bold">{formatNumber(rtoData.totalOrders)}</p>
                      <p className="text-sm text-muted-foreground">Total Orders</p>
                    </div>
                    <div className="text-center p-4 bg-gray-50 rounded-lg">
                      <p className="text-2xl font-bold">
                        {rtoData.byStatus.find((s) => s.status === 'delivered')?.percent || 0}%
                      </p>
                      <p className="text-sm text-muted-foreground">Delivered</p>
                    </div>
                  </div>
                </CardContent>
              </Card>
            )}
          </div>
        </TabsContent>

        {/* Orders Tab */}
        <TabsContent value="orders" className="flex-1 min-h-0">
          <Card className="h-full flex flex-col">
            <CardHeader className="pb-2 flex-shrink-0">
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle className="text-base">Channel Orders</CardTitle>
                  <CardDescription>
                    {ordersData?.total || 0} order lines
                  </CardDescription>
                </div>
              </div>
            </CardHeader>
            <CardContent className="flex-1 p-0 min-h-0">
              <div className="h-[calc(100vh-280px)] ag-theme-custom">
                <AgGridReact<ChannelOrderRow>
                  rowData={ordersData?.data || []}
                  columnDefs={columnDefs}
                  defaultColDef={DEFAULT_COL_DEF}
                  theme={compactThemeSmall}
                  loading={isOrdersLoading}
                  animateRows={false}
                  suppressMovableColumns
                  suppressColumnVirtualisation
                />
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* RTO Tab */}
        <TabsContent value="rto" className="flex-1 overflow-auto">
          <div className="space-y-4">
            {rtoData && (
              <>
                {/* RTO by Channel */}
                <Card>
                  <CardHeader>
                    <CardTitle className="text-base">RTO Rate by Channel</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-3">
                      {rtoData.byChannel.map((ch) => (
                        <div key={ch.channel} className="flex items-center justify-between py-2 border-b last:border-0">
                          <div className="flex items-center gap-2">
                            <div className={`w-3 h-3 rounded-full ${getChannelColor(ch.channel)}`} />
                            <span className="font-medium capitalize">{ch.channel}</span>
                          </div>
                          <div className="flex items-center gap-4">
                            <span className="text-sm text-muted-foreground">
                              {ch.rtoOrders} / {ch.totalOrders}
                            </span>
                            <Badge variant={ch.rtoRate > 10 ? 'destructive' : ch.rtoRate > 5 ? 'secondary' : 'default'}>
                              {ch.rtoRate}%
                            </Badge>
                          </div>
                        </div>
                      ))}
                    </div>
                  </CardContent>
                </Card>

                {/* RTO by State */}
                <Card>
                  <CardHeader>
                    <CardTitle className="text-base">RTO Rate by State (Top 10)</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-3">
                      {rtoData.byState.map((state) => (
                        <div key={state.state} className="flex items-center justify-between py-2 border-b last:border-0">
                          <div className="flex items-center gap-2">
                            <MapPin className="w-4 h-4 text-muted-foreground" />
                            <span className="font-medium">{state.state}</span>
                          </div>
                          <div className="flex items-center gap-4">
                            <span className="text-sm text-muted-foreground">
                              {state.rtoOrders} / {state.totalOrders}
                            </span>
                            <Badge variant={state.rtoRate > 15 ? 'destructive' : state.rtoRate > 10 ? 'secondary' : 'default'}>
                              {state.rtoRate}%
                            </Badge>
                          </div>
                        </div>
                      ))}
                    </div>
                  </CardContent>
                </Card>

                {/* Fulfillment Status Distribution */}
                <Card>
                  <CardHeader>
                    <CardTitle className="text-base">Fulfillment Status Distribution</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-2">
                      {rtoData.byStatus.map((status) => (
                        <div key={status.status} className="flex items-center gap-4">
                          <span className="w-32 text-sm truncate">{status.status}</span>
                          <div className="flex-1 bg-gray-100 rounded-full h-2">
                            <div
                              className="h-2 rounded-full bg-blue-500"
                              style={{ width: `${status.percent}%` }}
                            />
                          </div>
                          <span className="text-sm text-muted-foreground w-16 text-right">
                            {status.percent}%
                          </span>
                          <span className="text-sm w-16 text-right">{formatNumber(status.count)}</span>
                        </div>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              </>
            )}
          </div>
        </TabsContent>

        {/* Import History Tab */}
        <TabsContent value="import" className="flex-1 overflow-auto">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Import History</CardTitle>
              <CardDescription>Recent BT report uploads</CardDescription>
            </CardHeader>
            <CardContent>
              {importHistory && importHistory.length > 0 ? (
                <div className="space-y-3">
                  {importHistory.map((batch) => (
                    <div
                      key={batch.id}
                      className="flex items-center justify-between p-3 border rounded-lg"
                    >
                      <div>
                        <p className="font-medium">{batch.filename}</p>
                        <p className="text-sm text-muted-foreground">
                          {batch.dateRangeStart && batch.dateRangeEnd
                            ? `${batch.dateRangeStart} to ${batch.dateRangeEnd}`
                            : 'No date range'}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          Imported {new Date(batch.importedAt).toLocaleString('en-IN')}
                        </p>
                      </div>
                      <div className="text-right">
                        <Badge className={getChannelColor(batch.channel)}>{batch.channel}</Badge>
                        <p className="text-sm mt-1">
                          {batch.rowsImported} created, {batch.rowsUpdated} updated
                        </p>
                        {batch.rowsSkipped > 0 && (
                          <p className="text-xs text-amber-600">{batch.rowsSkipped} skipped</p>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-center py-8 text-muted-foreground">
                  <FileText className="w-12 h-12 mx-auto mb-2 opacity-50" />
                  <p>No imports yet. Upload a BT report to get started.</p>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Upload Modal */}
      <ChannelUploadModal open={isUploadModalOpen} onOpenChange={setIsUploadModalOpen} />
    </div>
  );
}
