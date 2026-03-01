/**
 * Campaign Email Templates
 *
 * Three styles adapted from email-designs/:
 *   - cinematic: Dark, moody, Cormorant Garamond serif. Gold/warm accents.
 *   - swiss:     Clean, bold, Syne + IBM Plex Mono. Red accent.
 *   - warm:      Warm parchment, Libre Baskerville serif. Centered, earthy.
 *
 * Each template accepts structured content and renders full email HTML.
 */

// ============================================
// TYPES
// ============================================

export interface TemplateProduct {
  title: string;
  imageUrl: string;
  price: number;      // INR
  compareAtPrice?: number; // MRP if discounted
  url: string;        // Full Shopify product URL
}

export interface TemplateContent {
  subject: string;
  preheaderText?: string;
  heroHeadline: string;
  bodyHtml: string;           // Main body — rendered HTML (paragraphs, etc.)
  products: TemplateProduct[];
  ctaText?: string;           // e.g. "Shop Now"
  ctaUrl?: string;            // e.g. "https://creaturesofhabit.in"
  unsubscribeUrl?: string;
}

export interface TemplateDefinition {
  key: string;
  name: string;
  description: string;
  render: (content: TemplateContent) => string;
}

// ============================================
// HELPERS
// ============================================

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function formatPrice(price: number): string {
  return `₹${price.toLocaleString('en-IN')}`;
}

function preheaderHtml(text?: string): string {
  if (!text) return '';
  return `<div style="display:none;font-size:1px;color:#333333;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;">${escapeHtml(text)}</div>`;
}

function unsubscribeHtml(url?: string, textColor = '#666666'): string {
  if (!url) return '';
  return `<tr><td align="center" style="padding:16px 56px 24px;">
    <p style="margin:0;font-size:11px;line-height:18px;color:${textColor};">
      <a href="${escapeHtml(url)}" style="color:${textColor};text-decoration:underline;">Unsubscribe</a> from future emails
    </p>
  </td></tr>`;
}

// ============================================
// CINEMATIC TEMPLATE
// Dark bg, Cormorant Garamond, gold/warm tones
// ============================================

