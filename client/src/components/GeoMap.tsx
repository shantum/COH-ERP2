/**
 * GeoMap — Dark-themed WebGL map with glowing activity markers.
 *
 * Uses MapLibre GL (via react-map-gl) with CartoDB Dark Matter tiles.
 * Markers are rendered as a GeoJSON circle layer so they scale properly with zoom.
 */

import { memo, useState, useCallback, useMemo, useRef } from 'react';
import MapGL, { Source, Layer, Popup } from 'react-map-gl/maplibre';
import type { MapRef } from 'react-map-gl/maplibre';
import type { CircleLayerSpecification } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import type { GeoBreakdownRow } from '../server/functions/storefrontAnalytics';

// Free CartoDB Dark Matter — no API key needed
const MAP_STYLE = 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json';

// ── Coordinate mapping ──────────────────────────────────────────────

const INDIA_STATES: Record<string, [number, number]> = {
    'Andhra Pradesh': [79.74, 15.91],
    'Arunachal Pradesh': [94.73, 28.22],
    'Assam': [92.94, 26.2],
    'Bihar': [85.31, 25.1],
    'Chhattisgarh': [81.87, 21.28],
    'Goa': [74.12, 15.3],
    'Gujarat': [71.19, 22.26],
    'Haryana': [76.09, 29.06],
    'Himachal Pradesh': [77.17, 31.1],
    'Jharkhand': [85.28, 23.61],
    'Karnataka': [75.71, 15.32],
    'Kerala': [76.27, 10.85],
    'Madhya Pradesh': [78.66, 23.47],
    'Maharashtra': [75.71, 19.75],
    'Manipur': [93.91, 24.66],
    'Meghalaya': [91.37, 25.47],
    'Mizoram': [92.94, 23.16],
    'Nagaland': [94.56, 26.16],
    'Odisha': [85.9, 20.94],
    'Punjab': [75.34, 31.15],
    'Rajasthan': [74.22, 27.02],
    'Sikkim': [88.51, 27.53],
    'Tamil Nadu': [78.66, 11.13],
    'Telangana': [79.02, 18.11],
    'Tripura': [91.99, 23.94],
    'Uttar Pradesh': [80.95, 26.85],
    'Uttarakhand': [79.07, 30.07],
    'West Bengal': [87.85, 22.99],
    'National Capital Territory of Delhi': [77.1, 28.7],
    'Jammu and Kashmir': [74.8, 33.78],
    'Ladakh': [77.58, 34.15],
    'Chandigarh': [76.77, 30.73],
    'Puducherry': [79.81, 11.94],
};

const COUNTRY_COORDS: Record<string, [number, number]> = {
    'India': [78.96, 20.59],
    'United States': [-95.71, 37.09],
    'United Kingdom': [-3.44, 55.38],
    'Canada': [-106.35, 56.13],
    'Australia': [133.78, -25.27],
    'Germany': [10.45, 51.17],
    'France': [2.21, 46.23],
    'Singapore': [103.82, 1.35],
    'UAE': [53.85, 23.42],
    'United Arab Emirates': [53.85, 23.42],
    'Japan': [138.25, 36.2],
    'South Korea': [127.77, 35.91],
    'Brazil': [-51.93, -14.24],
    'Netherlands': [5.29, 52.13],
    'Italy': [12.57, 41.87],
    'Spain': [-3.75, 40.46],
    'Russia': [105.32, 61.52],
    'China': [104.2, 35.86],
    'Indonesia': [113.92, -0.79],
    'Malaysia': [101.98, 4.21],
    'Thailand': [100.99, 15.87],
    'Saudi Arabia': [45.08, 23.89],
    'Mexico': [-102.55, 23.63],
    'South Africa': [22.94, -30.56],
    'Nigeria': [8.68, 9.08],
    'Kenya': [37.91, -0.02],
    'Bangladesh': [90.36, 23.68],
    'Pakistan': [69.35, 30.38],
    'Sri Lanka': [80.77, 7.87],
    'Nepal': [84.12, 28.39],
    'Philippines': [121.77, 12.88],
    'Vietnam': [108.28, 14.06],
    'Turkey': [35.24, 38.96],
    'Egypt': [30.8, 26.82],
    'Poland': [19.15, 51.92],
    'Sweden': [18.64, 60.13],
    'Norway': [8.47, 60.47],
    'Denmark': [9.5, 56.26],
    'Finland': [25.75, 61.92],
    'New Zealand': [174.89, -40.9],
    'Israel': [34.85, 31.05],
    'Ireland': [-8.24, 53.41],
    'Switzerland': [8.23, 46.82],
    'Austria': [14.55, 47.52],
    'Belgium': [4.47, 50.5],
    'Portugal': [-8.22, 39.4],
    'Oman': [55.92, 21.51],
    'Qatar': [51.18, 25.35],
    'Kuwait': [47.48, 29.31],
    'Bahrain': [50.56, 26.07],
};

