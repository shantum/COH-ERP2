#!/usr/bin/env python3
"""
COH Demand Forecasting + Fabric Requirements
=============================================
Forecasts weekly demand by product, maps to fabric requirements via BOM.
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
WASTAGE_DEFAULT = 5
JSON_MODE = '--json' in sys.argv
SIZE_ORDER = ['XS', 'S', 'M', 'L', 'XL', '2XL', '3XL']


def log(msg):
    if not JSON_MODE:
        print(msg)


def fetch_all_data():
    conn = psycopg2.connect(DB_URL)

    weekly_total = pd.read_sql("""
        SELECT date_trunc('week', "orderDate")::date as week,
               COUNT(*) as orders,
               SUM("totalAmount") as revenue,
               COUNT(DISTINCT "customerId") as unique_customers,
               AVG("totalAmount") as aov
        FROM "Order" WHERE "orderDate" IS NOT NULL
        GROUP BY 1 ORDER BY 1
    """, conn)

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

    size_mix = pd.read_sql("""
        SELECT p.name as product_name, s.size, SUM(ol.qty) as units
        FROM "OrderLine" ol
        JOIN "Order" o ON o.id = ol."orderId"
        JOIN "Sku" s ON s.id = ol."skuId"
        JOIN "Variation" v ON v.id = s."variationId"
        JOIN "Product" p ON p.id = v."productId"
        WHERE o."orderDate" >= NOW() - INTERVAL '6 months'
        GROUP BY 1, 2
    """, conn)

    variation_mix = pd.read_sql("""
        SELECT p.name as product_name,
               v.id as variation_id, v."colorName" as colour,
               SUM(ol.qty) as units
        FROM "OrderLine" ol
        JOIN "Order" o ON o.id = ol."orderId"
        JOIN "Sku" s ON s.id = ol."skuId"
        JOIN "Variation" v ON v.id = s."variationId"
        JOIN "Product" p ON p.id = v."productId"
        WHERE o."orderDate" >= NOW() - INTERVAL '6 months'
        GROUP BY 1, 2, 3
    """, conn)

    bom = pd.read_sql("""
        SELECT s.id as sku_id, s.size,
               v.id as variation_id, v."colorName" as variation_colour,
               p.name as product_name,
               f.name as fabric_name, f.unit as fabric_unit,
               fc.id as fabric_colour_id, fc."colourName" as fabric_colour,
               fc.code as fc_code, fc."costPerUnit",
               sbl.quantity as qty_per_unit, sbl."wastagePercent"
        FROM "SkuBomLine" sbl
        JOIN "Sku" s ON s.id = sbl."skuId"
        JOIN "Variation" v ON v.id = s."variationId"
        JOIN "VariationBomLine" vbl ON vbl."variationId" = v.id AND vbl."roleId" = sbl."roleId"
        JOIN "FabricColour" fc ON fc.id = vbl."fabricColourId"
        JOIN "Fabric" f ON f.id = fc."fabricId"
        JOIN "Product" p ON p.id = v."productId"
        WHERE sbl.quantity IS NOT NULL AND sbl.quantity > 0
    """, conn)

    fabric_stock = pd.read_sql("""
        SELECT fc.id as fabric_colour_id, fc."colourName" as fabric_colour,
               fc.code as fc_code, fc."currentBalance",
               f.name as fabric_name, f.unit as fabric_unit
        FROM "FabricColour" fc
        JOIN "Fabric" f ON f.id = fc."fabricId"
        WHERE fc."currentBalance" IS NOT NULL
    """, conn)

    conn.close()
    return weekly_total, weekly_product, size_mix, variation_mix, bom, fabric_stock


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


def sarima_forecast(series, steps=8):
    from statsmodels.tsa.statespace.sarimax import SARIMAX
    try:
        model = SARIMAX(series, order=(1,1,1), seasonal_order=(1,1,0,52),
                        enforce_stationarity=False, enforce_invertibility=False)
        fitted = model.fit(disp=False, maxiter=200)
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
    model = XGBRegressor(n_estimators=200, max_depth=4, learning_rate=0.05,
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
    df = df.copy()
    df['week_dt'] = pd.to_datetime(df['week'])
    df = df.sort_values('week_dt')
    series = df.set_index('week_dt')[target_col].asfreq('W-MON').ffill()
    sarima_pred, sarima_ci = sarima_forecast(series, steps)
    df_feat = create_time_features(df, target_col)
    xgb_pred = xgboost_forecast(df_feat, target_col, steps)
    last_date = df['week_dt'].max()
    forecasts = []
    for i in range(steps):
        date = last_date + timedelta(weeks=i+1)
        s = sarima_pred[i] if sarima_pred is not None else None
        x = xgb_pred[i] if xgb_pred is not None else None
        if s is not None and x is not None:
            ens = 0.4 * s + 0.6 * x
            lo = sarima_ci[i][0] if sarima_ci is not None else ens * 0.8
            hi = sarima_ci[i][1] if sarima_ci is not None else ens * 1.2
        elif x is not None:
            ens, lo, hi = x, x * 0.8, x * 1.2
        elif s is not None:
            ens, lo, hi = s, sarima_ci[i][0], sarima_ci[i][1]
        else:
            continue
        forecasts.append({
            'week': date.strftime('%Y-%m-%d'),
            'forecast': round(max(0, ens), 1),
            'low': round(max(0, lo), 1),
            'high': round(max(0, hi), 1)
        })
    return forecasts


def compute_fabric_needs(product_name, total_units, size_mix_df, variation_mix_df, bom_df):
    var_data = variation_mix_df[variation_mix_df['product_name'] == product_name]
    if var_data.empty:
        return {}
    var_total = var_data['units'].sum()
    var_props = dict(zip(var_data['variation_id'], var_data['units'] / var_total))

    sz_data = size_mix_df[size_mix_df['product_name'] == product_name]
    if sz_data.empty:
        return {}
    sz_total = sz_data['units'].sum()
    sz_props = dict(zip(sz_data['size'], sz_data['units'] / sz_total))

    needs = {}
    for var_id, var_pct in var_props.items():
        var_units = total_units * var_pct
        for size, sz_pct in sz_props.items():
            size_units = var_units * sz_pct
            bom_rows = bom_df[(bom_df['variation_id'] == var_id) & (bom_df['size'] == size)]
            for _, row in bom_rows.iterrows():
                wastage = row['wastagePercent'] if pd.notna(row['wastagePercent']) and row['wastagePercent'] > 0 else WASTAGE_DEFAULT
                fabric_qty = size_units * row['qty_per_unit'] * (1 + wastage / 100)
                code = row['fc_code']
                if code not in needs:
                    needs[code] = {
                        'fabric': row['fabric_name'],
                        'colour': row['fabric_colour'],
                        'unit': row['fabric_unit'],
                        'qty': 0,
                        'fc_id': row['fabric_colour_id'],
                        'cost': float(row['costPerUnit']) if pd.notna(row['costPerUnit']) else 0
                    }
                needs[code]['qty'] += fabric_qty
    return needs


# ══════════════════════════════════════════════════════════════════════
if __name__ == '__main__':
    log("Fetching data...")
    weekly_total, weekly_product, size_mix, variation_mix, bom, fabric_stock = fetch_all_data()
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

    # YoY
    if len(wt) > 56:
        yoy_same = float(wt.iloc[-56:-48]['orders'].mean())
        overall['yoySameperiodAvg'] = round(yoy_same, 1)

    # Seasonality
    wt['month'] = wt['week_dt'].dt.month
    monthly_avg = wt.groupby('month')['orders'].mean()
    overall_avg = monthly_avg.mean()
    months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
    overall['seasonality'] = [
        {'month': months[m-1], 'index': round(float(monthly_avg.get(m, 0) / overall_avg * 100), 0)}
        for m in range(1, 13)
    ]

    # Weekly history for chart (last 52 weeks)
    history = []
    for _, row in wt.tail(52).iterrows():
        history.append({
            'week': str(row['week']),
            'orders': int(row['orders']),
            'revenue': round(float(row['revenue']), 0) if pd.notna(row['revenue']) else 0,
            'aov': round(float(row['aov']), 0) if pd.notna(row['aov']) else 0,
        })

    # ── Overall forecast (orders) ──────────────────────────────────────
    log("Running overall order forecast...")
    overall_fc = forecast_series(wt.rename(columns={'orders': 'units'}), 'units', FORECAST_WEEKS)

    # ── Revenue forecast (orders × recent AOV) ──────────────────────
    recent_aov = float(recent_12['aov'].mean())
    log(f"Revenue forecast using recent 12w AOV: ₹{recent_aov:,.0f}")
    revenue_fc = []
    for fc in overall_fc:
        revenue_fc.append({
            'week': fc['week'],
            'forecast': round(fc['forecast'] * recent_aov, 0),
            'low': round(fc['low'] * recent_aov, 0),
            'high': round(fc['high'] * recent_aov, 0),
        })

    # ── Product forecasts (top 10 with ML) ───────────────────────────
    cutoff_12mo = (datetime.now() - timedelta(days=365)).date()
    recent = weekly_product[weekly_product['week'] >= cutoff_12mo]
    product_rank = recent.groupby('product_name')['units'].sum().sort_values(ascending=False).head(10)

    products = []
    all_fabric_needs = {}
    ml_forecasted_products = set()

    for product_name, last_12mo in product_rank.items():
        log(f"  Forecasting {product_name}...")
        prod_data = weekly_product[weekly_product['product_name'] == product_name]
        prod_data = prod_data.groupby('week').agg({'units': 'sum'}).reset_index()

        if len(prod_data) < 30:
            continue

        recent_8w = float(prod_data.tail(8)['units'].mean())
        forecasts = forecast_series(prod_data, 'units', FORECAST_WEEKS)
        total_fc = sum(f['forecast'] for f in forecasts)

        ml_forecasted_products.add(product_name)

        # Size mix
        sz = size_mix[size_mix['product_name'] == product_name]
        sz_total = sz['units'].sum() if not sz.empty else 0
        size_breakdown = []
        if sz_total > 0:
            for size in SIZE_ORDER:
                sz_row = sz[sz['size'] == size]
                if not sz_row.empty:
                    pct = float(sz_row['units'].sum() / sz_total)
                    size_breakdown.append({
                        'size': size,
                        'pct': round(pct * 100, 1),
                        'units': round(total_fc * pct, 0)
                    })

        # Colour mix
        var = variation_mix[variation_mix['product_name'] == product_name]
        var_total = var['units'].sum() if not var.empty else 0
        colour_breakdown = []
        if var_total > 0:
            for _, row in var.sort_values('units', ascending=False).iterrows():
                pct = float(row['units'] / var_total)
                colour_breakdown.append({
                    'colour': row['colour'],
                    'pct': round(pct * 100, 1),
                    'units': round(total_fc * pct, 0)
                })

        # Weekly history for this product (last 26 weeks)
        prod_history = []
        for _, row in prod_data.tail(26).iterrows():
            prod_history.append({'week': str(row['week']), 'units': int(row['units'])})

        products.append({
            'name': product_name,
            'last12moUnits': int(last_12mo),
            'recent8wAvg': round(recent_8w, 1),
            'forecastTotal': round(total_fc, 0),
            'forecasts': forecasts,
            'sizeBreakdown': size_breakdown,
            'colourBreakdown': colour_breakdown,
            'history': prod_history,
        })

        # Fabric needs for ML-forecasted products
        needs = compute_fabric_needs(product_name, total_fc, size_mix, variation_mix, bom)
        for code, info in needs.items():
            if code in all_fabric_needs:
                all_fabric_needs[code]['qty'] += info['qty']
            else:
                all_fabric_needs[code] = info.copy()

    # ── Fabric needs for ALL other products (simple avg projection) ──
    log("Computing fabric for remaining products (simple avg)...")
    # Get all product names that have BOM data and recent sales
    all_product_names = set(size_mix['product_name'].unique()) & set(variation_mix['product_name'].unique())
    bom_products = set(bom['product_name'].unique())
    remaining_products = (all_product_names & bom_products) - ml_forecasted_products

    remaining_count = 0
    for product_name in remaining_products:
        # Use last 8 weeks average * forecast weeks as simple estimate
        prod_data = weekly_product[weekly_product['product_name'] == product_name]
        prod_data = prod_data.groupby('week').agg({'units': 'sum'}).reset_index()

        if prod_data.empty:
            continue

        recent_avg = float(prod_data.tail(8)['units'].mean())
        total_fc = recent_avg * FORECAST_WEEKS

        if total_fc < 1:
            continue

        remaining_count += 1
        needs = compute_fabric_needs(product_name, total_fc, size_mix, variation_mix, bom)
        for code, info in needs.items():
            if code in all_fabric_needs:
                all_fabric_needs[code]['qty'] += info['qty']
            else:
                all_fabric_needs[code] = info.copy()

    log(f"  Added fabric needs from {remaining_count} additional products")

    # ── Fabric requirements ──────────────────────────────────────────
    log("Computing fabric requirements...")
    fabrics_by_type = {}
    for code, info in all_fabric_needs.items():
        fname = info['fabric']
        if fname not in fabrics_by_type:
            fabrics_by_type[fname] = {'name': fname, 'unit': info['unit'], 'totalQty': 0, 'colours': []}
        fabrics_by_type[fname]['totalQty'] += info['qty']

        stock_row = fabric_stock[fabric_stock['fc_code'] == code]
        current = float(stock_row['currentBalance'].sum()) if not stock_row.empty else 0
        gap = info['qty'] - current

        fabrics_by_type[fname]['colours'].append({
            'code': code,
            'colour': info['colour'],
            'required': round(info['qty'], 1),
            'inStock': round(current, 1),
            'gap': round(gap, 1),
            'costPerUnit': info['cost'],
            'orderCost': round(max(0, gap) * info['cost'], 0) if info['cost'] > 0 else 0,
        })

    fabric_list = sorted(fabrics_by_type.values(), key=lambda x: -x['totalQty'])
    for f in fabric_list:
        f['totalQty'] = round(f['totalQty'], 1)
        f['colours'].sort(key=lambda x: -x['required'])

    # Purchase orders
    shortfalls = []
    for code, info in all_fabric_needs.items():
        stock_row = fabric_stock[fabric_stock['fc_code'] == code]
        current = float(stock_row['currentBalance'].sum()) if not stock_row.empty else 0
        gap = info['qty'] - current
        if gap > 0:
            shortfalls.append({
                'code': code,
                'fabric': info['fabric'],
                'colour': info['colour'],
                'unit': info['unit'],
                'required': round(info['qty'], 1),
                'inStock': round(current, 1),
                'toOrder': round(gap, 1),
                'costPerUnit': info['cost'],
                'estCost': round(gap * info['cost'], 0) if info['cost'] > 0 else 0,
            })
    shortfalls.sort(key=lambda x: -x['required'])

    total_units = sum(p['forecastTotal'] for p in products)
    total_order_cost = sum(s['estCost'] for s in shortfalls)
    covered = sum(1 for code, info in all_fabric_needs.items()
                  if float(fabric_stock[fabric_stock['fc_code'] == code]['currentBalance'].sum()) >= info['qty'])

    result = {
        'generatedAt': datetime.now().isoformat(),
        'forecastWeeks': FORECAST_WEEKS,
        'wastagePercent': WASTAGE_DEFAULT,
        'overall': overall,
        'weeklyHistory': history,
        'overallForecast': overall_fc,
        'revenueForecast': revenue_fc,
        'products': products,
        'fabricRequirements': fabric_list,
        'purchaseOrders': shortfalls,
        'summary': {
            'totalForecastUnits': round(total_units, 0),
            'productsForecasted': len(products),
            'fabricTypesNeeded': len(fabric_list),
            'fabricColoursNeeded': len(all_fabric_needs),
            'shortfallCount': len(shortfalls),
            'coveredByStock': covered,
            'estimatedPurchaseCost': total_order_cost,
        }
    }

    if JSON_MODE:
        print(json.dumps(result, default=str))
    else:
        # Human-readable output
        print(f"\n{'#'*65}")
        print(f"  DEMAND FORECAST — {datetime.now().strftime('%Y-%m-%d')}")
        print(f"{'#'*65}")
        print(f"\n  Data: {overall['totalOrders']:,} orders over {overall['weeksOfData']} weeks")
        print(f"  Recent 12w avg: {overall['recent12wAvg']}/wk | AOV: ₹{overall['recentAov']:,.0f}")

        for p in products:
            print(f"\n  {'─'*60}")
            print(f"  {p['name']} — {p['forecastTotal']:.0f} units ({FORECAST_WEEKS}wk)")
            for f in p['forecasts']:
                print(f"    {f['week']}  {f['forecast']:>6.0f}  ({f['low']:.0f}-{f['high']:.0f})")

        print(f"\n\n  FABRIC REQUIREMENTS:")
        for fab in fabric_list:
            print(f"\n  {fab['name']} — {fab['totalQty']:.1f} {fab['unit']}")
            for c in fab['colours']:
                status = f"ORDER {c['gap']:.1f}" if c['gap'] > 0 else f"OK (+{-c['gap']:.1f})"
                print(f"    {c['code']:<16} {c['colour']:<20} need:{c['required']:>7.1f}  stock:{c['inStock']:>7.1f}  {status}")

        print(f"\n  SUMMARY: {total_units:.0f} units | {len(shortfalls)} fabrics to order")
        if total_order_cost > 0:
            print(f"  Est. purchase: ₹{total_order_cost:,.0f}")
