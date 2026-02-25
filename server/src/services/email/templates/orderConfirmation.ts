import { wrapInLayout, heading, paragraph, detailTable, detailRow, divider, formatINR } from './layout.js';

export interface OrderConfirmationData {
  customerName: string;
  orderNumber: string;
  items: Array<{
    productName: string;
    variantName?: string;
    quantity: number;
    price: number;
  }>;
  subtotal: number;
  discount?: number;
  shipping?: number;
  total: number;
  shippingAddress?: {
    line1: string;
    line2?: string;
    city: string;
    state: string;
    pincode: string;
  };
}

export function renderOrderConfirmation(data: OrderConfirmationData): { subject: string; html: string } {
  const { customerName, orderNumber, items, subtotal, discount, shipping, total, shippingAddress } = data;
  const firstName = customerName.split(' ')[0] ?? customerName;

  const itemRows = items.map(item =>
    `<tr>
      <td style="padding:10px 0;font-size:14px;color:#333;border-bottom:1px solid #f0f0f0;">
        ${item.productName}${item.variantName ? `<br><span style="font-size:12px;color:#888;">${item.variantName}</span>` : ''}
      </td>
      <td style="padding:10px 0;font-size:14px;color:#333;text-align:center;border-bottom:1px solid #f0f0f0;">
        ${item.quantity}
      </td>
      <td style="padding:10px 0;font-size:14px;color:#333;text-align:right;border-bottom:1px solid #f0f0f0;">
        ${formatINR(item.price * item.quantity)}
      </td>
    </tr>`
  ).join('');

  const addressBlock = shippingAddress ? `
    ${paragraph('<strong>Shipping to:</strong>')}
    <p style="margin:0 0 24px;font-size:14px;color:#555;line-height:1.8;">
      ${shippingAddress.line1}<br>
      ${shippingAddress.line2 ? `${shippingAddress.line2}<br>` : ''}
      ${shippingAddress.city}, ${shippingAddress.state} ${shippingAddress.pincode}
    </p>
  ` : '';

  const content = `
    ${heading('Order Confirmed!')}

    ${paragraph(`Hi ${firstName},`)}

    ${paragraph(`Thank you for your order! We're getting it ready for you.`)}

    ${detailTable(detailRow('Order Number', `#${orderNumber}`))}

    <!-- Items table -->
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 16px;">
      <tr style="border-bottom:2px solid #eee;">
        <td style="padding:8px 0;font-size:12px;font-weight:600;color:#888;text-transform:uppercase;">Item</td>
        <td style="padding:8px 0;font-size:12px;font-weight:600;color:#888;text-transform:uppercase;text-align:center;">Qty</td>
        <td style="padding:8px 0;font-size:12px;font-weight:600;color:#888;text-transform:uppercase;text-align:right;">Amount</td>
      </tr>
      ${itemRows}
    </table>

    <!-- Totals -->
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 24px;">
      <tr>
        <td style="padding:4px 0;font-size:14px;color:#666;">Subtotal</td>
        <td style="padding:4px 0;font-size:14px;color:#333;text-align:right;">${formatINR(subtotal)}</td>
      </tr>
      ${discount ? `<tr>
        <td style="padding:4px 0;font-size:14px;color:#666;">Discount</td>
        <td style="padding:4px 0;font-size:14px;color:#22863a;text-align:right;">-${formatINR(discount)}</td>
      </tr>` : ''}
      ${shipping ? `<tr>
        <td style="padding:4px 0;font-size:14px;color:#666;">Shipping</td>
        <td style="padding:4px 0;font-size:14px;color:#333;text-align:right;">${formatINR(shipping)}</td>
      </tr>` : ''}
      <tr>
        <td style="padding:12px 0 4px;font-size:16px;font-weight:600;color:#1a1a1a;border-top:2px solid #eee;">Total</td>
        <td style="padding:12px 0 4px;font-size:16px;font-weight:600;color:#1a1a1a;text-align:right;border-top:2px solid #eee;">${formatINR(total)}</td>
      </tr>
    </table>

    ${addressBlock}

    ${divider()}

    ${paragraph('We\'ll send you a shipping confirmation with tracking details once your order is on its way.')}

    ${paragraph('If you have any questions, just reply to this email.')}

    ${paragraph('Warm regards,<br>Team Creatures of Habit')}
  `;

  return {
    subject: `Order Confirmed — #${orderNumber}`,
    html: wrapInLayout(content, {
      preheader: `Your order #${orderNumber} has been confirmed. Total: ${formatINR(total)}`,
    }),
  };
}