function renderCinematic(content: TemplateContent): string {
  const productStrip = content.products.length > 0
    ? `<tr><td style="padding:0 0 48px;">
    <table cellpadding="0" cellspacing="0" border="0" width="600"><tr>
      ${content.products.slice(0, 3).map((p, i) => {
        const width = content.products.length === 2 ? 298 : 198;
        const spacer = i < Math.min(content.products.length, 3) - 1
          ? `<td width="3" style="font-size:1px;">&nbsp;</td>` : '';
        return `<td width="${width}" valign="top">
          <a href="${escapeHtml(p.url)}" style="text-decoration:none;">
            <img src="${escapeHtml(p.imageUrl)}" width="${width}" style="display:block;width:${width}px;height:auto;" alt="${escapeHtml(p.title)}" />
            <div style="padding:12px 8px;">
              <p style="margin:0;font-family:'DM Sans',Arial,sans-serif;font-size:12px;font-weight:500;color:#E8DFD0;line-height:18px;">${escapeHtml(p.title)}</p>
              <p style="margin:4px 0 0;font-family:'DM Sans',Arial,sans-serif;font-size:12px;color:#C8956C;">${formatPrice(p.price)}</p>
            </div>
          </a>
        </td>${spacer}`;
      }).join('')}
    </tr></table>
  </td></tr>` : '';

  const ctaHtml = content.ctaText && content.ctaUrl
    ? `<tr><td align="center" style="padding:0 56px 48px;">
    <a href="${escapeHtml(content.ctaUrl)}" style="display:inline-block;padding:14px 40px;background-color:#C8956C;color:#141211;font-family:'DM Sans',Arial,sans-serif;font-size:13px;font-weight:500;text-decoration:none;border-radius:4px;letter-spacing:0.05em;text-transform:uppercase;">${escapeHtml(content.ctaText)}</a>
  </td></tr>` : '';

  return `<!DOCTYPE html>
<html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
<link href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,300;0,400;0,600;1,300;1,400;1,600&family=DM+Sans:wght@400;500&display=swap" rel="stylesheet">
</head><body style="margin:0;padding:0;background-color:#0a0a0a;">
${preheaderHtml(content.preheaderText)}
<center>
<table cellpadding="0" cellspacing="0" border="0" width="600" style="width:600px;background-color:#141211;font-family:'Cormorant Garamond',Georgia,serif;">

  <!-- Header -->
  <tr><td align="center" style="padding:56px 48px 0;">
    <img src="https://coh.one/static/COH-Logo-White-Wide.png" width="220" style="display:block;width:220px;height:auto;" alt="Creatures of Habit" />
  </td></tr>
  <tr><td align="center" style="padding:20px 0 0;">
    <table cellpadding="0" cellspacing="0" border="0"><tr><td style="width:24px;height:1px;background-color:#3D352C;font-size:1px;line-height:1px;">&nbsp;</td></tr></table>
  </td></tr>

  <!-- Hero -->
  <tr><td style="padding:56px 56px 48px;">
    <p style="margin:0;font-size:38px;font-weight:300;font-style:italic;line-height:50px;color:#E8DFD0;letter-spacing:-0.01em;">${content.heroHeadline}</p>
  </td></tr>

  <!-- Body -->
  <tr><td style="padding:0 56px 48px;font-size:21px;font-weight:300;font-style:italic;line-height:34px;color:#B8A992;">
    ${content.bodyHtml}
  </td></tr>

  ${productStrip}
  ${ctaHtml}

  <!-- Footer -->
  <tr><td style="padding:0 56px 0;border-top:1px solid #2A241E;">&nbsp;</td></tr>
  <tr><td align="center" style="padding:24px 56px 12px;">
    <p style="margin:0;font-size:18px;font-weight:400;font-style:italic;line-height:26px;color:#6B5D4F;">With love,</p>
  </td></tr>
  <tr><td align="center" style="padding:0 56px 24px;">
    <img src="https://coh.one/static/COH-Logo-White-Wide.png" width="140" style="display:block;width:140px;height:auto;margin:0 auto;" alt="Creatures of Habit" />
  </td></tr>
  ${unsubscribeHtml(content.unsubscribeUrl, '#4A4038')}

</table>
</center>
</body></html>`;
}

// ============================================
// SWISS TEMPLATE
// Light bg, Syne + IBM Plex Mono, bold/modern
// ============================================

