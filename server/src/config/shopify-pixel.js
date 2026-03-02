// ================================================
// COH Storefront Pixel — v3
// Paste into: Shopify Admin > Settings > Customer events > Add custom pixel
// Name: COH ERP Pixel
// Permission: Required (data collection for analytics)
// ================================================

const ENDPOINT = 'https://erp.creaturesofhabit.in/api/pixel/events';
const FLUSH_INTERVAL_MS = 2000;
const MAX_BATCH_SIZE = 50;
const MAX_RETRIES = 1;

// --- Session ID (only thing we generate locally) ---
let sessionId = null;
const idsReady = initSessionId();

async function initSessionId() {
  try {
    sessionId = await browser.sessionStorage.getItem('coh_sid');
    if (!sessionId) {
      sessionId = crypto.randomUUID ? crypto.randomUUID() :
        'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
          const r = Math.random() * 16 | 0;
          return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
        });
      await browser.sessionStorage.setItem('coh_sid', sessionId);
    }
  } catch {
    sessionId = 'fallback-' + Math.random().toString(36).slice(2);
  }
}

// --- UTM extraction ---
function getUtmParams(url) {
  try {
    const u = new URL(url);
    return {
      utmSource: u.searchParams.get('utm_source') || undefined,
      utmMedium: u.searchParams.get('utm_medium') || undefined,
      utmCampaign: u.searchParams.get('utm_campaign') || undefined,
      utmContent: u.searchParams.get('utm_content') || undefined,
      utmTerm: u.searchParams.get('utm_term') || undefined,
    };
  } catch {
    return {};
  }
}

// --- Device classification (viewport-based, not screen) ---
function getDeviceType(width) {
  const w = width || 0;
  if (w < 768) return 'mobile';
  if (w < 1024) return 'tablet';
  return 'desktop';
}

// --- Event queue + batching ---
let eventQueue = [];

// Checkout/cart events flush immediately
const IMMEDIATE_FLUSH_EVENTS = new Set([
  'product_added_to_cart',
  'checkout_started',
  'checkout_completed',
]);

async function enqueue(eventName, extraData, event) {
  // Wait for session ID to be ready
  await idsReady;

  const ctx = event.context || {};
  const pageUrl = ctx.document?.location?.href || '';
  const utms = getUtmParams(pageUrl);
  const innerWidth = ctx.window?.innerWidth || undefined;
  const innerHeight = ctx.window?.innerHeight || undefined;

  const payload = {
    eventName,
    eventTime: event.timestamp || new Date().toISOString(),
    sessionId,
    // Use Shopify's native client ID as visitor ID (cross-session, managed by Shopify)
    visitorId: event.clientId || 'unknown',
    // Shopify's native event metadata for dedupe and ordering
    shopifyEventId: event.id || undefined,
    shopifyClientId: event.clientId || undefined,
    shopifyTimestamp: event.timestamp || undefined,
    shopifySeq: event.seq || undefined,
    pageUrl,
    referrer: ctx.document?.referrer || undefined,
    ...utms,
    userAgent: ctx.navigator?.userAgent || undefined,
    screenWidth: innerWidth,
    screenHeight: innerHeight,
    deviceType: getDeviceType(innerWidth),
    ...extraData,
  };

  // Remove undefined/null/empty values
  const cleaned = {};
  for (const [k, v] of Object.entries(payload)) {
    if (v !== undefined && v !== null && v !== '') {
      cleaned[k] = v;
    }
  }

  eventQueue.push(cleaned);

  // Flush immediately for high-value events (user may leave)
  if (IMMEDIATE_FLUSH_EVENTS.has(eventName) || eventQueue.length >= MAX_BATCH_SIZE) {
    flush();
  } else {
    startFlushTimer();
  }
}

// Lazy flush timer — only runs when the queue has events
let flushTimer = null;
let isFlushing = false;

function startFlushTimer() {
  if (flushTimer) return;
  flushTimer = setTimeout(() => {
    flushTimer = null;
    flush();
  }, FLUSH_INTERVAL_MS);
}

function flush(retryCount) {
  if (eventQueue.length === 0 || isFlushing) return;
  isFlushing = true;
  retryCount = retryCount || 0;

  // Cancel any pending lazy timer — we're flushing now
  if (flushTimer) {
    clearTimeout(flushTimer);
    flushTimer = null;
  }

  const batch = eventQueue.splice(0, MAX_BATCH_SIZE);
  const body = JSON.stringify({ events: batch });

  fetch(ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body,
    keepalive: true,
  }).then(response => {
    isFlushing = false;
    // Retry once on server errors (5xx) or rate limiting (429)
    // Don't retry 4xx client errors — payload is invalid, retrying won't help
    const retryable = response.status >= 500 || response.status === 429;
    if (retryable && retryCount < MAX_RETRIES) {
      eventQueue.unshift(...batch);
      setTimeout(() => flush(retryCount + 1), 1000);
    }
    if (eventQueue.length > 0) startFlushTimer();
  }).catch(() => {
    isFlushing = false;
    if (retryCount < MAX_RETRIES) {
      eventQueue.unshift(...batch);
      setTimeout(() => flush(retryCount + 1), 1000);
    }
    if (eventQueue.length > 0) startFlushTimer();
  });
}

