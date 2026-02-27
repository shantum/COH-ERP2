#!/usr/bin/env python3
"""
COH Demand Forecasting — Fabric-First
======================================
Forecasts fabric colour demand directly from historical order consumption.
Each fabric colour gets its own time series forecast (SARIMA + XGBoost).
Product drivers are derived from actual recent consumption, not estimated.
Outputs JSON (--json) or human-readable text.
"""

import pandas as pd
import numpy as np
import psycopg2
import json
import sys
from datetime import datetime, timedelta
import warnings
warnings.filterwarnings('ignore')

DB_URL = "postgresql://cohapp:cohsecure2026@128.140.98.253:5432/coherp"
FORECAST_WEEKS = 8
JSON_MODE = '--json' in sys.argv
MIN_WEEKS_ML = 30       # Minimum weeks of data for ML forecast
MIN_WEEKS_AVG = 4       # Minimum weeks with sales for simple avg
SIZE_ORDER = ['XS', 'S', 'M', 'L', 'XL', '2XL', '3XL']


def log(msg):
    if not JSON_MODE:
        print(msg)


def fetch_all_data():
    conn = psycopg2.connect(DB_URL)

    # Overall weekly orders
    weekly_total = pd.read_sql("""
        SELECT date_trunc('week', "orderDate")::date as week,
               COUNT(*) as orders,
               SUM("totalAmount") as revenue,
               COUNT(DISTINCT "customerId") as unique_customers,
               AVG("totalAmount") as aov
        FROM "Order" WHERE "orderDate" IS NOT NULL
        GROUP BY 1 ORDER BY 1
    """, conn)

    # Weekly product units (for product forecasts section)
    weekly_product = pd.read_sql("""
        SELECT date_trunc('week', o."orderDate")::date as week,
               p.name as product_name,
               SUM(ol.qty) as units
        FROM "OrderLine" ol
        JOIN "Order" o ON o.id = ol."orderId"
        JOIN "Sku" s ON s.id = ol."skuId"
        JOIN "Variation" v ON v.id = s."variationId"
        JOIN "Product" p ON p.id = v."productId"
        WHERE o."orderDate" IS NOT NULL
        GROUP BY 1, 2
    """, conn)

    # ── FABRIC-FIRST: Weekly fabric consumption from orders × BOM ──
    weekly_fabric = pd.read_sql("""
        SELECT date_trunc('week', o."orderDate")::date as week,
               fc.code as fc_code,
               fc."colourName" as colour,
               f.name as fabric_name,
               f.unit as fabric_unit,
               fc."costPerUnit",
               SUM(ol.qty * sbl.quantity
                   * (1 + COALESCE(sbl."wastagePercent", 5) / 100.0)) as fabric_qty
        FROM "OrderLine" ol
        JOIN "Order" o ON o.id = ol."orderId"
        JOIN "Sku" s ON s.id = ol."skuId"
        JOIN "Variation" v ON v.id = s."variationId"
        JOIN "SkuBomLine" sbl ON sbl."skuId" = s.id
        JOIN "VariationBomLine" vbl ON vbl."variationId" = v.id
                                   AND vbl."roleId" = sbl."roleId"
        JOIN "FabricColour" fc ON fc.id = vbl."fabricColourId"
        JOIN "Fabric" f ON f.id = fc."fabricId"
        WHERE o."orderDate" IS NOT NULL AND sbl.quantity > 0
        GROUP BY 1, 2, 3, 4, 5, 6
    """, conn)

    # Product-level fabric consumption (for drivers breakdown)
    fabric_by_product = pd.read_sql("""
        SELECT date_trunc('week', o."orderDate")::date as week,
               fc.code as fc_code,
               p.name as product_name,
               SUM(ol.qty * sbl.quantity
                   * (1 + COALESCE(sbl."wastagePercent", 5) / 100.0)) as fabric_qty
        FROM "OrderLine" ol
        JOIN "Order" o ON o.id = ol."orderId"
        JOIN "Sku" s ON s.id = ol."skuId"
        JOIN "Variation" v ON v.id = s."variationId"
        JOIN "Product" p ON p.id = v."productId"
        JOIN "SkuBomLine" sbl ON sbl."skuId" = s.id
        JOIN "VariationBomLine" vbl ON vbl."variationId" = v.id
                                   AND vbl."roleId" = sbl."roleId"
        JOIN "FabricColour" fc ON fc.id = vbl."fabricColourId"
        WHERE o."orderDate" >= NOW() - INTERVAL '8 weeks'
        AND sbl.quantity > 0
        GROUP BY 1, 2, 3
    """, conn)

    # Current fabric stock
    fabric_stock = pd.read_sql("""
        SELECT fc.code as fc_code, fc."currentBalance",
               fc."colourName" as colour,
               f.name as fabric_name, f.unit as fabric_unit
        FROM "FabricColour" fc
        JOIN "Fabric" f ON f.id = fc."fabricId"
        WHERE fc."currentBalance" IS NOT NULL
    """, conn)

    conn.close()
    return weekly_total, weekly_product, weekly_fabric, fabric_by_product, fabric_stock