/** Major Indian city coordinates */
const INDIA_CITIES: Record<string, [number, number]> = {
    'Mumbai': [72.88, 19.08],
    'New Delhi': [77.21, 28.61],
    'Delhi': [77.21, 28.61],
    'Bengaluru': [77.59, 12.97],
    'Bangalore': [77.59, 12.97],
    'Hyderabad': [78.47, 17.39],
    'Chennai': [80.27, 13.08],
    'Kolkata': [88.36, 22.57],
    'Pune': [73.86, 18.52],
    'Ahmedabad': [72.58, 23.02],
    'Jaipur': [75.79, 26.92],
    'Lucknow': [80.95, 26.85],
    'Surat': [72.83, 21.17],
    'Kochi': [76.27, 9.93],
    'Chandigarh': [76.77, 30.73],
    'Indore': [75.86, 22.72],
    'Bhopal': [77.41, 23.26],
    'Nagpur': [79.09, 21.15],
    'Coimbatore': [76.96, 11.0],
    'Thiruvananthapuram': [76.95, 8.52],
    'Gurgaon': [77.03, 28.47],
    'Gurugram': [77.03, 28.47],
    'Noida': [77.33, 28.57],
    'Ghaziabad': [77.42, 28.67],
    'Faridabad': [77.31, 28.41],
    'Patna': [85.14, 25.61],
    'Bhubaneswar': [85.83, 20.3],
    'Visakhapatnam': [83.3, 17.69],
    'Vadodara': [73.21, 22.31],
    'Ludhiana': [75.86, 30.9],
    'Agra': [78.02, 27.18],
    'Varanasi': [83.0, 25.32],
    'Madurai': [78.12, 9.92],
    'Mysuru': [76.66, 12.3],
    'Mysore': [76.66, 12.3],
    'Mangaluru': [74.86, 12.87],
    'Mangalore': [74.86, 12.87],
    'Ranchi': [85.33, 23.34],
    'Dehradun': [78.03, 30.32],
    'Guwahati': [91.75, 26.14],
    'Raipur': [81.63, 21.25],
    'Vijayawada': [80.65, 16.51],
    'Amritsar': [74.87, 31.63],
    'Panaji': [73.83, 15.5],
    'Margao': [73.96, 15.27],
    'Mapusa': [73.81, 15.59],
    'Vasco da Gama': [73.81, 15.4],
    'Thane': [72.98, 19.2],
    'Navi Mumbai': [73.02, 19.03],
    'Goa Velha': [73.89, 15.44],
    'Kanpur': [80.35, 26.45],
    'Jodhpur': [73.02, 26.29],
    'Udaipur': [73.71, 24.58],
    'Kota': [75.86, 25.18],
    'Shimla': [77.17, 31.1],
    'Rishikesh': [78.27, 30.09],
    'Haridwar': [78.17, 29.95],
    'Tiruchirappalli': [78.69, 10.79],
    'Salem': [78.14, 11.65],
    'Ernakulam': [76.29, 9.98],
    'Thrissur': [76.21, 10.53],
    'Kozhikode': [75.77, 11.25],
    'Calicut': [75.77, 11.25],
};

/** Major world city coordinates */
const WORLD_CITIES: Record<string, [number, number]> = {
    'New York': [-74.01, 40.71],
    'Los Angeles': [-118.24, 34.05],
    'San Francisco': [-122.42, 37.77],
    'Chicago': [-87.63, 41.88],
    'London': [-0.13, 51.51],
    'Dubai': [55.27, 25.2],
    'Abu Dhabi': [54.37, 24.45],
    'Singapore': [103.85, 1.29],
    'Tokyo': [139.69, 35.69],
    'Sydney': [151.21, -33.87],
    'Melbourne': [144.96, -37.81],
    'Toronto': [-79.38, 43.65],
    'Berlin': [13.4, 52.52],
    'Paris': [2.35, 48.86],
    'Amsterdam': [4.9, 52.37],
    'Hong Kong': [114.17, 22.32],
    'Kuala Lumpur': [101.69, 3.14],
    'Bangkok': [100.5, 13.76],
    'Seattle': [-122.33, 47.61],
    'Houston': [-95.37, 29.76],
    'Dallas': [-96.8, 32.78],
    'Washington': [-77.04, 38.91],
    'Boston': [-71.06, 42.36],
    'Atlanta': [-84.39, 33.75],
    'Miami': [-80.19, 25.76],
    'Doha': [51.53, 25.29],
    'Riyadh': [46.72, 24.71],
    'Muscat': [58.41, 23.59],
    'Dhaka': [90.41, 23.81],
    'Colombo': [79.86, 6.93],
    'Kathmandu': [85.32, 27.72],
    'Lahore': [74.35, 31.56],
    'Karachi': [67.01, 24.86],
    'Cape Town': [18.42, -33.93],
    'Nairobi': [36.82, -1.29],
    'Lagos': [3.39, 6.45],
    'São Paulo': [-46.63, -23.55],
    'Mexico City': [-99.13, 19.43],
};

