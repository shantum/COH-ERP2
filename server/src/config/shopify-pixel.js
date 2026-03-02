// ================================================
// COH Storefront Pixel — v5
// Paste into: Shopify Admin > Settings > Customer events > Add custom pixel
// Name: COH ERP Pixel
// Permission: Required (data collection for analytics)
// ================================================

const ENDPOINT = 'https://coh-pixel-buffer.coh-erp.workers.dev';
const FLUSH_INTERVAL_MS = 2000;
const MAX_BATCH_SIZE = 20;
const MAX_RETRIES = 1;
const MAX_QUEUE_SIZE = 200;
const MAX_LINE_ITEMS = 10;
const PIXEL_VERSION = 5;

// --- Session ID + first-touch attribution (persisted in sessionStorage) ---
let sessionId = null;
let firstTouch = null;

const idsReady = initSession();

async function initSession() {
  // Session ID
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

  // First-touch attribution — set once per session, never overwritten
  try {
    const stored = await browser.sessionStorage.getItem('coh_ft');
    if (stored) {
      firstTouch = JSON.parse(stored);
    }
  } catch {
    // No stored first-touch yet — will be captured on first event
  }
}

function captureFirstTouch(pageUrl, referrer) {
  if (firstTouch) return; // Already captured this session
  const params = getTrackingParams(pageUrl);
  const ft = {};
  for (const [k, v] of Object.entries(params)) {
    if (v) ft[k] = v;
  }
  if (pageUrl) ft.landingUrl = pageUrl;
  if (referrer) ft.initialReferrer = referrer;
  firstTouch = ft;
  browser.sessionStorage.setItem('coh_ft', JSON.stringify(firstTouch)).catch(() => {});
}

// --- UTM + click ID extraction ---
function getTrackingParams(url) {
  try {
    const u = new URL(url);
    return {
      utmSource: u.searchParams.get('utm_source') || undefined,
      utmMedium: u.searchParams.get('utm_medium') || undefined,
      utmCampaign: u.searchParams.get('utm_campaign') || undefined,
      utmContent: u.searchParams.get('utm_content') || undefined,
      utmTerm: u.searchParams.get('utm_term') || undefined,
      fbclid: u.searchParams.get('fbclid') || undefined,
      gclid: u.searchParams.get('gclid') || undefined,
      gbraid: u.searchParams.get('gbraid') || undefined,
      wbraid: u.searchParams.get('wbraid') || undefined,
      ttclid: u.searchParams.get('ttclid') || undefined,
      msclkid: u.searchParams.get('msclkid') || undefined,
      gadSource: u.searchParams.get('gad_source') || undefined,
      gadCampaignId: u.searchParams.get('gad_campaignid') || undefined,
    };
  } catch {
    return {};
  }
}

// --- Device classification (viewport-based) ---
function getDeviceType(width) {
  const w = width || 0;
  if (w < 768) return 'mobile';
  if (w < 1024) return 'tablet';
  return 'desktop';
}

// --- Browser timezone (for VPN detection — compared against CF geo timezone) ---
function getBrowserTimezone() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || undefined;
  } catch {
    return undefined;
  }
}

// --- Event queue + batching ---
let eventQueue = [];

const IMMEDIATE_FLUSH_EVENTS = new Set([
  'product_added_to_cart',
  'checkout_started',
  'checkout_completed',
  'payment_info_submitted',
]);