# ── ML Models ────────────────────────────────────────────────────────

def create_time_features(df, target_col='units'):
    df = df.copy()
    df['week_dt'] = pd.to_datetime(df['week'])
    df = df.sort_values('week_dt').reset_index(drop=True)
    df['week_of_year'] = df['week_dt'].dt.isocalendar().week.astype(int)
    df['month'] = df['week_dt'].dt.month
    df['quarter'] = df['week_dt'].dt.quarter
    for lag in [1, 2, 3, 4, 8, 12, 52]:
        df[f'lag_{lag}'] = df[target_col].shift(lag)
    for window in [4, 8, 12]:
        df[f'rolling_mean_{window}'] = df[target_col].rolling(window).mean()
        df[f'rolling_std_{window}'] = df[target_col].rolling(window).std()
    df['yoy_change'] = df[target_col] - df[target_col].shift(52)
    df['trend'] = range(len(df))
    return df


def arima_forecast(series, steps=8):
    from statsmodels.tsa.statespace.sarimax import SARIMAX
    try:
        # Simple ARIMA — seasonal(52) is too slow for 70+ models and too few data points
        model = SARIMAX(series, order=(1,1,1),
                        enforce_stationarity=False, enforce_invertibility=False)
        fitted = model.fit(disp=False, maxiter=50)
        fc = fitted.get_forecast(steps=steps)
        return fc.predicted_mean.values, fc.conf_int(alpha=0.2).values
    except:
        return None, None


def xgboost_forecast(df, target_col='units', steps=8):
    from xgboost import XGBRegressor
    feature_cols = [c for c in df.columns if c.startswith(('lag_', 'rolling_', 'week_of', 'month', 'quarter', 'trend', 'yoy'))]
    train = df.dropna(subset=feature_cols + [target_col]).copy()
    if len(train) < 20:
        return None
    X, y = train[feature_cols].values, train[target_col].values
    model = XGBRegressor(n_estimators=50, max_depth=3, learning_rate=0.1,
                         subsample=0.8, colsample_bytree=0.8, random_state=42)
    model.fit(X, y, verbose=False)
    last_row = df.iloc[-1].copy()
    predictions = []
    for i in range(steps):
        new_row = last_row.copy()
        new_row['week_dt'] = last_row['week_dt'] + timedelta(weeks=1)
        new_row['week_of_year'] = new_row['week_dt'].isocalendar()[1]
        new_row['month'] = new_row['week_dt'].month
        new_row['quarter'] = (new_row['month'] - 1) // 3 + 1
        new_row['trend'] = last_row['trend'] + 1
        new_row['lag_1'] = predictions[-1] if predictions else last_row[target_col]
        features = np.nan_to_num(np.array([new_row[c] for c in feature_cols]).reshape(1, -1), nan=0.0)
        predictions.append(max(0, float(model.predict(features)[0])))
        last_row = new_row
    return predictions


