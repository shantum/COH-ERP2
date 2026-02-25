import { wrapInLayout, heading, paragraph, detailTable, detailRow, button, divider } from './layout.js';

export interface ShippingUpdateData {
  customerName: string;
  orderNumber: string;
  awbNumber: string;
  courierName: string;
  trackingUrl?: string;
  estimatedDelivery?: string;
  items: Array<{
    productName: string;
    variantName?: string;
    quantity: number;
  }>;
}

export function renderShippingUpdate(data: ShippingUpdateData): { subject: string; html: string } {
  const { customerName, orderNumber, awbNumber, courierName, trackingUrl, estimatedDelivery, items } = data;
  const firstName = customerName.split(' ')[0] ?? customerName;

  const itemList = items.map(item =>
    `<li style="padding:4px 0;font-size:14px;color:#333;">
      ${item.productName}${item.variantName ? ` — ${item.variantName}` : ''} x${item.quantity}
    </li>`
  ).join('');

  const content = `
    ${heading('Your Order is On Its Way!')}

    ${paragraph(`Hi ${firstName},`)}

    ${paragraph(`Great news — your order <strong>#${orderNumber}</strong> has been shipped and is on its way to you.`)}

    ${detailTable(
      detailRow('Order', `#${orderNumber}`) +
      detailRow('Courier', courierName) +
      detailRow('Tracking Number', awbNumber) +
      (estimatedDelivery ? detailRow('Expected Delivery', estimatedDelivery) : '')
    )}

    ${trackingUrl ? button('Track Your Order', trackingUrl) : ''}

    <p style="margin:0 0 8px;font-size:13px;font-weight:600;color:#666;text-transform:uppercase;letter-spacing:0.5px;">Items shipped</p>
    <ul style="margin:0 0 24px;padding-left:20px;">
      ${itemList}
    </ul>

    ${divider()}

    ${paragraph('If you have any questions about your delivery, just reply to this email.')}

    ${paragraph('Warm regards,<br>Team Creatures of Habit')}
  `;

  return {
    subject: `Shipped — Order #${orderNumber}`,
    html: wrapInLayout(content, {
      preheader: `Your order #${orderNumber} has been shipped via ${courierName}. Tracking: ${awbNumber}`,
    }),
  };
}