async function enqueue(extraData, event) {
  await idsReady;

  const ctx = event.context || {};
  const pageUrl = ctx.document?.location?.href || '';
  const referrer = ctx.document?.referrer || undefined;
  const currentParams = getTrackingParams(pageUrl);
  const innerWidth = ctx.window?.innerWidth || undefined;
  const innerHeight = ctx.window?.innerHeight || undefined;
  const nav = ctx.navigator || {};

  // Capture first-touch on first event of the session
  captureFirstTouch(pageUrl, referrer);

  const payload = {
    v: PIXEL_VERSION,
    eventName: event.name,
    eventTime: event.timestamp || new Date().toISOString(),
    sessionId,
    visitorId: event.clientId || 'unknown',
    shopifyEventId: event.id || undefined,
    shopifySeq: event.seq || undefined,
    pageUrl,
    pageTitle: ctx.document?.title || undefined,
    referrer,
    // Current-page tracking params (last-touch)
    ...currentParams,
    userAgent: nav.userAgent || undefined,
    browserLanguage: nav.language || undefined,
    browserTimezone: getBrowserTimezone(),
    screenWidth: innerWidth,
    screenHeight: innerHeight,
    deviceType: getDeviceType(innerWidth),
    ...extraData,
    // First-touch attribution + event-specific data in rawData
    rawData: {
      ...(extraData.rawData || {}),
      ...(firstTouch ? { firstTouch } : {}),
    },
  };

  // Remove undefined/null/empty values
  const cleaned = {};
  for (const [k, v] of Object.entries(payload)) {
    if (v !== undefined && v !== null && v !== '') {
      cleaned[k] = v;
    }
  }

  if (eventQueue.length >= MAX_QUEUE_SIZE) {
    eventQueue.splice(0, eventQueue.length - MAX_QUEUE_SIZE + 1);
  }

  eventQueue.push(cleaned);

  if (IMMEDIATE_FLUSH_EVENTS.has(event.name) || eventQueue.length >= MAX_BATCH_SIZE) {
    flush();
  } else {
    startFlushTimer();
  }
}

// --- Flush machinery ---
let flushTimer = null;
let isFlushing = false;
let flushPending = false;

function startFlushTimer() {
  if (flushTimer) return;
  flushTimer = setTimeout(() => {
    flushTimer = null;
    flush();
  }, FLUSH_INTERVAL_MS);
}

function enforceQueueCap() {
  if (eventQueue.length > MAX_QUEUE_SIZE) {
    eventQueue.splice(0, eventQueue.length - MAX_QUEUE_SIZE);
  }
}

function flush(retryCount) {
  if (eventQueue.length === 0) return;
  if (isFlushing) {
    flushPending = true;
    return;
  }
  isFlushing = true;
  flushPending = false;
  retryCount = retryCount || 0;

  if (flushTimer) {
    clearTimeout(flushTimer);
    flushTimer = null;
  }

  const batch = eventQueue.splice(0, MAX_BATCH_SIZE);
  const body = JSON.stringify({ events: batch });

  function onSettled() {
    isFlushing = false;
    if (flushPending || eventQueue.length > 0) {
      flushPending = false;
      setTimeout(flush, 0);
    }
  }

  fetch(ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body,
    keepalive: true,
  }).then(response => {
    const retryable = response.status >= 500 || response.status === 429;
    if (retryable && retryCount < MAX_RETRIES) {
      eventQueue.unshift(...batch);
      enforceQueueCap();
      isFlushing = false;
      setTimeout(() => flush(retryCount + 1), 1000);
    } else {
      onSettled();
    }
  }).catch(() => {
    if (retryCount < MAX_RETRIES) {
      eventQueue.unshift(...batch);
      enforceQueueCap();
      isFlushing = false;
      setTimeout(() => flush(retryCount + 1), 1000);
    } else {
      onSettled();
    }
  });
}

// --- Subscribe to Shopify Customer Events ---
// Privacy/consent handled by Shopify at platform level based on pixel
// permission setting + shop's Customer Privacy region config.

analytics.subscribe('page_viewed', (event) => {
  enqueue({}, event);
});

analytics.subscribe('product_viewed', (event) => {
  const d = event.data?.productVariant;
  enqueue({
    productId: d?.product?.id ? String(d.product.id) : undefined,
    productTitle: d?.product?.title || undefined,
    variantId: d?.id ? String(d.id) : undefined,
    variantTitle: d?.title || undefined,
    rawData: { price: d?.price?.amount, currency: d?.price?.currencyCode },
  }, event);
});

analytics.subscribe('collection_viewed', (event) => {
  const c = event.data?.collection;
  enqueue({
    collectionId: c?.id ? String(c.id) : undefined,
    collectionTitle: c?.title || undefined,
  }, event);
});

