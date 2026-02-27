/**
 * Demand Forecast Page
 *
 * Runs ML-based demand forecasting, shows product forecasts with charts,
 * fabric requirements, and streams AI analysis from Claude.
 */

import React, { useState, useCallback, useRef, useEffect } from 'react';
import {
    AreaChart, Area, BarChart, Bar, Line, XAxis, YAxis, CartesianGrid,
    Tooltip, ResponsiveContainer, Cell, ComposedChart
} from 'recharts';
import {
    TrendingUp, Play, Loader2, Brain, Package, Scissors,
    AlertTriangle, ChevronDown, ChevronUp,
    History, Clock, RefreshCw
} from 'lucide-react';

// ── Types ───────────────────────────────────────────────────────────

interface ForecastPoint {
    week: string;
    forecast: number;
    low: number;
    high: number;
}

interface ProductForecast {
    name: string;
    last12moUnits: number;
    recent8wAvg: number;
    forecastTotal: number;
    forecasts: ForecastPoint[];
    sizeBreakdown: { size: string; pct: number; units: number }[];
    colourBreakdown: { colour: string; pct: number; units: number }[];
    history: { week: string; units: number }[];
}

interface FabricDriver {
    product: string;
    qty: number;
    units: number;
}

interface FabricColour {
    code: string;
    colour: string;
    required: number;
    inStock: number;
    gap: number;
    costPerUnit: number;
    orderCost: number;
    drivers?: FabricDriver[];
}

interface FabricRequirement {
    name: string;
    unit: string;
    totalQty: number;
    colours: FabricColour[];
}

interface PurchaseOrder {
    code: string;
    fabric: string;
    colour: string;
    unit: string;
    required: number;
    inStock: number;
    toOrder: number;
    estCost: number;
}

interface ForecastData {
    generatedAt: string;
    forecastWeeks: number;
    overall: {
        totalOrders: number;
        weeksOfData: number;
        dateRange: { from: string; to: string };
        recent12wAvg: number;
        prev12wAvg: number;
        recentAov: number;
        prevAov: number;
        seasonality: { month: string; index: number }[];
    };
    weeklyHistory: { week: string; orders: number; revenue: number; aov: number }[];
    overallForecast: ForecastPoint[];
    revenueForecast?: ForecastPoint[];
    products: ProductForecast[];
    fabricRequirements: FabricRequirement[];
    purchaseOrders: PurchaseOrder[];
    summary: {
        totalForecastUnits: number;
        productsForecasted: number;
        fabricTypesNeeded: number;
        fabricColoursNeeded: number;
        shortfallCount: number;
        coveredByStock: number;
        estimatedPurchaseCost: number;
    };
}

interface HistoryItem {
    id: string;
    createdAt: string;
    forecastWeeks: number;
    totalUnits: number | null;
    productCount: number | null;
    shortfallCount: number | null;
    hasAnalysis: boolean;
}

// ── Colours ─────────────────────────────────────────────────────────

const CHART_BLUE = '#3b82f6';
const CHART_GREEN = '#10b981';
const CHART_RED = '#ef4444';
const BAR_COLOURS = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899', '#06b6d4', '#84cc16'];

// ── Component ───────────────────────────────────────────────────────

