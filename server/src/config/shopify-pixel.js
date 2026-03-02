// ================================================
// COH Storefront Pixel — v1
// Paste into: Shopify Admin > Settings > Customer events > Add custom pixel
// Name: COH ERP Pixel
// Permission: Not required
// ================================================

const ENDPOINT = 'https://erp.creaturesofhabit.in/api/pixel/events?secret=72cf24dc0adf1d2b7ca0bcc9259cd8f8e2a07293ba7e5755c94217f5dc3afa0c';
const FLUSH_INTERVAL_MS = 3000;
const MAX_BATCH_SIZE = 50;

// --- Visitor & Session IDs (async — Shopify sandbox wraps storage) ---
let visitorId = 'pending';
let sessionId = 'pending';

async function generateId() {
  return crypto.randomUUID ? crypto.randomUUID() :
    'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
      const r = Math.random() * 16 | 0;
      return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
    });
}

async function initIds() {
  try {
    visitorId = await browser.localStorage.getItem('coh_vid');
    if (!visitorId) {
      visitorId = await generateId();
      await browser.localStorage.setItem('coh_vid', visitorId);
    }
  } catch {
    visitorId = await generateId();
  }

  try {
    sessionId = await browser.sessionStorage.getItem('coh_sid');
    if (!sessionId) {
      sessionId = await generateId();
      await browser.sessionStorage.setItem('coh_sid', sessionId);
    }
  } catch {
    sessionId = await generateId();
  }
}

// Initialize IDs immediately
initIds();

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

// --- Device classification ---
function getDeviceType(width) {
  const w = width || 0;
  if (w < 768) return 'mobile';
  if (w < 1024) return 'tablet';
  return 'desktop';
}

// --- Event queue + batching ---
let eventQueue = [];

function enqueue(eventName, extraData, eventContext) {
  // Use event.context for real page data (pixel runs in sandboxed iframe)
  const ctx = eventContext || {};
  const pageUrl = ctx.document?.location?.href || '';
  const utms = getUtmParams(pageUrl);
  const screenWidth = ctx.window?.screen?.width || undefined;
  const screenHeight = ctx.window?.screen?.height || undefined;

  const event = {
    eventName,
    eventTime: new Date().toISOString(),
    sessionId,
    visitorId,
    pageUrl,
    referrer: ctx.document?.referrer || undefined,
    ...utms,
    userAgent: ctx.navigator?.userAgent || undefined,
    screenWidth,
    screenHeight,
    deviceType: getDeviceType(screenWidth),
    ...extraData,
  };

  // Remove undefined/null/empty values (Zod rejects undefined)
  const cleaned = {};
  for (const [k, v] of Object.entries(event)) {
    if (v !== undefined && v !== null && v !== '') {
      cleaned[k] = v;
    }
  }

  eventQueue.push(cleaned);

  if (eventQueue.length >= MAX_BATCH_SIZE) {
    flush();
  }
}

function flush() {
  if (eventQueue.length === 0) return;

  const batch = eventQueue.splice(0, MAX_BATCH_SIZE);
  const body = JSON.stringify({ events: batch });

  // Use fetch with keepalive (Shopify deprecated sendBeacon in sandbox)
  fetch(ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body,
    keepalive: true,
  }).catch(() => {});
}

// Flush on interval
setInterval(flush, FLUSH_INTERVAL_MS);

// --- Subscribe to Shopify Customer Events ---

analytics.subscribe('page_viewed', (event) => {
  enqueue('page_viewed', {}, event.context);
});

analytics.subscribe('product_viewed', (event) => {
  const d = event.data?.productVariant;
  enqueue('product_viewed', {
    productId: d?.product?.id ? String(d.product.id) : undefined,
    productTitle: d?.product?.title || undefined,
    variantId: d?.id ? String(d.id) : undefined,
    variantTitle: d?.title || undefined,
    rawData: { price: d?.price?.amount, currency: d?.price?.currencyCode },
  }, event.context);
});

analytics.subscribe('collection_viewed', (event) => {
  const c = event.data?.collection;
  enqueue('collection_viewed', {
    collectionId: c?.id ? String(c.id) : undefined,
    collectionTitle: c?.title || undefined,
  }, event.context);
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
  }, event.context);
});

analytics.subscribe('cart_viewed', (event) => {
  const cart = event.data?.cart;
  enqueue('cart_viewed', {
    cartValue: cart?.cost?.totalAmount?.amount ? parseFloat(cart.cost.totalAmount.amount) : undefined,
    rawData: { lineCount: cart?.lines?.length },
  }, event.context);
});

analytics.subscribe('checkout_started', (event) => {
  const co = event.data?.checkout;
  enqueue('checkout_started', {
    orderValue: co?.totalPrice?.amount ? parseFloat(co.totalPrice.amount) : undefined,
    rawData: { lineCount: co?.lineItems?.length },
  }, event.context);
});

analytics.subscribe('checkout_completed', (event) => {
  const co = event.data?.checkout;
  const firstLine = co?.lineItems?.[0];
  enqueue('checkout_completed', {
    productId: firstLine?.variant?.product?.id ? String(firstLine.variant.product.id) : undefined,
    productTitle: firstLine?.variant?.product?.title || undefined,
    variantId: firstLine?.variant?.id ? String(firstLine.variant.id) : undefined,
    variantTitle: firstLine?.variant?.title || undefined,
    orderValue: co?.totalPrice?.amount ? parseFloat(co.totalPrice.amount) : undefined,
    rawData: {
      orderId: co?.order?.id,
      lineCount: co?.lineItems?.length,
      currency: co?.currencyCode,
      discountAmount: co?.discountsAmount?.amount,
    },
  }, event.context);
});

analytics.subscribe('search_submitted', (event) => {
  enqueue('search_submitted', {
    searchQuery: event.data?.searchResult?.query || undefined,
    rawData: { resultCount: event.data?.searchResult?.productVariants?.length },
  }, event.context);
});

analytics.subscribe('checkout_address_info_submitted', (event) => {
  enqueue('checkout_address_info_submitted', {}, event.context);
});

analytics.subscribe('checkout_contact_info_submitted', (event) => {
  enqueue('checkout_contact_info_submitted', {}, event.context);
});

analytics.subscribe('checkout_shipping_info_submitted', (event) => {
  enqueue('checkout_shipping_info_submitted', {}, event.context);
});