analytics.subscribe('product_added_to_cart', (event) => {
  const cv = event.data?.cartLine;
  enqueue({
    productId: cv?.merchandise?.product?.id ? String(cv.merchandise.product.id) : undefined,
    productTitle: cv?.merchandise?.product?.title || undefined,
    variantId: cv?.merchandise?.id ? String(cv.merchandise.id) : undefined,
    variantTitle: cv?.merchandise?.title || undefined,
    cartValue: cv?.cost?.totalAmount?.amount ? parseFloat(cv.cost.totalAmount.amount) : undefined,
    rawData: { quantity: cv?.quantity },
  }, event);
});

analytics.subscribe('product_removed_from_cart', (event) => {
  const cv = event.data?.cartLine;
  enqueue({
    productId: cv?.merchandise?.product?.id ? String(cv.merchandise.product.id) : undefined,
    productTitle: cv?.merchandise?.product?.title || undefined,
    variantId: cv?.merchandise?.id ? String(cv.merchandise.id) : undefined,
    variantTitle: cv?.merchandise?.title || undefined,
    rawData: { quantity: cv?.quantity },
  }, event);
});

analytics.subscribe('cart_viewed', (event) => {
  const cart = event.data?.cart;
  enqueue({
    cartValue: cart?.cost?.totalAmount?.amount ? parseFloat(cart.cost.totalAmount.amount) : undefined,
    rawData: { lineCount: cart?.lines?.length },
  }, event);
});

analytics.subscribe('checkout_started', (event) => {
  const co = event.data?.checkout;
  enqueue({
    orderValue: co?.totalPrice?.amount ? parseFloat(co.totalPrice.amount) : undefined,
    rawData: { lineCount: co?.lineItems?.length },
  }, event);
});

analytics.subscribe('checkout_completed', (event) => {
  const co = event.data?.checkout;
  const allItems = co?.lineItems || [];
  const items = allItems.slice(0, MAX_LINE_ITEMS).map(li => ({
    productId: li?.variant?.product?.id ? String(li.variant.product.id) : undefined,
    productTitle: li?.variant?.product?.title || undefined,
    variantId: li?.variant?.id ? String(li.variant.id) : undefined,
    variantTitle: li?.variant?.title || undefined,
    quantity: li?.quantity,
    linePrice: li?.finalLinePrice?.amount ? parseFloat(li.finalLinePrice.amount) : undefined,
  }));
  enqueue({
    productId: items[0]?.productId || undefined,
    productTitle: items[0]?.productTitle || undefined,
    variantId: items[0]?.variantId || undefined,
    variantTitle: items[0]?.variantTitle || undefined,
    orderValue: co?.totalPrice?.amount ? parseFloat(co.totalPrice.amount) : undefined,
    rawData: {
      orderId: co?.order?.id,
      email: co?.email || undefined,
      phone: co?.phone || undefined,
      lineCount: allItems.length,
      currency: co?.currencyCode,
      discountAmount: co?.discountsAmount?.amount ? parseFloat(co.discountsAmount.amount) : undefined,
      discountCodes: co?.discountApplications?.map(d => d.title).filter(Boolean) || undefined,
      shippingCity: co?.shippingAddress?.city || undefined,
      shippingZip: co?.shippingAddress?.zip || undefined,
      shippingCountry: co?.shippingAddress?.countryCode || undefined,
      items,
    },
  }, event);
});

analytics.subscribe('payment_info_submitted', (event) => {
  const co = event.data?.checkout;
  enqueue({
    orderValue: co?.totalPrice?.amount ? parseFloat(co.totalPrice.amount) : undefined,
  }, event);
});

analytics.subscribe('search_submitted', (event) => {
  enqueue({
    searchQuery: event.data?.searchResult?.query || undefined,
    rawData: { resultCount: event.data?.searchResult?.productVariants?.length },
  }, event);
});

analytics.subscribe('checkout_address_info_submitted', (event) => {
  enqueue({}, event);
});

analytics.subscribe('checkout_contact_info_submitted', (event) => {
  enqueue({}, event);
});

analytics.subscribe('checkout_shipping_info_submitted', (event) => {
  enqueue({}, event);
});