def forecast_series(df, target_col='units', steps=8):
    """Run SARIMA + XGBoost ensemble on a weekly time series."""
    df = df.copy()
    df['week_dt'] = pd.to_datetime(df['week'])
    df = df.sort_values('week_dt')
    series = df.set_index('week_dt')[target_col].asfreq('W-MON').ffill()
    arima_pred, arima_ci = arima_forecast(series, steps)
    df_feat = create_time_features(df, target_col)
    xgb_pred = xgboost_forecast(df_feat, target_col, steps)
    last_date = df['week_dt'].max()
    forecasts = []
    for i in range(steps):
        date = last_date + timedelta(weeks=i+1)
        a = arima_pred[i] if arima_pred is not None else None
        x = xgb_pred[i] if xgb_pred is not None else None
        if a is not None and x is not None:
            ens = 0.4 * a + 0.6 * x
            lo = arima_ci[i][0] if arima_ci is not None else ens * 0.8
            hi = arima_ci[i][1] if arima_ci is not None else ens * 1.2
        elif x is not None:
            ens, lo, hi = x, x * 0.8, x * 1.2
        elif a is not None:
            ens, lo, hi = a, arima_ci[i][0], arima_ci[i][1]
        else:
            continue
        forecasts.append({
            'week': date.strftime('%Y-%m-%d'),
            'forecast': round(max(0, ens), 1),
            'low': round(max(0, lo), 1),
            'high': round(max(0, hi), 1)
        })
    return forecasts


