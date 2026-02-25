import { wrapInLayout, heading, paragraph, detailTable, detailRow, divider, formatINR } from './layout.js';

export interface ReturnCreatedData {
  customerName: string;
  orderNumber: string;
  returnId: string;
  items: Array<{
    productName: string;
    variantName?: string;
    quantity: number;
  }>;
  returnReason?: string;
  refundAmount?: number;
  returnType: 'refund' | 'exchange';
}

export function renderReturnCreated(data: ReturnCreatedData): { subject: string; html: string } {
  const { customerName, orderNumber, items, returnReason, refundAmount, returnType, returnId } = data;

  const firstName = customerName.split(' ')[0] ?? customerName;
  const isExchange = returnType === 'exchange';

  const itemRows = items.map(item =>
    `<tr>
      <td style="padding:8px 0;font-size:14px;color:#333;border-bottom:1px solid #f0f0f0;">
        ${item.productName}${item.variantName ? ` — ${item.variantName}` : ''}
      </td>
      <td style="padding:8px 0;font-size:14px;color:#333;text-align:right;border-bottom:1px solid #f0f0f0;">
        x${item.quantity}
      </td>
    </tr>`
  ).join('');

  const content = `
    ${heading(isExchange ? 'Exchange Request Received' : 'Return Request Received')}

    ${paragraph(`Hi ${firstName},`)}

    ${paragraph(`We've received your ${isExchange ? 'exchange' : 'return'} request for order <strong>#${orderNumber}</strong>. Here are the details:`)}

    ${detailTable(
      detailRow('Request ID', `#${returnId}`) +
      detailRow('Order', `#${orderNumber}`) +
      detailRow('Type', isExchange ? 'Exchange' : 'Refund') +
      (returnReason ? detailRow('Reason', returnReason) : '')
    )}

    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 24px;background:#fafafa;border-radius:6px;padding:16px;">
      <tr>
        <td style="padding:0 16px;">
          <p style="margin:12px 0 8px;font-size:13px;font-weight:600;color:#666;text-transform:uppercase;letter-spacing:0.5px;">Items</p>
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
            ${itemRows}
          </table>
          ${refundAmount ? `<p style="margin:12px 0;font-size:15px;font-weight:600;color:#333;">Refund amount: ${formatINR(refundAmount)}</p>` : ''}
        </td>
      </tr>
    </table>

    ${divider()}

    ${paragraph('<strong>What happens next?</strong>')}
    ${paragraph('Our team will review your request and get back to you within 24-48 hours with pickup details or further instructions.')}

    ${paragraph('If you have any questions, just reply to this email.')}

    ${paragraph('Warm regards,<br>Team Creatures of Habit')}
  `;

  return {
    subject: `${isExchange ? 'Exchange' : 'Return'} Request Received — Order #${orderNumber}`,
    html: wrapInLayout(content, {
      preheader: `Your ${isExchange ? 'exchange' : 'return'} request for order #${orderNumber} has been received.`,
    }),
  };
}