// --- Subscribe to Shopify Customer Events ---
// Privacy/consent is handled by Shopify at the platform level.
// Shopify gates pixel execution based on the pixel's configured permission
// and the shop's Customer Privacy settings per region. No client-side
// consent check needed — _tracking_consent cookie was deprecated Sep 2025.

analytics.subscribe('page_viewed', (event) => {
  enqueue('page_viewed', {}, event);
});

analytics.subscribe('product_viewed', (event) => {
  const d = event.data?.productVariant;
  enqueue('product_viewed', {
    productId: d?.product?.id ? String(d.product.id) : undefined,
    productTitle: d?.product?.title || undefined,
    variantId: d?.id ? String(d.id) : undefined,
    variantTitle: d?.title || undefined,
    rawData: { price: d?.price?.amount, currency: d?.price?.currencyCode },
  }, event);
});

analytics.subscribe('collection_viewed', (event) => {
  const c = event.data?.collection;
  enqueue('collection_viewed', {
    collectionId: c?.id ? String(c.id) : undefined,
    collectionTitle: c?.title || undefined,
  }, event);
});

analytics.subscribe('product_added_to_cart', (event) => {
  const cv = event.data?.cartLine;
  enqueue('product_added_to_cart', {
    productId: cv?.merchandise?.product?.id ? String(cv.merchandise.product.id) : undefined,
    productTitle: cv?.merchandise?.product?.title || undefined,
    variantId: cv?.merchandise?.id ? String(cv.merchandise.id) : undefined,
    variantTitle: cv?.merchandise?.title || undefined,
    cartValue: cv?.cost?.totalAmount?.amount ? parseFloat(cv.cost.totalAmount.amount) : undefined,
    rawData: { quantity: cv?.quantity },
  }, event);
});

analytics.subscribe('cart_viewed', (event) => {
  const cart = event.data?.cart;
  enqueue('cart_viewed', {
    cartValue: cart?.cost?.totalAmount?.amount ? parseFloat(cart.cost.totalAmount.amount) : undefined,
    rawData: { lineCount: cart?.lines?.length },
  }, event);
});

analytics.subscribe('checkout_started', (event) => {
  const co = event.data?.checkout;
  enqueue('checkout_started', {
    orderValue: co?.totalPrice?.amount ? parseFloat(co.totalPrice.amount) : undefined,
    rawData: { lineCount: co?.lineItems?.length },
  }, event);
});

analytics.subscribe('checkout_completed', (event) => {
  const co = event.data?.checkout;
  // Send ALL line items, not just the first one
  const items = (co?.lineItems || []).map(li => ({
    productId: li?.variant?.product?.id ? String(li.variant.product.id) : undefined,
    productTitle: li?.variant?.product?.title || undefined,
    variantId: li?.variant?.id ? String(li.variant.id) : undefined,
    variantTitle: li?.variant?.title || undefined,
    quantity: li?.quantity,
    linePrice: li?.finalLinePrice?.amount ? parseFloat(li.finalLinePrice.amount) : undefined,
  }));
  enqueue('checkout_completed', {
    productId: items[0]?.productId || undefined,
    productTitle: items[0]?.productTitle || undefined,
    variantId: items[0]?.variantId || undefined,
    variantTitle: items[0]?.variantTitle || undefined,
    orderValue: co?.totalPrice?.amount ? parseFloat(co.totalPrice.amount) : undefined,
    rawData: {
      orderId: co?.order?.id,
      lineCount: co?.lineItems?.length,
      currency: co?.currencyCode,
      discountAmount: co?.discountsAmount?.amount,
      items,
    },
  }, event);
});

analytics.subscribe('search_submitted', (event) => {
  enqueue('search_submitted', {
    searchQuery: event.data?.searchResult?.query || undefined,
    rawData: { resultCount: event.data?.searchResult?.productVariants?.length },
  }, event);
});

analytics.subscribe('checkout_address_info_submitted', (event) => {
  enqueue('checkout_address_info_submitted', {}, event);
});

analytics.subscribe('checkout_contact_info_submitted', (event) => {
  enqueue('checkout_contact_info_submitted', {}, event);
});

analytics.subscribe('checkout_shipping_info_submitted', (event) => {
  enqueue('checkout_shipping_info_submitted', {}, event);
});
