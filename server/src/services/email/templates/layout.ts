/**
 * Shared email layout — COH branding wrapper for all customer-facing emails.
 * Inline styles only (email clients don't support external CSS).
 */

const BRAND_COLOR = '#1a1a1a';
const ACCENT_COLOR = '#8B7355';
const BG_COLOR = '#f7f5f2';
const FONT_STACK = "'Helvetica Neue', Helvetica, Arial, sans-serif";

export function wrapInLayout(content: string, options?: { preheader?: string }): string {
  const preheader = options?.preheader ?? '';

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Creatures of Habit</title>
</head>
<body style="margin:0;padding:0;background-color:${BG_COLOR};font-family:${FONT_STACK};color:${BRAND_COLOR};line-height:1.6;">
  ${preheader ? `<div style="display:none;max-height:0;overflow:hidden;">${preheader}</div>` : ''}

  <!-- Container -->
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:${BG_COLOR};">
    <tr>
      <td align="center" style="padding:32px 16px;">
        <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="background-color:#ffffff;border-radius:8px;overflow:hidden;max-width:600px;width:100%;">

          <!-- Header -->
          <tr>
            <td style="padding:32px 40px 24px;text-align:center;border-bottom:1px solid #eee;">
              <h1 style="margin:0;font-size:20px;font-weight:600;letter-spacing:2px;color:${BRAND_COLOR};text-transform:uppercase;">
                Creatures of Habit
              </h1>
            </td>
          </tr>

          <!-- Body -->
          <tr>
            <td style="padding:32px 40px;">
              ${content}
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="padding:24px 40px 32px;border-top:1px solid #eee;text-align:center;">
              <p style="margin:0 0 8px;font-size:13px;color:#888;">
                Creatures of Habit — Sustainable apparel, crafted in Goa
              </p>
              <p style="margin:0;font-size:12px;color:#aaa;">
                <a href="https://creaturesofhabit.in" style="color:${ACCENT_COLOR};text-decoration:none;">creaturesofhabit.in</a>
                &nbsp;&middot;&nbsp;
                <a href="mailto:hello@creaturesofhabit.in" style="color:${ACCENT_COLOR};text-decoration:none;">hello@creaturesofhabit.in</a>
              </p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

/** Render a simple heading */
export function heading(text: string): string {
  return `<h2 style="margin:0 0 16px;font-size:22px;font-weight:600;color:${BRAND_COLOR};">${text}</h2>`;
}

/** Render a paragraph */
export function paragraph(text: string): string {
  return `<p style="margin:0 0 16px;font-size:15px;color:#333;">${text}</p>`;
}

/** Render a key-value detail row */
export function detailRow(label: string, value: string): string {
  return `<tr>
    <td style="padding:8px 0;font-size:14px;color:#666;width:140px;vertical-align:top;">${label}</td>
    <td style="padding:8px 0;font-size:14px;color:${BRAND_COLOR};font-weight:500;">${value}</td>
  </tr>`;
}

/** Wrap detail rows in a table */
export function detailTable(rows: string): string {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 24px;">
    ${rows}
  </table>`;
}

/** Render a styled button */
export function button(text: string, url: string): string {
  return `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:24px 0;">
    <tr>
      <td style="background-color:${BRAND_COLOR};border-radius:6px;">
        <a href="${url}" style="display:inline-block;padding:12px 32px;font-size:14px;font-weight:600;color:#ffffff;text-decoration:none;letter-spacing:0.5px;">
          ${text}
        </a>
      </td>
    </tr>
  </table>`;
}

/** Render a divider */
export function divider(): string {
  return `<hr style="border:none;border-top:1px solid #eee;margin:24px 0;">`;
}

/** Format currency as INR */
export function formatINR(amount: number): string {
  return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(amount);
}
