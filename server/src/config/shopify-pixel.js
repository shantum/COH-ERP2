// ================================================
// COH Storefront Pixel — v2
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
    eventTime: new Date().toISOString(),
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
  }
}

function flush(retryCount) {
  if (eventQueue.length === 0) return;
  retryCount = retryCount || 0;

  const batch = eventQueue.splice(0, MAX_BATCH_SIZE);
  const body = JSON.stringify({ events: batch });

  fetch(ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body,
    keepalive: true,
  }).catch(() => {
    // One retry on failure, then drop
    if (retryCount < MAX_RETRIES) {
      // Put events back and retry after a short delay
      eventQueue.unshift(...batch);
      setTimeout(() => flush(retryCount + 1), 1000);
    }
    // After max retries, events are dropped (non-blocking by design)
  });
}

// Flush on interval
setInterval(flush, FLUSH_INTERVAL_MS);

// --- Privacy gating ---
// Only send events if the customer has consented to analytics
// Shopify's customerPrivacy API handles consent banners and GDPR
function withConsent(handler) {
  return async (event) => {
    try {
      const consent = await browser.cookie.get('_tracking_consent');
      // If consent cookie exists and analytics is denied, skip
      if (consent) {
        const parsed = JSON.parse(decodeURIComponent(consent));
        if (parsed.con?.CMP?.a === '' || parsed.con?.CMP?.a === '0') {
          return; // Analytics not consented
        }
      }
    } catch {
      // If we can't read consent, proceed (most Shopify stores don't have consent banners)
    }
    handler(event);
  };
}

// --- Subscribe to Shopify Customer Events ---

analytics.subscribe('page_viewed', withConsent((event) => {
  enqueue('page_viewed', {}, event);
}));

analytics.subscribe('product_viewed', withConsent((event) => {
  const d = event.data?.productVariant;
  enqueue('product_viewed', {
    productId: d?.product?.id ? String(d.product.id) : undefined,
    productTitle: d?.product?.title || undefined,
    variantId: d?.id ? String(d.id) : undefined,
    variantTitle: d?.title || undefined,
    rawData: { price: d?.price?.amount, currency: d?.price?.currencyCode },
  }, event);
}));

analytics.subscribe('collection_viewed', withConsent((event) => {
  const c = event.data?.collection;
  enqueue('collection_viewed', {
    collectionId: c?.id ? String(c.id) : undefined,
    collectionTitle: c?.title || undefined,
  }, event);
}));

analytics.subscribe('product_added_to_cart', withConsent((event) => {
  const cv = event.data?.cartLine;
  enqueue('product_added_to_cart', {
    productId: cv?.merchandise?.product?.id ? String(cv.merchandise.product.id) : undefined,
    productTitle: cv?.merchandise?.product?.title || undefined,
    variantId: cv?.merchandise?.id ? String(cv.merchandise.id) : undefined,
    variantTitle: cv?.merchandise?.title || undefined,
    cartValue: cv?.cost?.totalAmount?.amount ? parseFloat(cv.cost.totalAmount.amount) : undefined,
    rawData: { quantity: cv?.quantity },
  }, event);
}));

analytics.subscribe('cart_viewed', withConsent((event) => {
  const cart = event.data?.cart;
  enqueue('cart_viewed', {
    cartValue: cart?.cost?.totalAmount?.amount ? parseFloat(cart.cost.totalAmount.amount) : undefined,
    rawData: { lineCount: cart?.lines?.length },
  }, event);
}));

analytics.subscribe('checkout_started', withConsent((event) => {
  const co = event.data?.checkout;
  enqueue('checkout_started', {
    orderValue: co?.totalPrice?.amount ? parseFloat(co.totalPrice.amount) : undefined,
    rawData: { lineCount: co?.lineItems?.length },
  }, event);
}));

analytics.subscribe('checkout_completed', withConsent((event) => {
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
    // First item for top-level fields (backwards compatible)
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
}));

analytics.subscribe('search_submitted', withConsent((event) => {
  enqueue('search_submitted', {
    searchQuery: event.data?.searchResult?.query || undefined,
    rawData: { resultCount: event.data?.searchResult?.productVariants?.length },
  }, event);
}));

analytics.subscribe('checkout_address_info_submitted', withConsent((event) => {
  enqueue('checkout_address_info_submitted', {}, event);
}));

analytics.subscribe('checkout_contact_info_submitted', withConsent((event) => {
  enqueue('checkout_contact_info_submitted', {}, event);
}));

analytics.subscribe('checkout_shipping_info_submitted', withConsent((event) => {
  enqueue('checkout_shipping_info_submitted', {}, event);
}));