export default function DemandForecast() {
    const [data, setData] = useState<ForecastData | null>(null);
    const [forecastId, setForecastId] = useState<string | null>(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [analysis, setAnalysis] = useState('');
    const [analysisLoading, setAnalysisLoading] = useState(false);
    const [expandedProducts, setExpandedProducts] = useState<Set<string>>(new Set());
    const [historyItems, setHistoryItems] = useState<HistoryItem[]>([]);
    const [showHistory, setShowHistory] = useState(false);
    const abortRef = useRef<AbortController | null>(null);

    // ── Load history on mount ───────────────────────────────────────
    const loadHistory = useCallback(async () => {
        try {
            const res = await fetch('/api/forecast/history', { credentials: 'include' as RequestCredentials });
            if (res.ok) {
                const json = await res.json();
                setHistoryItems(json.data ?? []);
            }
        } catch { /* silent */ }
    }, []);

    // ── Load a past forecast ────────────────────────────────────────
    const loadForecast = useCallback(async (id: string) => {
        setLoading(true);
        setError(null);
        try {
            const res = await fetch(`/api/forecast/${id}`, { credentials: 'include' as RequestCredentials });
            if (!res.ok) throw new Error(await res.text());
            const json = await res.json();
            setData(json.data as ForecastData);
            setForecastId(json.id);
            setAnalysis(json.aiAnalysis ?? '');
            setShowHistory(false);
        } catch (e) {
            setError(e instanceof Error ? e.message : 'Failed to load forecast');
        } finally {
            setLoading(false);
        }
    }, []);

    // Load history on mount, then auto-load most recent forecast
    useEffect(() => { loadHistory(); }, [loadHistory]);

    useEffect(() => {
        if (historyItems.length > 0 && !data && !loading && !forecastId) {
            loadForecast(historyItems[0].id);
        }
    }, [historyItems, data, loading, forecastId, loadForecast]);

    // ── Run forecast ────────────────────────────────────────────────
    const runForecast = useCallback(async (forceRefresh = false) => {
        setLoading(true);
        setError(null);
        setAnalysis('');

        try {
            const res = await fetch('/api/forecast/run', {
                method: 'POST',
                credentials: 'include' as RequestCredentials,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ forceRefresh }),
            });
            if (!res.ok) throw new Error(await res.text());
            const json = await res.json();
            setData(json.data);
            setForecastId(json.id);
            loadHistory(); // Refresh history list
        } catch (e) {
            setError(e instanceof Error ? e.message : 'Failed to run forecast');
        } finally {
            setLoading(false);
        }
    }, [loadHistory]);

    // ── Run AI analysis ─────────────────────────────────────────────
    const runAnalysis = useCallback(async () => {
        if (!data) return;
        setAnalysisLoading(true);
        setAnalysis('');

        abortRef.current = new AbortController();

        try {
            const res = await fetch('/api/forecast/analyze', {
                method: 'POST',
                credentials: 'include' as RequestCredentials,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ forecastData: data, forecastId }),
                signal: abortRef.current.signal,
            });

            if (!res.ok) throw new Error(await res.text());

            const reader = res.body?.getReader();
            if (!reader) throw new Error('No response body');

            const decoder = new TextDecoder();
            let buffer = '';
            let fullText = '';

            while (true) {
                const { done, value } = await reader.read();
                if (done) break;

                buffer += decoder.decode(value, { stream: true });
                const lines = buffer.split('\n');
                buffer = lines.pop() ?? '';

                for (const line of lines) {
                    const trimmed = line.trim();
                    if (!trimmed.startsWith('data: ')) continue;
                    try {
                        const chunk = JSON.parse(trimmed.slice(6));
                        if (chunk.type === 'text') {
                            fullText += chunk.text;
                            setAnalysis(fullText);
                        }
                    } catch { /* skip */ }
                }
            }
        } catch (e) {
            if ((e as Error).name !== 'AbortError') {
                setAnalysis('Analysis failed: ' + ((e as Error).message || 'Unknown error'));
            }
        } finally {
            setAnalysisLoading(false);
        }
    }, [data]);

    const toggleProduct = (name: string) => {
        setExpandedProducts(prev => {
            const next = new Set(prev);
            next.has(name) ? next.delete(name) : next.add(name);
            return next;
        });
    };

    // ── Render ──────────────────────────────────────────────────────
    return (
        <div className="min-h-screen bg-zinc-950 text-zinc-100 p-4 md:p-6">
            {/* Header */}
            <div className="flex items-center justify-between mb-6">
                <div>
                    <h1 className="text-2xl font-semibold tracking-tight">Demand Forecast</h1>
                    <p className="text-sm text-zinc-500 mt-1">
                        ML-powered demand forecasting with fabric requirements
                        {forecastId && data && (
                            <span className="ml-2 text-zinc-600">
                                · Generated {new Date(data.generatedAt).toLocaleDateString()}
                            </span>
                        )}
                    </p>
                </div>
                <div className="flex items-center gap-2">
                    <button
                        onClick={() => setShowHistory(!showHistory)}
                        className="flex items-center gap-1.5 px-3 py-2 bg-zinc-800 hover:bg-zinc-700 rounded-lg text-sm text-zinc-300 transition"
                    >
                        <History className="w-4 h-4" />
                        History
                        {historyItems.length > 0 && (
                            <span className="text-xs text-zinc-500">({historyItems.length})</span>
                        )}
                    </button>
                    {data && (
                        <button
                            onClick={() => runForecast(true)}
                            disabled={loading}
                            className="flex items-center gap-1.5 px-3 py-2 bg-zinc-800 hover:bg-zinc-700 disabled:bg-zinc-800 rounded-lg text-sm text-zinc-300 transition"
                            title="Force fresh forecast (ignore cache)"
                        >
                            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
                        </button>
                    )}
                    <button
                        onClick={() => runForecast(true)}
                        disabled={loading}
                        className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-500 disabled:bg-zinc-700 rounded-lg text-sm font-medium transition"
                    >
                        {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />}
                        {loading ? 'Running...' : 'Run Forecast'}
                    </button>
                </div>
            </div>

            {/* History Panel */}
            {showHistory && (
                <div className="bg-zinc-900 rounded-xl border border-zinc-800 p-4 mb-6">
                    <h3 className="text-sm font-medium mb-3 flex items-center gap-2">
                        <Clock className="w-4 h-4 text-zinc-500" />
                        Past Forecasts
                    </h3>
                    {historyItems.length === 0 ? (
                        <p className="text-sm text-zinc-500">No forecasts saved yet. Run one to get started.</p>
                    ) : (
                        <div className="space-y-1.5">
                            {historyItems.map(item => (
                                <button
                                    key={item.id}
                                    onClick={() => loadForecast(item.id)}
                                    className={`w-full flex items-center justify-between p-3 rounded-lg text-left text-sm transition ${
                                        forecastId === item.id
                                            ? 'bg-blue-600/20 border border-blue-500/30'
                                            : 'bg-zinc-800/50 hover:bg-zinc-800 border border-transparent'
                                    }`}
                                >
                                    <div className="flex items-center gap-3">
                                        <span className="text-zinc-300">
                                            {new Date(item.createdAt).toLocaleDateString('en-IN', {
                                                day: 'numeric', month: 'short', year: 'numeric',
                                                hour: '2-digit', minute: '2-digit',
                                            })}
                                        </span>
                                        {item.hasAnalysis && (
                                            <span className="text-xs text-purple-400 bg-purple-400/10 px-1.5 py-0.5 rounded">
                                                AI
                                            </span>
                                        )}
                                    </div>
                                    <div className="flex items-center gap-4 text-xs text-zinc-500">
                                        {item.totalUnits != null && <span>{item.totalUnits.toLocaleString()} units</span>}
                                        {item.productCount != null && <span>{item.productCount} products</span>}
                                        {item.shortfallCount != null && (
                                            <span className={item.shortfallCount > 0 ? 'text-amber-400' : 'text-green-400'}>
                                                {item.shortfallCount} shortfalls
                                            </span>
                                        )}
                                    </div>
                                </button>
                            ))}
                        </div>
                    )}
                </div>
            )}

            {error && (
                <div className="bg-red-900/30 border border-red-800 rounded-lg p-3 mb-4 text-sm text-red-300">
                    {error}
                </div>
            )}

            {loading && (
                <div className="flex flex-col items-center justify-center py-24 text-zinc-500">
                    <Loader2 className="w-8 h-8 animate-spin mb-4" />
                    <p className="text-sm">Running SARIMA + XGBoost models...</p>
                    <p className="text-xs mt-1">This takes about 30 seconds</p>
                </div>
            )}

            {data && !loading && (
                <>
                    {/* Summary Cards */}
                    <SummaryCards data={data} />

                    {/* ═══ FABRIC DEMAND — Primary Section ═══ */}
                    <div className="mt-2 mb-8">
                        <div className="flex items-center justify-between mb-4">
                            <div className="flex items-center gap-2">
                                <Scissors className="w-5 h-5 text-blue-400" />
                                <h2 className="text-lg font-semibold">Fabric Demand Projection</h2>
                                <span className="text-xs text-zinc-500 bg-zinc-800 px-2 py-0.5 rounded-full">
                                    Next {data.forecastWeeks} weeks
                                </span>
                            </div>
                            {data.summary.estimatedPurchaseCost > 0 && (
                                <span className="text-sm text-amber-400">
                                    Est. procurement: ₹{data.summary.estimatedPurchaseCost.toLocaleString()}
                                </span>
                            )}
                        </div>
                        <FabricRequirements fabrics={data.fabricRequirements} unit={data.forecastWeeks} />
                    </div>

                    {/* ═══ Purchase Orders ═══ */}
                    {data.purchaseOrders.length > 0 && (
                        <PurchaseOrders orders={data.purchaseOrders} summary={data.summary} />
                    )}

                    {/* ═══ Overall Chart + Seasonality ═══ */}
                    <div className="mt-8">
                        <OverallChart data={data} />
                        <SeasonalityChart data={data} />
                    </div>

                    {/* ═══ Product Forecasts (collapsed by default) ═══ */}
                    <details className="mt-6">
                        <summary className="flex items-center gap-2 cursor-pointer text-sm font-medium text-zinc-400 hover:text-zinc-200 mb-4">
                            <Package className="w-4 h-4" />
                            Product-Level Forecasts ({data.products.length} products)
                        </summary>
                        <ProductForecasts
                            products={data.products}
                            expanded={expandedProducts}
                            onToggle={toggleProduct}
                        />
                    </details>

                    {/* AI Analysis */}
                    <div className="mt-8 bg-zinc-900 rounded-xl border border-zinc-800 p-5">
                        <div className="flex items-center justify-between mb-4">
                            <div className="flex items-center gap-2">
                                <Brain className="w-5 h-5 text-purple-400" />
                                <h2 className="text-lg font-medium">AI Analysis</h2>
                            </div>
                            <button
                                onClick={runAnalysis}
                                disabled={analysisLoading}
                                className="flex items-center gap-2 px-3 py-1.5 bg-purple-600 hover:bg-purple-500 disabled:bg-zinc-700 rounded-lg text-xs font-medium transition"
                            >
                                {analysisLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Brain className="w-3.5 h-3.5" />}
                                {analysisLoading ? 'Analyzing...' : 'Get AI Analysis'}
                            </button>
                        </div>
                        {!analysis && !analysisLoading && (
                            <p className="text-sm text-zinc-500">
                                Click &quot;Get AI Analysis&quot; to have Claude analyze your forecast data and provide business recommendations.
                            </p>
                        )}
                        {analysis && (
                            <div className="prose prose-invert prose-sm max-w-none">
                                <MarkdownRenderer content={analysis} />
                            </div>
                        )}
                    </div>
                </>
            )}

            {!data && !loading && !error && (
                <div className="flex flex-col items-center justify-center py-24 text-zinc-500">
                    <TrendingUp className="w-12 h-12 mb-4 opacity-30" />
                    <p className="text-sm">Click &quot;Run Forecast&quot; to generate demand predictions</p>
                    <p className="text-xs mt-1 text-zinc-600">Uses SARIMA + XGBoost ensemble on 3+ years of order data</p>
                </div>
            )}
        </div>
    );
}