function renderSwiss(content: TemplateContent): string {
  const productGrid = content.products.length > 0
    ? `<tr><td style="padding:0 0 48px;">
    <table cellpadding="0" cellspacing="0" border="0" width="600"><tr>
      ${content.products.slice(0, 2).map((p, i) => {
        const spacer = i === 0 && content.products.length > 1
          ? `<td width="4" style="font-size:1px;">&nbsp;</td>` : '';
        return `<td width="298" valign="top">
          <a href="${escapeHtml(p.url)}" style="text-decoration:none;">
            <img src="${escapeHtml(p.imageUrl)}" width="298" style="display:block;width:298px;height:auto;" alt="${escapeHtml(p.title)}" />
            <div style="padding:12px 8px;">
              <p style="margin:0;font-family:'IBM Plex Mono','Courier New',monospace;font-size:11px;font-weight:500;color:#1A1A1A;line-height:18px;text-transform:uppercase;letter-spacing:0.05em;">${escapeHtml(p.title)}</p>
              <p style="margin:4px 0 0;font-family:'IBM Plex Mono','Courier New',monospace;font-size:11px;color:#C45D3E;">${formatPrice(p.price)}</p>
            </div>
          </a>
        </td>${spacer}`;
      }).join('')}
    </tr></table>
  </td></tr>` : '';

  const ctaHtml = content.ctaText && content.ctaUrl
    ? `<tr><td style="padding:0 56px 48px;">
    <a href="${escapeHtml(content.ctaUrl)}" style="display:inline-block;padding:14px 40px;background-color:#1A1A1A;color:#FFFFFF;font-family:'IBM Plex Mono','Courier New',monospace;font-size:11px;font-weight:500;text-decoration:none;letter-spacing:0.1em;text-transform:uppercase;">${escapeHtml(content.ctaText)}</a>
  </td></tr>` : '';

  return `<!DOCTYPE html>
<html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
<link href="https://fonts.googleapis.com/css2?family=Syne:wght@400;500;600;700;800&family=IBM+Plex+Mono:wght@300;400;500&display=swap" rel="stylesheet">
</head><body style="margin:0;padding:0;background-color:#E8E8E8;">
${preheaderHtml(content.preheaderText)}
<center>
<table cellpadding="0" cellspacing="0" border="0" width="600" style="width:600px;background-color:#FFFFFF;font-family:'IBM Plex Mono','Courier New',monospace;">

  <!-- Header -->
  <tr><td style="padding:48px 56px 40px;">
    <img src="https://coh.one/static/COH-Logo-Wide-Black.png" width="200" style="display:block;width:200px;height:auto;" alt="Creatures of Habit" />
  </td></tr>

  <!-- Hero -->
  <tr><td style="padding:0 56px 16px;">
    <p style="margin:0;font-family:'Syne',Arial,sans-serif;font-size:48px;font-weight:800;line-height:52px;color:#1A1A1A;letter-spacing:-0.03em;">${content.heroHeadline}</p>
  </td></tr>

  <!-- Body -->
  <tr><td style="padding:0 56px 48px;font-size:13px;font-weight:400;line-height:24px;color:#777777;">
    ${content.bodyHtml}
  </td></tr>

  ${productGrid}
  ${ctaHtml}

  <!-- Footer -->
  <tr><td style="padding:16px 56px 0;">
    <table cellpadding="0" cellspacing="0" border="0"><tr><td style="width:48px;height:4px;background-color:#E8E8E8;border-radius:2px;font-size:1px;line-height:1px;">&nbsp;</td></tr></table>
  </td></tr>
  <tr><td style="padding:24px 56px 8px;">
    <p style="margin:0;font-size:11px;font-weight:500;line-height:18px;color:#1A1A1A;">With love,</p>
  </td></tr>
  <tr><td style="padding:0 56px 24px;">
    <img src="https://coh.one/static/COH-Logo-Wide-Black.png" width="140" style="display:block;width:140px;height:auto;" alt="Creatures of Habit" />
  </td></tr>
  ${unsubscribeHtml(content.unsubscribeUrl, '#999999')}

</table>
</center>
</body></html>`;
}

// ============================================
// WARM TEMPLATE
// Warm parchment, Libre Baskerville, centered
// ============================================