# ══════════════════════════════════════════════════════════════════════
if __name__ == '__main__':
    log("Fetching data...")
    weekly_total, weekly_product, weekly_fabric, fabric_by_product, fabric_stock = fetch_all_data()
    weekly_product['week'] = pd.to_datetime(weekly_product['week']).dt.date

    # ── Overall stats ────────────────────────────────────────────────
    wt = weekly_total.copy()
    wt['week_dt'] = pd.to_datetime(wt['week'])
    wt = wt.sort_values('week_dt')
    if len(wt) > 2:
        wt = wt.iloc[1:-1]

    recent_12 = wt.tail(12)
    prev_12 = wt.iloc[-24:-12]

    overall = {
        'totalOrders': int(wt['orders'].sum()),
        'weeksOfData': len(wt),
        'dateRange': {'from': str(wt['week'].min()), 'to': str(wt['week'].max())},
        'recent12wAvg': round(float(recent_12['orders'].mean()), 1),
        'prev12wAvg': round(float(prev_12['orders'].mean()), 1),
        'recentAov': round(float(recent_12['aov'].mean()), 0),
        'prevAov': round(float(prev_12['aov'].mean()), 0),
    }

    if len(wt) > 56:
        yoy_same = float(wt.iloc[-56:-48]['orders'].mean())
        overall['yoySameperiodAvg'] = round(yoy_same, 1)

    wt['month'] = wt['week_dt'].dt.month
    monthly_avg = wt.groupby('month')['orders'].mean()
    overall_avg = monthly_avg.mean()
    months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
    overall['seasonality'] = [
        {'month': months[m-1], 'index': round(float(monthly_avg.get(m, 0) / overall_avg * 100), 0)}
        for m in range(1, 13)
    ]

    history = []
    for _, row in wt.tail(52).iterrows():
        history.append({
            'week': str(row['week']),
            'orders': int(row['orders']),
            'revenue': round(float(row['revenue']), 0) if pd.notna(row['revenue']) else 0,
            'aov': round(float(row['aov']), 0) if pd.notna(row['aov']) else 0,
        })

    # ── Overall order forecast ────────────────────────────────────────
    log("Running overall order forecast...")
    overall_fc = forecast_series(wt.rename(columns={'orders': 'units'}), 'units', FORECAST_WEEKS)

    # Revenue forecast (orders × recent AOV)
    recent_aov = float(recent_12['aov'].mean())
    log(f"Revenue forecast using recent 12w AOV: ₹{recent_aov:,.0f}")
    revenue_fc = [
        {
            'week': fc['week'],
            'forecast': round(fc['forecast'] * recent_aov, 0),
            'low': round(fc['low'] * recent_aov, 0),
            'high': round(fc['high'] * recent_aov, 0),
        }
        for fc in overall_fc
    ]

    # ═══════════════════════════════════════════════════════════════════
    # FABRIC-FIRST FORECASTING
    # Forecast each fabric colour's consumption directly from its own
    # time series, rather than forecasting products and distributing.
    # ═══════════════════════════════════════════════════════════════════
    log("Running fabric-first forecasting...")

    # Aggregate weekly consumption per fabric colour
    wf = weekly_fabric.copy()
    wf['week'] = pd.to_datetime(wf['week']).dt.date
    # Don't groupby costPerUnit — NaN values cause pandas to drop rows
    wf_agg = wf.groupby(['week', 'fc_code', 'colour', 'fabric_name', 'fabric_unit']).agg(
        fabric_qty=('fabric_qty', 'sum')
    ).reset_index()

    # Build a cost lookup separately (take first non-null cost per fc_code)
    cost_lookup = wf.dropna(subset=['costPerUnit']).drop_duplicates('fc_code').set_index('fc_code')['costPerUnit'].to_dict()

    # Get unique fabric colours
    fc_codes = wf_agg['fc_code'].unique()
    log(f"  {len(fc_codes)} fabric colours found in order history")

    # Build product drivers from actual last 8 weeks consumption
    fbp = fabric_by_product.copy()
    drivers_by_fc = {}
    if not fbp.empty:
        driver_agg = fbp.groupby(['fc_code', 'product_name'])['fabric_qty'].sum().reset_index()
        for fc_code in driver_agg['fc_code'].unique():
            fc_drivers = driver_agg[driver_agg['fc_code'] == fc_code].sort_values('fabric_qty', ascending=False)
            drivers_by_fc[fc_code] = [
                {'product': row['product_name'], 'qty': round(float(row['fabric_qty']), 1)}
                for _, row in fc_drivers.iterrows()
                if row['fabric_qty'] > 0.1
            ]

    # Forecast each fabric colour
    fabric_forecasts = {}  # fc_code -> {info + forecast_total + method + history + forecasts}
    ml_count = 0
    avg_count = 0
    skip_count = 0

    for fc_code in fc_codes:
        fc_data = wf_agg[wf_agg['fc_code'] == fc_code].copy()
        fc_info = fc_data.iloc[0]
        ts = fc_data.groupby('week').agg({'fabric_qty': 'sum'}).reset_index()
        ts = ts.rename(columns={'fabric_qty': 'units'})
        ts = ts.sort_values('week')

        # Count weeks with actual sales
        recent_8w = ts.tail(8)
        weeks_with_sales = (recent_8w['units'] > 0).sum()

        if weeks_with_sales < MIN_WEEKS_AVG:
            skip_count += 1
            continue

        recent_avg = float(recent_8w['units'].mean())

        if len(ts) >= MIN_WEEKS_ML:
            # ML forecast
            forecasts = forecast_series(ts, 'units', FORECAST_WEEKS)
            if forecasts:
                total_fc = sum(f['forecast'] for f in forecasts)
                method = 'ml'
                ml_count += 1
            else:
                total_fc = recent_avg * FORECAST_WEEKS
                forecasts = []
                method = 'avg'
                avg_count += 1
        else:
            total_fc = recent_avg * FORECAST_WEEKS
            forecasts = []
            method = 'avg'
            avg_count += 1

        if total_fc < 0.1:
            skip_count += 1
            continue

        # Weekly history (last 26 weeks)
        fc_history = []
        for _, row in ts.tail(26).iterrows():
            fc_history.append({'week': str(row['week']), 'qty': round(float(row['units']), 1)})

        cost = float(cost_lookup.get(fc_code, 0))

        fabric_forecasts[fc_code] = {
            'fc_code': fc_code,
            'colour': fc_info['colour'],
            'fabric_name': fc_info['fabric_name'],
            'fabric_unit': fc_info['fabric_unit'],
            'cost': cost,
            'forecast_total': round(total_fc, 1),
            'recent8wTotal': round(float(recent_8w['units'].sum()), 1),
            'recent8wAvg': round(recent_avg, 1),
            'method': method,
            'history': fc_history,
            'forecasts': forecasts,
            'drivers': drivers_by_fc.get(fc_code, []),
        }

    log(f"  ML forecasts: {ml_count} | Simple avg: {avg_count} | Skipped: {skip_count}")

    # ── Assemble fabric requirements (grouped by fabric type) ─────────
    fabrics_by_type = {}
    for fc_code, fc in fabric_forecasts.items():
        fname = fc['fabric_name']
        if fname not in fabrics_by_type:
            fabrics_by_type[fname] = {
                'name': fname,
                'unit': fc['fabric_unit'],
                'totalQty': 0,
                'colours': [],
            }
        fabrics_by_type[fname]['totalQty'] += fc['forecast_total']

        stock_row = fabric_stock[fabric_stock['fc_code'] == fc_code]
        current = float(stock_row['currentBalance'].sum()) if not stock_row.empty else 0
        gap = fc['forecast_total'] - current

        fabrics_by_type[fname]['colours'].append({
            'code': fc_code,
            'colour': fc['colour'],
            'required': fc['forecast_total'],
            'inStock': round(current, 1),
            'gap': round(gap, 1),
            'costPerUnit': fc['cost'],
            'orderCost': round(max(0, gap) * fc['cost'], 0) if fc['cost'] > 0 else 0,
            'method': fc['method'],
            'recent8wTotal': fc['recent8wTotal'],
            'recent8wAvg': fc['recent8wAvg'],
            'history': fc['history'],
            'forecasts': fc['forecasts'],
            'drivers': fc['drivers'],
        })

    fabric_list = sorted(fabrics_by_type.values(), key=lambda x: -x['totalQty'])
    for f in fabric_list:
        f['totalQty'] = round(f['totalQty'], 1)
        f['colours'].sort(key=lambda x: -x['required'])

    # ── Purchase orders (shortfalls only) ─────────────────────────────
    shortfalls = []
    for fc_code, fc in fabric_forecasts.items():
        stock_row = fabric_stock[fabric_stock['fc_code'] == fc_code]
        current = float(stock_row['currentBalance'].sum()) if not stock_row.empty else 0
        gap = fc['forecast_total'] - current
        if gap > 0:
            shortfalls.append({
                'code': fc_code,
                'fabric': fc['fabric_name'],
                'colour': fc['colour'],
                'unit': fc['fabric_unit'],
                'required': fc['forecast_total'],
                'inStock': round(current, 1),
                'toOrder': round(gap, 1),
                'costPerUnit': fc['cost'],
                'estCost': round(gap * fc['cost'], 0) if fc['cost'] > 0 else 0,
            })
    shortfalls.sort(key=lambda x: -x['required'])

    total_fabric_qty = sum(fc['forecast_total'] for fc in fabric_forecasts.values())
    total_order_cost = sum(s['estCost'] for s in shortfalls)
    covered = sum(1 for fc_code, fc in fabric_forecasts.items()
                  if float(fabric_stock[fabric_stock['fc_code'] == fc_code]['currentBalance'].sum()) >= fc['forecast_total'])

    # ── Product forecasts (top 10, kept for context) ──────────────────
    log("Running top 10 product forecasts...")
    cutoff_12mo = (datetime.now() - timedelta(days=365)).date()
    recent = weekly_product[weekly_product['week'] >= cutoff_12mo]
    product_rank = recent.groupby('product_name')['units'].sum().sort_values(ascending=False).head(10)

    products = []
    for product_name, last_12mo in product_rank.items():
        prod_data = weekly_product[weekly_product['product_name'] == product_name]
        prod_data = prod_data.groupby('week').agg({'units': 'sum'}).reset_index()
        if len(prod_data) < 30:
            continue

        recent_8w = float(prod_data.tail(8)['units'].mean())
        forecasts = forecast_series(prod_data, 'units', FORECAST_WEEKS)
        total_fc = sum(f['forecast'] for f in forecasts)

        prod_history = []
        for _, row in prod_data.tail(26).iterrows():
            prod_history.append({'week': str(row['week']), 'units': int(row['units'])})

        products.append({
            'name': product_name,
            'last12moUnits': int(last_12mo),
            'recent8wAvg': round(recent_8w, 1),
            'forecastTotal': round(total_fc, 0),
            'forecasts': forecasts,
            'sizeBreakdown': [],
            'colourBreakdown': [],
            'history': prod_history,
        })

    # ── Result ────────────────────────────────────────────────────────
    result = {
        'generatedAt': datetime.now().isoformat(),
        'forecastWeeks': FORECAST_WEEKS,
        'overall': overall,
        'weeklyHistory': history,
        'overallForecast': overall_fc,
        'revenueForecast': revenue_fc,
        'products': products,
        'fabricRequirements': fabric_list,
        'purchaseOrders': shortfalls,
        'summary': {
            'totalForecastUnits': round(sum(p['forecastTotal'] for p in products), 0),
            'productsForecasted': len(products),
            'fabricTypesNeeded': len(fabric_list),
            'fabricColoursNeeded': len(fabric_forecasts),
            'fabricColoursML': ml_count,
            'fabricColoursAvg': avg_count,
            'shortfallCount': len(shortfalls),
            'coveredByStock': covered,
            'estimatedPurchaseCost': total_order_cost,
            'totalFabricQty': round(total_fabric_qty, 1),
        }
    }

    if JSON_MODE:
        print(json.dumps(result, default=str))
    else:
        print(f"\n{'#'*65}")
        print(f"  FABRIC DEMAND FORECAST — {datetime.now().strftime('%Y-%m-%d')}")
        print(f"{'#'*65}")
        print(f"\n  Data: {overall['totalOrders']:,} orders over {overall['weeksOfData']} weeks")
        print(f"  Recent 12w avg: {overall['recent12wAvg']}/wk | AOV: ₹{overall['recentAov']:,.0f}")
        print(f"  Fabric colours: {len(fabric_forecasts)} ({ml_count} ML + {avg_count} simple avg)")

        print(f"\n  FABRIC REQUIREMENTS ({FORECAST_WEEKS}-week projection):")
        for fab in fabric_list:
            print(f"\n  {fab['name']} — {fab['totalQty']:.1f} {fab['unit']}")
            for c in fab['colours']:
                status = f"ORDER {c['gap']:.1f}" if c['gap'] > 0 else f"OK (+{-c['gap']:.1f})"
                tag = '🤖' if c['method'] == 'ml' else '📊'
                print(f"    {tag} {c['code']:<16} {c['colour']:<20} need:{c['required']:>7.1f}  stock:{c['inStock']:>7.1f}  {status}")
                if c['drivers']:
                    for d in c['drivers'][:3]:
                        print(f"       └─ {d['product']}: {d['qty']:.1f} {fab['unit']}")

        print(f"\n  SUMMARY: {len(fabric_forecasts)} fabric colours | {len(shortfalls)} to order")
        if total_order_cost > 0:
            print(f"  Est. purchase: ₹{total_order_cost:,.0f}")