// ── Summary Cards ───────────────────────────────────────────────────

function SummaryCards({ data }: { data: ForecastData }) {
    const { overall, summary } = data;
    const ordersChange = ((overall.recent12wAvg / overall.prev12wAvg) - 1) * 100;
    const aovChange = ((overall.recentAov / overall.prevAov) - 1) * 100;

    return (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
            <Card
                label="Forecast (8wk)"
                value={`${summary.totalForecastUnits.toLocaleString()} units`}
                sub={`${summary.productsForecasted} products`}
            />
            <Card
                label="Weekly Orders (12w)"
                value={overall.recent12wAvg.toFixed(0)}
                sub={`${ordersChange >= 0 ? '+' : ''}${ordersChange.toFixed(1)}% vs prior`}
                subColor={ordersChange >= 0 ? 'text-green-400' : 'text-red-400'}
            />
            <Card
                label="AOV (12w)"
                value={`₹${overall.recentAov.toLocaleString()}`}
                sub={`${aovChange >= 0 ? '+' : ''}${aovChange.toFixed(1)}% vs prior`}
                subColor={aovChange >= 0 ? 'text-green-400' : 'text-red-400'}
            />
            <Card
                label="Fabric Shortfalls"
                value={`${summary.shortfallCount}`}
                sub={`${summary.coveredByStock}/${summary.fabricColoursNeeded} covered`}
                subColor={summary.shortfallCount > 10 ? 'text-amber-400' : 'text-green-400'}
            />
        </div>
    );
}