function getCoords(country: string | null, region: string | null, city: string | null): [number, number] | null {
    // City-level first (most precise)
    if (city) {
        if (country === 'India' && INDIA_CITIES[city]) return INDIA_CITIES[city];
        if (WORLD_CITIES[city]) return WORLD_CITIES[city];
    }
    // Fall back to state centroid for India
    if (country === 'India' && region && INDIA_STATES[region]) {
        return INDIA_STATES[region];
    }
    // Fall back to country centroid
    if (country && COUNTRY_COORDS[country]) {
        return COUNTRY_COORDS[country];
    }
    return null;
}

// ── Map presets ─────────────────────────────────────────────────────

const VIEWS = {
    india: { longitude: 79, latitude: 22, zoom: 4 },
    world: { longitude: 30, latitude: 20, zoom: 1.5 },
} as const;

// ── GeoJSON + Layer styles ──────────────────────────────────────────

interface MarkerFeatureProps {
    label: string;
    sessions: number;
    pageViews: number;
    atcCount: number;
    orders: number;
    revenue: number;
    // 0 = sessions only, 1 = ATC, 2 = orders
    tier: number;
    // normalised 0–1
    intensity: number;
}

function buildGeoJSON(data: GeoBreakdownRow[], maxSessions: number): GeoJSON.FeatureCollection<GeoJSON.Point, MarkerFeatureProps> {
    const features: GeoJSON.Feature<GeoJSON.Point, MarkerFeatureProps>[] = [];
    for (const r of data) {
        const coords = getCoords(r.country, r.region, r.city);
        if (!coords) continue;
        const tier = r.orders > 0 ? 2 : r.atcCount > 0 ? 1 : 0;
        // Build label: "City, State, Country" or whichever parts exist
        const parts = [r.city, r.region, r.country].filter(Boolean);
        const label = parts.length > 0 ? parts.join(', ') : 'Unknown';
        features.push({
            type: 'Feature',
            geometry: { type: 'Point', coordinates: coords },
            properties: {
                label,
                sessions: r.sessions,
                pageViews: r.pageViews,
                atcCount: r.atcCount,
                orders: r.orders,
                revenue: r.revenue,
                tier,
                intensity: r.sessions / maxSessions,
            },
        });
    }
    return { type: 'FeatureCollection', features };
}

// Outer glow layer
const glowLayer: CircleLayerSpecification = {
    id: 'markers-glow',
    type: 'circle',
    source: 'markers',
    paint: {
        'circle-radius': [
            'interpolate', ['linear'], ['get', 'intensity'],
            0, 12,
            1, 35,
        ],
        'circle-color': [
            'match', ['get', 'tier'],
            2, 'rgba(74, 222, 128, 0.15)',   // green glow
            1, 'rgba(251, 191, 36, 0.15)',    // amber glow
            'rgba(168, 162, 158, 0.1)',        // stone glow
        ],
        'circle-blur': 1,
    },
};

// Core dot layer
const dotLayer: CircleLayerSpecification = {
    id: 'markers-dot',
    type: 'circle',
    source: 'markers',
    paint: {
        'circle-radius': [
            'interpolate', ['linear'], ['get', 'intensity'],
            0, 4,
            1, 14,
        ],
        'circle-color': [
            'match', ['get', 'tier'],
            2, '#4ade80',   // green-400
            1, '#fbbf24',   // amber-400
            '#a8a29e',      // stone-400
        ],
        'circle-opacity': 0.85,
        'circle-stroke-width': 1.5,
        'circle-stroke-color': [
            'match', ['get', 'tier'],
            2, 'rgba(74, 222, 128, 0.4)',
            1, 'rgba(251, 191, 36, 0.4)',
            'rgba(168, 162, 158, 0.3)',
        ],
    },
};

// ── Component ───────────────────────────────────────────────────────

interface GeoMapProps {
    data: GeoBreakdownRow[];
}