function renderWarm(content: TemplateContent): string {
  const productStrip = content.products.length > 0
    ? `<tr><td style="padding:0 0 48px;">
    <table cellpadding="0" cellspacing="0" border="0" width="600"><tr>
      ${content.products.slice(0, 3).map((p, i) => {
        const width = content.products.length === 2 ? 298 : 197;
        const spacer = i < Math.min(content.products.length, 3) - 1
          ? `<td width="3" style="font-size:1px;">&nbsp;</td>` : '';
        return `<td width="${width}" valign="top">
          <a href="${escapeHtml(p.url)}" style="text-decoration:none;">
            <img src="${escapeHtml(p.imageUrl)}" width="${width}" style="display:block;width:${width}px;height:auto;" alt="${escapeHtml(p.title)}" />
            <div style="padding:12px 8px;text-align:center;">
              <p style="margin:0;font-family:'DM Sans',Arial,sans-serif;font-size:12px;font-weight:500;color:#3D3028;line-height:18px;">${escapeHtml(p.title)}</p>
              <p style="margin:4px 0 0;font-family:'DM Sans',Arial,sans-serif;font-size:12px;color:#B07D56;">${formatPrice(p.price)}</p>
            </div>
          </a>
        </td>${spacer}`;
      }).join('')}
    </tr></table>
  </td></tr>` : '';

  const ctaHtml = content.ctaText && content.ctaUrl
    ? `<tr><td align="center" style="padding:0 64px 48px;">
    <a href="${escapeHtml(content.ctaUrl)}" style="display:inline-block;padding:14px 40px;background-color:#3D3028;color:#F3EDE4;font-family:'DM Sans',Arial,sans-serif;font-size:13px;font-weight:500;text-decoration:none;border-radius:4px;letter-spacing:0.05em;text-transform:uppercase;">${escapeHtml(content.ctaText)}</a>
  </td></tr>` : '';

  return `<!DOCTYPE html>
<html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
<link href="https://fonts.googleapis.com/css2?family=Libre+Baskerville:ital,wght@0,400;0,700;1,400&family=DM+Sans:wght@400;500&display=swap" rel="stylesheet">
</head><body style="margin:0;padding:0;background-color:#E8E0D4;">
${preheaderHtml(content.preheaderText)}
<center>
<table cellpadding="0" cellspacing="0" border="0" width="600" style="width:600px;background-color:#F3EDE4;font-family:'Libre Baskerville',Georgia,serif;">

  <!-- Header -->
  <tr><td align="center" style="padding:56px 48px 0;">
    <img src="https://coh.one/static/COH-Logo-Wide-Black.png" width="180" style="display:block;width:180px;height:auto;margin:0 auto;" alt="Creatures of Habit" />
  </td></tr>
  <tr><td align="center" style="padding:16px 48px 0;">
    <p style="margin:0;font-family:'DM Sans',Arial,sans-serif;font-size:11px;font-weight:500;letter-spacing:0.15em;color:#A89580;text-transform:uppercase;">A note from us to you</p>
  </td></tr>

  <!-- Divider -->
  <tr><td align="center" style="padding:32px 0;">
    <p style="margin:0;font-size:18px;color:#C4B5A0;letter-spacing:0.3em;">* * *</p>
  </td></tr>

  <!-- Hero -->
  <tr><td align="center" style="padding:0 64px 48px;">
    <p style="margin:0;font-size:32px;font-weight:400;font-style:italic;line-height:44px;color:#3D3028;">${content.heroHeadline}</p>
  </td></tr>

  <!-- Body -->
  <tr><td align="center" style="padding:0 64px 48px;font-size:16px;font-weight:400;font-style:italic;line-height:28px;color:#8B7D6B;">
    ${content.bodyHtml}
  </td></tr>

  ${productStrip}
  ${ctaHtml}

  <!-- Footer -->
  <tr><td style="padding:0 56px 0;border-top:1px solid #D9CEBF;">&nbsp;</td></tr>
  <tr><td align="center" style="padding:24px 56px 12px;">
    <p style="margin:0;font-size:15px;font-weight:400;font-style:italic;line-height:24px;color:#A89580;">With love,</p>
  </td></tr>
  <tr><td align="center" style="padding:0 56px 24px;">
    <img src="https://coh.one/static/COH-Logo-Wide-Black.png" width="140" style="display:block;width:140px;height:auto;margin:0 auto;" alt="Creatures of Habit" />
  </td></tr>
  ${unsubscribeHtml(content.unsubscribeUrl, '#A89580')}

</table>
</center>
</body></html>`;
}

// ============================================
// TEMPLATE REGISTRY
// ============================================

export const templates: Record<string, TemplateDefinition> = {
  cinematic: {
    key: 'cinematic',
    name: 'Cinematic',
    description: 'Dark, moody. Gold accents. Best for storytelling and brand moments.',
    render: renderCinematic,
  },
  swiss: {
    key: 'swiss',
    name: 'Swiss',
    description: 'Clean, bold typography. Monospace body. Best for announcements and launches.',
    render: renderSwiss,
  },
  warm: {
    key: 'warm',
    name: 'Warm',
    description: 'Warm parchment tones. Centered, intimate. Best for personal notes and seasonal campaigns.',
    render: renderWarm,
  },
};

/** Render a campaign email using the specified template */
export function renderCampaignEmail(
  templateKey: string,
  content: TemplateContent,
): string {
  const template = templates[templateKey];
  if (!template) {
    throw new Error(`Unknown email template: ${templateKey}`);
  }
  return template.render(content);
}

/** Get list of available templates (for the UI picker) */
export function getTemplateList(): Array<{ key: string; name: string; description: string }> {
  return Object.values(templates).map(t => ({
    key: t.key,
    name: t.name,
    description: t.description,
  }));
}