function Card({ label, value, sub, subColor = 'text-zinc-500' }: {
    label: string; value: string; sub: string; subColor?: string;
}) {
    return (
        <div className="bg-zinc-900 rounded-xl border border-zinc-800 p-4">
            <div className="text-xs text-zinc-500 mb-1">{label}</div>
            <div className="text-xl font-semibold">{value}</div>
            <div className={`text-xs mt-1 ${subColor}`}>{sub}</div>
        </div>
    );
}

// ── Overall Chart ───────────────────────────────────────────────────

const CHART_AMBER = '#f59e0b';

function OverallChart({ data }: { data: ForecastData }) {
    // Build a map of revenue forecasts by week for quick lookup
    const revFcMap = new Map<string, ForecastPoint>();
    if (data.revenueForecast) {
        for (const f of data.revenueForecast) {
            revFcMap.set(f.week.slice(5), f);
        }
    }

    const chartData = [
        ...data.weeklyHistory.map(h => ({
            week: h.week.slice(5), // "MM-DD"
            orders: h.orders,
            revenue: h.revenue || undefined,
        })),
        ...data.overallForecast.map(f => {
            const rev = revFcMap.get(f.week.slice(5));
            return {
                week: f.week.slice(5),
                forecast: f.forecast,
                low: f.low,
                high: f.high,
                revenueForecast: rev?.forecast,
            };
        }),
    ];

    const hasRevenue = data.weeklyHistory.some(h => h.revenue > 0) || revFcMap.size > 0;

    return (
        <div className="bg-zinc-900 rounded-xl border border-zinc-800 p-5 mb-6">
            <h2 className="text-sm font-medium text-zinc-300 mb-4">
                Weekly Orders {hasRevenue ? '& Revenue' : ''} — Last 52 Weeks + 8 Week Forecast
            </h2>
            <ResponsiveContainer width="100%" height={250}>
                <ComposedChart data={chartData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#27272a" />
                    <XAxis dataKey="week" tick={{ fontSize: 10, fill: '#71717a' }} interval={7} />
                    <YAxis yAxisId="orders" tick={{ fontSize: 10, fill: '#71717a' }} />
                    {hasRevenue && (
                        <YAxis
                            yAxisId="revenue"
                            orientation="right"
                            tick={{ fontSize: 10, fill: '#71717a' }}
                            tickFormatter={(v: number) => `₹${(v / 1000).toFixed(0)}k`}
                        />
                    )}
                    <Tooltip
                        contentStyle={{ background: '#18181b', border: '1px solid #3f3f46', borderRadius: 8, fontSize: 12 }}
                        labelStyle={{ color: '#a1a1aa' }}
                        formatter={((value: number, name: string) => {
                            if (value == null) return ['-', name ?? ''];
                            if (name === 'revenue' || name === 'revenueForecast') {
                                return [`₹${value.toLocaleString()}`, name === 'revenueForecast' ? 'Revenue (projected)' : 'Revenue'];
                            }
                            return [value, name === 'forecast' ? 'Orders (projected)' : name === 'orders' ? 'Orders' : (name ?? '')];
                            // eslint-disable-next-line @typescript-eslint/no-explicit-any
                        }) as any}
                    />
                    {/* Order areas */}
                    <Area yAxisId="orders" type="monotone" dataKey="orders" stroke={CHART_BLUE} fill={CHART_BLUE} fillOpacity={0.15} strokeWidth={1.5} />
                    <Area yAxisId="orders" type="monotone" dataKey="forecast" stroke={CHART_GREEN} fill={CHART_GREEN} fillOpacity={0.15} strokeWidth={2} strokeDasharray="4 4" />
                    <Area yAxisId="orders" type="monotone" dataKey="high" stroke="none" fill={CHART_GREEN} fillOpacity={0.05} />
                    <Area yAxisId="orders" type="monotone" dataKey="low" stroke="none" fill={CHART_GREEN} fillOpacity={0.05} />
                    {/* Revenue lines */}
                    {hasRevenue && (
                        <>
                            <Line yAxisId="revenue" type="monotone" dataKey="revenue" stroke={CHART_AMBER} strokeWidth={1.5} dot={false} />
                            <Line yAxisId="revenue" type="monotone" dataKey="revenueForecast" stroke={CHART_AMBER} strokeWidth={2} strokeDasharray="4 4" dot={false} />
                        </>
                    )}
                </ComposedChart>
            </ResponsiveContainer>
            {hasRevenue && (
                <div className="flex items-center gap-4 mt-2 text-xs text-zinc-500">
                    <span className="flex items-center gap-1"><span className="w-3 h-0.5 bg-blue-500 inline-block" /> Orders</span>
                    <span className="flex items-center gap-1"><span className="w-3 h-0.5 bg-green-500 inline-block border-dashed" /> Orders (projected)</span>
                    <span className="flex items-center gap-1"><span className="w-3 h-0.5 bg-amber-500 inline-block" /> Revenue</span>
                    <span className="flex items-center gap-1"><span className="w-3 h-0.5 bg-amber-500 inline-block border-dashed" /> Revenue (projected)</span>
                </div>
            )}
        </div>
    );
}

// ── Seasonality Chart ───────────────────────────────────────────────

function SeasonalityChart({ data }: { data: ForecastData }) {
    const seasonality = data.overall.seasonality;
    return (
        <div className="bg-zinc-900 rounded-xl border border-zinc-800 p-5 mb-6">
            <h2 className="text-sm font-medium text-zinc-300 mb-4">Seasonality Index (100 = average)</h2>
            <ResponsiveContainer width="100%" height={140}>
                <BarChart data={seasonality}>
                    <XAxis dataKey="month" tick={{ fontSize: 11, fill: '#a1a1aa' }} />
                    <YAxis tick={{ fontSize: 10, fill: '#71717a' }} domain={[0, 'auto']} />
                    <Tooltip
                        contentStyle={{ background: '#18181b', border: '1px solid #3f3f46', borderRadius: 8, fontSize: 12 }}
                    />
                    <Bar dataKey="index" radius={[4, 4, 0, 0]}>
                        {seasonality.map((s, i) => (
                            <Cell key={i} fill={s.index > 120 ? CHART_GREEN : s.index < 80 ? CHART_RED : CHART_BLUE} />
                        ))}
                    </Bar>
                </BarChart>
            </ResponsiveContainer>
        </div>
    );
}

// ── Product Forecasts ───────────────────────────────────────────────

function ProductForecasts({ products, expanded, onToggle }: {
    products: ProductForecast[];
    expanded: Set<string>;
    onToggle: (name: string) => void;
}) {
    return (
        <div className="space-y-3">
            {products.map(product => (
                <div key={product.name} className="bg-zinc-900 rounded-xl border border-zinc-800 overflow-hidden">
                    {/* Header row */}
                    <button
                        onClick={() => onToggle(product.name)}
                        className="w-full flex items-center justify-between p-4 hover:bg-zinc-800/50 transition text-left"
                    >
                        <div className="flex items-center gap-4">
                            <span className="font-medium text-sm">{product.name}</span>
                            <span className="text-xs text-zinc-500">
                                {product.recent8wAvg.toFixed(1)}/wk recent
                            </span>
                        </div>
                        <div className="flex items-center gap-4">
                            <span className="text-sm font-semibold text-blue-400">
                                {product.forecastTotal} units
                            </span>
                            <span className="text-xs text-zinc-600">8wk forecast</span>
                            {expanded.has(product.name) ? (
                                <ChevronUp className="w-4 h-4 text-zinc-500" />
                            ) : (
                                <ChevronDown className="w-4 h-4 text-zinc-500" />
                            )}
                        </div>
                    </button>

                    {/* Expanded details */}
                    {expanded.has(product.name) && (
                        <div className="border-t border-zinc-800 p-4 space-y-4">
                            {/* Mini chart: history + forecast */}
                            <div>
                                <div className="text-xs text-zinc-500 mb-2">Weekly units (26w history + forecast)</div>
                                <ResponsiveContainer width="100%" height={120}>
                                    <AreaChart data={[
                                        ...product.history.map(h => ({ week: h.week.slice(5), units: h.units })),
                                        ...product.forecasts.map(f => ({ week: f.week.slice(5), forecast: f.forecast })),
                                    ]}>
                                        <XAxis dataKey="week" tick={{ fontSize: 9, fill: '#52525b' }} interval={4} />
                                        <YAxis tick={{ fontSize: 9, fill: '#52525b' }} />
                                        <Area type="monotone" dataKey="units" stroke={CHART_BLUE} fill={CHART_BLUE} fillOpacity={0.1} strokeWidth={1.5} />
                                        <Area type="monotone" dataKey="forecast" stroke={CHART_GREEN} fill={CHART_GREEN} fillOpacity={0.1} strokeWidth={2} strokeDasharray="4 4" />
                                    </AreaChart>
                                </ResponsiveContainer>
                            </div>

                            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                                {/* Weekly forecast table */}
                                <div>
                                    <div className="text-xs text-zinc-500 mb-2">Weekly Forecast</div>
                                    <table className="w-full text-xs">
                                        <thead>
                                            <tr className="text-zinc-500">
                                                <th className="text-left pb-1">Week</th>
                                                <th className="text-right pb-1">Units</th>
                                                <th className="text-right pb-1">Range</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {product.forecasts.map(f => (
                                                <tr key={f.week} className="border-t border-zinc-800/50">
                                                    <td className="py-1 text-zinc-400">{f.week.slice(5)}</td>
                                                    <td className="py-1 text-right font-medium">{f.forecast}</td>
                                                    <td className="py-1 text-right text-zinc-500">{f.low}-{f.high}</td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>

                                {/* Size mix */}
                                <div>
                                    <div className="text-xs text-zinc-500 mb-2">Size Mix</div>
                                    {product.sizeBreakdown.map(s => (
                                        <div key={s.size} className="flex items-center gap-2 text-xs mb-1">
                                            <span className="w-8 text-zinc-400">{s.size}</span>
                                            <div className="flex-1 bg-zinc-800 rounded-full h-2 overflow-hidden">
                                                <div
                                                    className="h-full bg-blue-500 rounded-full"
                                                    style={{ width: `${s.pct}%` }}
                                                />
                                            </div>
                                            <span className="w-12 text-right text-zinc-500">{s.pct}%</span>
                                            <span className="w-10 text-right">{s.units}</span>
                                        </div>
                                    ))}
                                </div>

                                {/* Colour mix */}
                                <div>
                                    <div className="text-xs text-zinc-500 mb-2">Colour Mix</div>
                                    {product.colourBreakdown.slice(0, 6).map((c, i) => (
                                        <div key={c.colour} className="flex items-center gap-2 text-xs mb-1">
                                            <div className="w-2 h-2 rounded-full" style={{ background: BAR_COLOURS[i % BAR_COLOURS.length] }} />
                                            <span className="flex-1 text-zinc-400 truncate">{c.colour}</span>
                                            <span className="text-zinc-500">{c.pct}%</span>
                                            <span className="w-8 text-right">{c.units}</span>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        </div>
                    )}
                </div>
            ))}
        </div>
    );
}

// ── Fabric Requirements (Primary Section) ───────────────────────────

function FabricRequirements({ fabrics, unit }: { fabrics: FabricRequirement[]; unit: number }) {
    const [expandedColours, setExpandedColours] = useState<Set<string>>(new Set());

    const toggleColour = (code: string) => {
        setExpandedColours(prev => {
            const next = new Set(prev);
            next.has(code) ? next.delete(code) : next.add(code);
            return next;
        });
    };

    const totalCovered = fabrics.reduce((sum, f) =>
        sum + f.colours.filter(c => c.gap <= 0).length, 0);
    const totalColours = fabrics.reduce((sum, f) => sum + f.colours.length, 0);

    return (
        <div className="space-y-4">
            {/* Fabric summary strip */}
            <div className="grid grid-cols-3 gap-3">
                <div className="bg-zinc-900 rounded-lg border border-zinc-800 px-4 py-3">
                    <div className="text-xs text-zinc-500">Fabric Types</div>
                    <div className="text-lg font-semibold">{fabrics.length}</div>
                    <div className="text-xs text-zinc-500">{totalColours} colour variants</div>
                </div>
                <div className="bg-zinc-900 rounded-lg border border-zinc-800 px-4 py-3">
                    <div className="text-xs text-zinc-500">Covered by Stock</div>
                    <div className="text-lg font-semibold text-green-400">{totalCovered}/{totalColours}</div>
                    <div className="text-xs text-zinc-500">{totalColours - totalCovered} need ordering</div>
                </div>
                <div className="bg-zinc-900 rounded-lg border border-zinc-800 px-4 py-3">
                    <div className="text-xs text-zinc-500">Projection Period</div>
                    <div className="text-lg font-semibold">{unit} weeks</div>
                    <div className="text-xs text-zinc-500">incl. {fabrics.length > 0 ? '5%' : '0%'} wastage</div>
                </div>
            </div>

            {fabrics.map(fabric => {
                const shortfallColours = fabric.colours.filter(c => c.gap > 0).length;
                return (
                    <div key={fabric.name} className="bg-zinc-900 rounded-xl border border-zinc-800 overflow-hidden">
                        {/* Fabric type header */}
                        <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-800/50">
                            <div className="flex items-center gap-3">
                                <h3 className="font-medium">{fabric.name}</h3>
                                {shortfallColours > 0 && (
                                    <span className="text-xs text-amber-400 bg-amber-400/10 px-2 py-0.5 rounded-full">
                                        {shortfallColours} to order
                                    </span>
                                )}
                            </div>
                            <span className="text-sm font-semibold text-blue-400">
                                {fabric.totalQty.toFixed(1)} {fabric.unit}
                            </span>
                        </div>
                        {/* Colour rows */}
                        <table className="w-full text-xs">
                            <thead>
                                <tr className="text-zinc-500">
                                    <th className="text-left px-4 py-2 w-8"></th>
                                    <th className="text-left py-2">Colour</th>
                                    <th className="text-right py-2 pr-3">Need ({fabric.unit})</th>
                                    <th className="text-right py-2 pr-3">Stock</th>
                                    <th className="text-right py-2 pr-3">Gap</th>
                                    <th className="text-right py-2 pr-4">Status</th>
                                </tr>
                            </thead>
                            <tbody>
                                {fabric.colours.map(c => {
                                    const isExpanded = expandedColours.has(c.code);
                                    const hasDrivers = c.drivers && c.drivers.length > 0;
                                    return (
                                        <React.Fragment key={c.code}>
                                            <tr
                                                className={`border-t border-zinc-800/30 ${hasDrivers ? 'cursor-pointer hover:bg-zinc-800/30' : ''} ${isExpanded ? 'bg-zinc-800/20' : ''}`}
                                                onClick={() => hasDrivers && toggleColour(c.code)}
                                            >
                                                <td className="pl-4 py-2 text-zinc-600">
                                                    {hasDrivers && (
                                                        isExpanded
                                                            ? <ChevronUp className="w-3 h-3" />
                                                            : <ChevronDown className="w-3 h-3" />
                                                    )}
                                                </td>
                                                <td className="py-2">
                                                    <span className="text-zinc-300">{c.colour}</span>
                                                    <span className="ml-2 font-mono text-zinc-600 text-[10px]">{c.code}</span>
                                                </td>
                                                <td className="py-2 text-right pr-3 font-medium">{c.required.toFixed(1)}</td>
                                                <td className="py-2 text-right pr-3 text-zinc-400">{c.inStock.toFixed(1)}</td>
                                                <td className={`py-2 text-right pr-3 font-medium ${c.gap > 0 ? 'text-red-400' : 'text-green-400'}`}>
                                                    {c.gap > 0 ? `+${c.gap.toFixed(1)}` : c.gap.toFixed(1)}
                                                </td>
                                                <td className="py-2 text-right pr-4">
                                                    {c.gap > 0 ? (
                                                        <span className="inline-flex items-center gap-1 text-amber-400">
                                                            <AlertTriangle className="w-3 h-3" />
                                                            Order
                                                        </span>
                                                    ) : (
                                                        <span className="text-green-400">OK</span>
                                                    )}
                                                </td>
                                            </tr>
                                            {/* Product drivers (expanded) */}
                                            {isExpanded && c.drivers && (
                                                <tr>
                                                    <td colSpan={6} className="px-4 pb-3 pt-1">
                                                        <div className="bg-zinc-800/40 rounded-lg p-3 ml-4">
                                                            <div className="text-[10px] text-zinc-500 uppercase tracking-wider mb-2">
                                                                Demand driven by
                                                            </div>
                                                            <div className="space-y-1.5">
                                                                {c.drivers.map(d => {
                                                                    const pct = c.required > 0 ? (d.qty / c.required * 100) : 0;
                                                                    return (
                                                                        <div key={d.product} className="flex items-center gap-2">
                                                                            <span className="text-xs text-zinc-300 w-48 truncate">{d.product}</span>
                                                                            <div className="flex-1 bg-zinc-700 rounded-full h-1.5 overflow-hidden">
                                                                                <div
                                                                                    className="h-full bg-blue-500/70 rounded-full"
                                                                                    style={{ width: `${Math.min(100, pct)}%` }}
                                                                                />
                                                                            </div>
                                                                            <span className="text-xs text-zinc-400 w-16 text-right">
                                                                                {d.qty.toFixed(1)} {fabric.unit}
                                                                            </span>
                                                                            <span className="text-[10px] text-zinc-500 w-10 text-right">
                                                                                {pct.toFixed(0)}%
                                                                            </span>
                                                                        </div>
                                                                    );
                                                                })}
                                                            </div>
                                                            <div className="text-[10px] text-zinc-600 mt-2">
                                                                Based on {unit}-week demand forecast ({c.drivers.length} product{c.drivers.length !== 1 ? 's' : ''})
                                                            </div>
                                                        </div>
                                                    </td>
                                                </tr>
                                            )}
                                        </React.Fragment>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>
                );
            })}
        </div>
    );
}

// ── Purchase Orders ─────────────────────────────────────────────────

function PurchaseOrders({ orders, summary }: { orders: PurchaseOrder[]; summary: ForecastData['summary'] }) {
    return (
        <div className="bg-zinc-900 rounded-xl border border-zinc-800 p-4">
            <div className="flex items-center justify-between mb-4">
                <h3 className="font-medium text-sm">Fabric Purchase Orders</h3>
                {summary.estimatedPurchaseCost > 0 && (
                    <span className="text-sm text-amber-400">
                        Est. cost: ₹{summary.estimatedPurchaseCost.toLocaleString()}
                    </span>
                )}
            </div>
            {orders.length === 0 ? (
                <p className="text-sm text-zinc-500">All fabric requirements covered by current stock!</p>
            ) : (
                <table className="w-full text-xs">
                    <thead>
                        <tr className="text-zinc-500 border-b border-zinc-800">
                            <th className="text-left pb-2">Code</th>
                            <th className="text-left pb-2">Fabric</th>
                            <th className="text-left pb-2">Colour</th>
                            <th className="text-right pb-2">Need</th>
                            <th className="text-right pb-2">Have</th>
                            <th className="text-right pb-2">Order</th>
                            <th className="text-right pb-2">Unit</th>
                        </tr>
                    </thead>
                    <tbody>
                        {orders.map(o => (
                            <tr key={o.code} className="border-t border-zinc-800/50">
                                <td className="py-1.5 font-mono text-zinc-400">{o.code}</td>
                                <td className="py-1.5">{o.fabric}</td>
                                <td className="py-1.5">{o.colour}</td>
                                <td className="py-1.5 text-right">{o.required.toFixed(1)}</td>
                                <td className="py-1.5 text-right text-zinc-400">{o.inStock.toFixed(1)}</td>
                                <td className="py-1.5 text-right font-medium text-amber-400">{o.toOrder.toFixed(1)}</td>
                                <td className="py-1.5 text-right text-zinc-500">{o.unit}</td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            )}
        </div>
    );
}

// ── Markdown Renderer (simple) ──────────────────────────────────────

function MarkdownRenderer({ content }: { content: string }) {
    const html = content
        .replace(/## (.*)/g, '<h3 class="text-base font-semibold text-zinc-100 mt-4 mb-2">$1</h3>')
        .replace(/\*\*(.*?)\*\*/g, '<strong class="text-zinc-100">$1</strong>')
        .replace(/- (.*)/g, '<li class="ml-4 text-zinc-300">$1</li>')
        .replace(/\n\n/g, '<br/><br/>')
        .replace(/\n/g, '<br/>');

    return <div dangerouslySetInnerHTML={{ __html: html }} />;
}