export const GeoMap = memo(function GeoMap({ data }: GeoMapProps) {
    const mapRef = useRef<MapRef>(null);
    const [view, setView] = useState<'india' | 'world'>('india');
    const [popup, setPopup] = useState<{
        lng: number; lat: number;
        label: string; sessions: number; pageViews: number;
        atcCount: number; orders: number; revenue: number;
    } | null>(null);

    const maxSessions = Math.max(...data.map(r => r.sessions), 1);
    const geojson = useMemo(() => buildGeoJSON(data, maxSessions), [data, maxSessions]);

    const flyTo = useCallback((preset: 'india' | 'world') => {
        setView(preset);
        mapRef.current?.flyTo({
            center: [VIEWS[preset].longitude, VIEWS[preset].latitude],
            zoom: VIEWS[preset].zoom,
            duration: 1200,
        });
    }, []);

    const handleClick = useCallback((e: maplibregl.MapLayerMouseEvent) => {
        const feature = e.features?.[0];
        if (!feature || feature.geometry.type !== 'Point') return;
        const props = feature.properties as MarkerFeatureProps;
        const [lng, lat] = feature.geometry.coordinates;
        setPopup({
            lng, lat,
            label: props.label,
            sessions: props.sessions,
            pageViews: props.pageViews,
            atcCount: props.atcCount,
            orders: props.orders,
            revenue: props.revenue,
        });
    }, []);

    const handleMouseEnter = useCallback(() => {
        const canvas = mapRef.current?.getCanvas();
        if (canvas) canvas.style.cursor = 'pointer';
    }, []);

    const handleMouseLeave = useCallback(() => {
        const canvas = mapRef.current?.getCanvas();
        if (canvas) canvas.style.cursor = '';
    }, []);

    return (
        <div className="relative rounded-lg overflow-hidden">
            {/* View toggle */}
            <div className="absolute top-3 right-3 z-10 flex gap-1 bg-black/50 backdrop-blur-sm rounded-md p-0.5">
                <button
                    onClick={() => flyTo('india')}
                    className={`px-2.5 py-1 text-xs font-medium rounded transition-colors ${
                        view === 'india'
                            ? 'bg-white/20 text-white'
                            : 'text-white/50 hover:text-white/80'
                    }`}
                >
                    India
                </button>
                <button
                    onClick={() => flyTo('world')}
                    className={`px-2.5 py-1 text-xs font-medium rounded transition-colors ${
                        view === 'world'
                            ? 'bg-white/20 text-white'
                            : 'text-white/50 hover:text-white/80'
                    }`}
                >
                    World
                </button>
            </div>

            <MapGL
                ref={mapRef}
                initialViewState={VIEWS.india}
                style={{ width: '100%', height: 420 }}
                mapStyle={MAP_STYLE}
                attributionControl={false}
                interactiveLayerIds={['markers-dot']}
                onClick={handleClick}
                onMouseEnter={handleMouseEnter}
                onMouseLeave={handleMouseLeave}
            >
                <Source id="markers" type="geojson" data={geojson}>
                    <Layer {...glowLayer} />
                    <Layer {...dotLayer} />
                </Source>

                {popup && (
                    <Popup
                        longitude={popup.lng}
                        latitude={popup.lat}
                        anchor="bottom"
                        onClose={() => setPopup(null)}
                        closeButton={false}
                        className="geo-popup"
                    >
                        <div className="text-xs min-w-[160px]">
                            <p className="font-semibold text-stone-900 mb-2">{popup.label}</p>
                            <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-stone-600">
                                <span>Sessions</span>
                                <span className="text-right font-medium text-stone-800">{popup.sessions.toLocaleString()}</span>
                                <span>Page Views</span>
                                <span className="text-right font-medium text-stone-800">{popup.pageViews.toLocaleString()}</span>
                                <span>Add to Cart</span>
                                <span className="text-right font-medium text-amber-600">{popup.atcCount}</span>
                                <span>Orders</span>
                                <span className="text-right font-medium text-green-600">{popup.orders}</span>
                                {popup.revenue > 0 && (
                                    <>
                                        <span>Revenue</span>
                                        <span className="text-right font-medium text-stone-800">
                                            {new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(popup.revenue)}
                                        </span>
                                    </>
                                )}
                                {popup.sessions > 0 && popup.orders > 0 && (
                                    <>
                                        <span>Conv. Rate</span>
                                        <span className="text-right font-medium text-green-600">
                                            {(popup.orders / popup.sessions * 100).toFixed(1)}%
                                        </span>
                                    </>
                                )}
                            </div>
                        </div>
                    </Popup>
                )}
            </MapGL>

            {/* Legend */}
            <div className="absolute bottom-3 left-3 flex items-center gap-4 bg-black/50 backdrop-blur-sm rounded-md px-3 py-1.5 text-[11px] text-white/70">
                <span className="flex items-center gap-1.5">
                    <span className="inline-block w-2 h-2 rounded-full bg-green-400" />
                    Orders
                </span>
                <span className="flex items-center gap-1.5">
                    <span className="inline-block w-2 h-2 rounded-full bg-amber-400" />
                    ATC
                </span>
                <span className="flex items-center gap-1.5">
                    <span className="inline-block w-2 h-2 rounded-full bg-stone-400" />
                    Views
                </span>
            </div>
        </div>
    );
});
