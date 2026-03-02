import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useServerFn } from '@tanstack/react-start';
import { getInvoice } from '../../server/functions/finance';
import { formatCurrency, formatPeriod, formatStatus, StatusBadge, LoadingState } from './shared';
import { getCategoryLabel } from '@coh/shared';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { ArrowUpRight, ArrowDownLeft, ExternalLink, Download, Printer, Send, Loader2 } from 'lucide-react';
import InlineFabricPicker from './InlineFabricPicker';
import { Button } from '@/components/ui/button';
import { useCallback, useState } from 'react';
import { showSuccess, showError } from '../../utils/toast';

// Company details for GST invoice header
const COMPANY_INFO = {
  brand: 'Creatures of Habit',
  legal: 'Canoe Design Pvt Ltd',
  gstin: '27AAGCN1452Q1Z0',
  address: 'Mumbai, India',
  state: 'Maharashtra',
  stateCode: '27',
} as const;

/** Parse shipping address — may be JSON string or plain text */
function parseAddress(raw: string | null | undefined): {
  line1: string; line2?: string; city?: string; state?: string; zip?: string; phone?: string;
} | null {
  if (!raw) return null;
  // Try parsing as JSON (Shopify format)
  try {
    const obj = JSON.parse(raw);
    const parts: string[] = [];
    if (obj.address1) parts.push(obj.address1);
    if (obj.address2) parts.push(obj.address2);
    return {
      line1: parts.join(', ') || '',
      city: obj.city,
      state: obj.province,
      zip: obj.zip,
      phone: obj.phone,
    };
  } catch {
    // Plain text address
    return { line1: raw };
  }
}

type InvoiceData = NonNullable<
  Extract<Awaited<ReturnType<typeof getInvoice>>, { success: true }>['invoice']
>;
type InvoiceLine = InvoiceData['lines'][number];

/** Extract product description from an invoice line's orderLine relation */
function getLineDetails(line: InvoiceLine) {
  if (line.orderLine?.sku) {
    const { sku } = line.orderLine;
    const productName = sku.variation?.product?.name ?? '';
    const colorName = sku.variation?.colorName ?? '';
    const size = sku.size ?? '';
    const parts = [productName, colorName ? `${colorName}` : '', size ? `Size ${size}` : ''].filter(Boolean);
    return {
      description: parts.join(' — '),
      skuCode: sku.skuCode,
      hsn: line.hsnCode || sku.variation?.product?.hsnCode || null,
    };
  }
  return {
    description: line.description || '---',
    skuCode: null,
    hsn: line.hsnCode || null,
  };
}

function formatDate(date: Date | string | null | undefined): string {
  if (!date) return '---';
  return new Date(date).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

function capitalizeFirst(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

const CHANNEL_LABELS: Record<string, string> = {
  shopify: 'Shopify', offline: 'COH', myntra: 'Myntra',
  nykaa: 'Nykaa', ajio: 'AJIO', jio: 'Jio', nica: 'Nica',
};

function formatChannel(raw: string): string {
  const lower = raw.toLowerCase().trim();
  const key = Object.keys(CHANNEL_LABELS).find(
    k => lower === k || lower.startsWith(`${k}_`) || lower.startsWith(`${k}-`),
  );
  return key ? CHANNEL_LABELS[key] : capitalizeFirst(lower);
}

// ============================================
// PDF EXPORT — opens a print-friendly window
// ============================================

function buildPrintHtml(invoice: InvoiceData): string {
  const lines = invoice.lines.map((line, idx) => {
    const d = getLineDetails(line);
    return `
      <tr>
        <td style="padding:6px 8px;border-bottom:1px solid #e5e7eb;text-align:center">${idx + 1}</td>
        <td style="padding:6px 8px;border-bottom:1px solid #e5e7eb">
          ${d.description}${d.skuCode ? `<br/><span style="color:#6b7280;font-size:11px">SKU: ${d.skuCode}</span>` : ''}
        </td>
        <td style="padding:6px 8px;border-bottom:1px solid #e5e7eb;text-align:center">${d.hsn ?? '---'}</td>
        <td style="padding:6px 8px;border-bottom:1px solid #e5e7eb;text-align:right">${line.qty != null ? line.qty : '---'}</td>
        <td style="padding:6px 8px;border-bottom:1px solid #e5e7eb;text-align:right;font-family:monospace">${line.rate != null ? Number(line.rate).toLocaleString('en-IN', { minimumFractionDigits: 2 }) : '---'}</td>
        <td style="padding:6px 8px;border-bottom:1px solid #e5e7eb;text-align:right;font-family:monospace">${line.amount != null ? Number(line.amount).toLocaleString('en-IN', { minimumFractionDigits: 2 }) : '---'}</td>
        <td style="padding:6px 8px;border-bottom:1px solid #e5e7eb;text-align:center">${line.gstPercent != null ? `${line.gstPercent}%` : '---'}</td>
      </tr>
    `;
  }).join('');

  const gstRows: string[] = [];
  const hasCgstSgst = invoice.cgstAmount != null && invoice.sgstAmount != null && (invoice.cgstAmount > 0 || invoice.sgstAmount > 0);
  const hasIgst = invoice.igstAmount != null && invoice.igstAmount > 0;
  if (hasCgstSgst) {
    gstRows.push(`<tr><td style="text-align:right;padding:4px 8px">CGST${invoice.gstRate ? ` @${invoice.gstRate / 2}%` : ''}</td><td style="text-align:right;padding:4px 8px;font-family:monospace">${Number(invoice.cgstAmount).toLocaleString('en-IN', { minimumFractionDigits: 2 })}</td></tr>`);
    gstRows.push(`<tr><td style="text-align:right;padding:4px 8px">SGST${invoice.gstRate ? ` @${invoice.gstRate / 2}%` : ''}</td><td style="text-align:right;padding:4px 8px;font-family:monospace">${Number(invoice.sgstAmount).toLocaleString('en-IN', { minimumFractionDigits: 2 })}</td></tr>`);
  } else if (hasIgst) {
    gstRows.push(`<tr><td style="text-align:right;padding:4px 8px">IGST${invoice.gstRate ? ` @${invoice.gstRate}%` : ''}</td><td style="text-align:right;padding:4px 8px;font-family:monospace">${Number(invoice.igstAmount).toLocaleString('en-IN', { minimumFractionDigits: 2 })}</td></tr>`);
  } else if (invoice.gstAmount != null && invoice.gstAmount > 0) {
    gstRows.push(`<tr><td style="text-align:right;padding:4px 8px">GST${invoice.gstRate ? ` @${invoice.gstRate}%` : ''}</td><td style="text-align:right;padding:4px 8px;font-family:monospace">${Number(invoice.gstAmount).toLocaleString('en-IN', { minimumFractionDigits: 2 })}</td></tr>`);
  }
  if (invoice.tdsAmount != null && invoice.tdsAmount > 0) {
    gstRows.push(`<tr><td style="text-align:right;padding:4px 8px">TDS${invoice.tdsRate ? ` @${invoice.tdsRate}%` : ''}${invoice.tdsSection ? ` (${invoice.tdsSection})` : ''}</td><td style="text-align:right;padding:4px 8px;font-family:monospace">-${Number(invoice.tdsAmount).toLocaleString('en-IN', { minimumFractionDigits: 2 })}</td></tr>`);
  }

  const customerName = invoice.order?.customerName
    ?? (invoice.customer ? [invoice.customer.firstName, invoice.customer.lastName].filter(Boolean).join(' ') : '')
    ?? invoice.party?.name ?? '';
  const addr = parseAddress(invoice.order?.shippingAddress);
  const customerEmail = invoice.order?.customerEmail ?? invoice.customer?.email ?? '';
  const customerPhone = addr?.phone || invoice.order?.customerPhone || '';
  const customerState = addr?.state || invoice.order?.customerState || '';
  const addressLine = addr?.line1 || '';
  const cityStateZip = [addr?.city, customerState, addr?.zip].filter(Boolean).join(', ');

  return `<!DOCTYPE html>
<html>
<head>
  <title>Invoice ${invoice.invoiceNumber ?? 'Draft'}</title>
  <style>
    @page { margin: 15mm; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; font-size: 13px; color: #111; margin: 0; padding: 20px; }
    table { border-collapse: collapse; }
    .header { display: flex; justify-content: space-between; margin-bottom: 24px; border-bottom: 2px solid #111; padding-bottom: 16px; }
    .title { font-size: 22px; font-weight: 700; letter-spacing: 1px; }
    .meta-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; margin-bottom: 20px; }
    .meta-box { padding: 12px; border: 1px solid #e5e7eb; border-radius: 6px; }
    .meta-box h4 { margin: 0 0 6px; font-size: 11px; text-transform: uppercase; color: #6b7280; letter-spacing: 0.5px; }
    .meta-box p { margin: 2px 0; font-size: 13px; }
    .totals { width: 280px; margin-left: auto; margin-top: 12px; }
    .totals td { padding: 4px 8px; }
    .total-row td { font-weight: 700; font-size: 15px; border-top: 2px solid #111; padding-top: 8px; }
    .footer { margin-top: 30px; padding-top: 12px; border-top: 1px solid #e5e7eb; font-size: 11px; color: #6b7280; }
  </style>
</head>
<body>
  <div class="header">
    <div>
      <div class="title">TAX INVOICE</div>
      <p style="margin:4px 0 0;font-size:12px;color:#6b7280">${invoice.invoiceNumber ? `#${invoice.invoiceNumber}` : 'DRAFT'} &middot; ${capitalizeFirst(invoice.status)}</p>
    </div>
    <div style="text-align:right">
      <div style="font-size:16px;font-weight:600">${COMPANY_INFO.brand}</div>
      <p style="margin:2px 0;font-size:12px;color:#6b7280">${COMPANY_INFO.legal}</p>
      <p style="margin:2px 0;font-size:12px;color:#6b7280">GSTIN: ${COMPANY_INFO.gstin}</p>
      <p style="margin:2px 0;font-size:12px;color:#6b7280">${COMPANY_INFO.address}</p>
      <p style="margin:2px 0;font-size:12px;color:#6b7280">State: ${COMPANY_INFO.state} (${COMPANY_INFO.stateCode})</p>
    </div>
  </div>

  <div class="meta-grid">
    <div class="meta-box">
      <h4>${invoice.type === 'payable' ? 'Bill From' : 'Bill To'}</h4>
      <p style="font-weight:600">${customerName || '---'}</p>
      ${addressLine ? `<p>${addressLine}</p>` : ''}
      ${cityStateZip ? `<p>${cityStateZip}</p>` : ''}
      ${customerPhone ? `<p>Phone: ${customerPhone}</p>` : ''}
      ${customerEmail ? `<p>Email: ${customerEmail}</p>` : ''}
    </div>
    <div class="meta-box">
      <h4>Invoice Details</h4>
      <p>Invoice Date: ${formatDate(invoice.invoiceDate)}</p>
      ${invoice.dueDate ? `<p>Due Date: ${formatDate(invoice.dueDate)}</p>` : ''}
      ${invoice.order ? `<p>Order: #${invoice.order.orderNumber} (${formatChannel(invoice.order.channel)})</p>` : ''}
      ${invoice.order?.orderDate ? `<p>Order Date: ${formatDate(invoice.order.orderDate)}</p>` : ''}
      ${invoice.order?.paymentMethod ? `<p>Payment: ${invoice.order.paymentMethod}</p>` : ''}
      ${invoice.order?.shopifyCache?.paymentGatewayNames ? `<p>Gateway: ${invoice.order.shopifyCache.paymentGatewayNames}</p>` : ''}
      ${invoice.order?.paymentConfirmedAt ? `<p>Payment Date: ${formatDate(invoice.order.paymentConfirmedAt)}</p>` : ''}
      ${invoice.order?.shopifyCache?.confirmationNumber ? `<p>Ref #: ${invoice.order.shopifyCache.confirmationNumber}</p>` : ''}
    </div>
  </div>

  <table style="width:100%;border:1px solid #e5e7eb;border-radius:6px;overflow:hidden;margin-bottom:16px">
    <thead>
      <tr style="background:#f9fafb">
        <th style="padding:8px;text-align:center;border-bottom:1px solid #e5e7eb;font-size:11px;width:40px">#</th>
        <th style="padding:8px;text-align:left;border-bottom:1px solid #e5e7eb;font-size:11px">Description</th>
        <th style="padding:8px;text-align:center;border-bottom:1px solid #e5e7eb;font-size:11px;width:70px">HSN</th>
        <th style="padding:8px;text-align:right;border-bottom:1px solid #e5e7eb;font-size:11px;width:50px">Qty</th>
        <th style="padding:8px;text-align:right;border-bottom:1px solid #e5e7eb;font-size:11px;width:90px">Rate</th>
        <th style="padding:8px;text-align:right;border-bottom:1px solid #e5e7eb;font-size:11px;width:90px">Amount</th>
        <th style="padding:8px;text-align:center;border-bottom:1px solid #e5e7eb;font-size:11px;width:60px">GST%</th>
      </tr>
    </thead>
    <tbody>
      ${lines}
    </tbody>
  </table>

  <table class="totals">
    ${invoice.subtotal != null ? `<tr><td style="text-align:right;padding:4px 8px">Subtotal</td><td style="text-align:right;padding:4px 8px;font-family:monospace">${Number(invoice.subtotal).toLocaleString('en-IN', { minimumFractionDigits: 2 })}</td></tr>` : ''}
    ${gstRows.join('')}
    <tr class="total-row">
      <td style="text-align:right;padding:4px 8px">Total</td>
      <td style="text-align:right;padding:4px 8px;font-family:monospace">${Number(invoice.totalAmount).toLocaleString('en-IN', { minimumFractionDigits: 2 })}</td>
    </tr>
    <tr>
      <td style="text-align:right;padding:4px 8px;color:#16a34a">Paid</td>
      <td style="text-align:right;padding:4px 8px;font-family:monospace;color:#16a34a">${Number(invoice.paidAmount ?? 0).toLocaleString('en-IN', { minimumFractionDigits: 2 })}</td>
    </tr>
    ${invoice.balanceDue > 0 ? `<tr><td style="text-align:right;padding:4px 8px;color:#d97706;font-weight:600">Balance Due</td><td style="text-align:right;padding:4px 8px;font-family:monospace;color:#d97706;font-weight:600">${Number(invoice.balanceDue).toLocaleString('en-IN', { minimumFractionDigits: 2 })}</td></tr>` : ''}
  </table>

  ${invoice.notes ? `<div class="footer"><strong>Notes:</strong> ${invoice.notes}</div>` : ''}
  <div class="footer">
    <p>Generated on ${new Date().toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}${invoice.createdBy ? ` &middot; Created by ${invoice.createdBy.name}` : ''}</p>
  </div>
</body>
</html>`;
}

export default function InvoiceDetailModal({
  invoiceId,
  open,
  onClose,
}: {
  invoiceId: string;
  open: boolean;
  onClose: () => void;
}) {
  const getInvoiceFn = useServerFn(getInvoice);
  const queryClient = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ['finance', 'invoice', invoiceId],
    queryFn: () => getInvoiceFn({ data: { id: invoiceId } }),
    enabled: open && !!invoiceId,
  });

  const invoice = data?.success ? data.invoice : null;

  // ============================================
  // PAY VIA RAZORPAYX
  // ============================================

  const [showPayConfirm, setShowPayConfirm] = useState(false);
  const [payProcessing, setPayProcessing] = useState(false);

  const canPay = invoice
    && invoice.type === 'payable'
    && (invoice.status === 'confirmed' || invoice.status === 'partially_paid')
    && invoice.balanceDue > 0
    && invoice.party?.bankAccountNumber
    && invoice.party?.bankIfsc;

  const handlePay = useCallback(async () => {
    if (!invoice || !canPay) return;
    setPayProcessing(true);
    const mode = invoice.balanceDue >= 500000 ? 'NEFT' : 'IMPS';
    try {
      const res = await fetch('/api/razorpayx/payout', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ invoiceId: invoice.id, mode }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: 'Request failed' }));
        throw new Error(err.error || `HTTP ${res.status}`);
      }
      setShowPayConfirm(false);
      showSuccess(`Payout initiated — ${formatCurrency(invoice.balanceDue)} to ${invoice.party?.name} via ${mode}`);
      queryClient.invalidateQueries({ queryKey: ['finance', 'invoice', invoiceId] });
      queryClient.invalidateQueries({ queryKey: ['finance'] });
    } catch (err: unknown) {
      showError('Payout failed', { description: err instanceof Error ? err.message : String(err) });
    } finally {
      setPayProcessing(false);
    }
  }, [invoice, canPay, invoiceId, queryClient]);

  const handlePrintInvoice = useCallback(() => {
    if (!invoice) return;
    const html = buildPrintHtml(invoice);
    const printWindow = window.open('', '_blank', 'width=800,height=1000');
    if (!printWindow) return;
    printWindow.document.write(html);
    printWindow.document.close();
    // Small delay to let styles load before print dialog
    setTimeout(() => printWindow.print(), 300);
  }, [invoice]);

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto">
        {isLoading ? (
          <LoadingState />
        ) : !invoice ? (
          <div className="p-8 text-center text-muted-foreground">Invoice not found</div>
        ) : (
          <>
            {/* ========== HEADER ========== */}
            <DialogHeader>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <DialogTitle className="text-lg">
                    {invoice.invoiceNumber ? `Invoice #${invoice.invoiceNumber}` : 'Draft Invoice'}
                  </DialogTitle>
                  <StatusBadge status={invoice.status} />
                </div>
                <div className="flex items-center gap-2">
                  <Button variant="outline" size="sm" onClick={handlePrintInvoice}>
                    <Printer className="h-3.5 w-3.5 mr-1" /> Export PDF
                  </Button>
                  {invoice.driveUrl && (
                    <Button variant="outline" size="sm" asChild>
                      <a href={invoice.driveUrl} target="_blank" rel="noopener noreferrer">
                        <ExternalLink className="h-3.5 w-3.5 mr-1" /> Drive
                      </a>
                    </Button>
                  )}
                  {invoice.fileName && (
                    <Button variant="outline" size="sm" asChild>
                      <a href={`/api/finance/${invoice.id}/file`}>
                        <Download className="h-3.5 w-3.5 mr-1" /> Download
                      </a>
                    </Button>
                  )}
                  {invoice.type === 'payable' && (invoice.status === 'confirmed' || invoice.status === 'partially_paid') && invoice.balanceDue > 0 && (
                    <Button
                      variant="default"
                      size="sm"
                      onClick={() => setShowPayConfirm(true)}
                      disabled={!canPay}
                      title={!invoice.party?.bankAccountNumber ? 'Party missing bank details' : undefined}
                    >
                      <Send className="h-3.5 w-3.5 mr-1" /> Pay
                    </Button>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-2 mt-1">
                <span className={`inline-flex items-center gap-1 text-xs font-medium ${invoice.type === 'payable' ? 'text-red-600' : 'text-green-600'}`}>
                  {invoice.type === 'payable' ? <ArrowUpRight className="h-3 w-3" /> : <ArrowDownLeft className="h-3 w-3" />}
                  {formatStatus(invoice.type)}
                </span>
                <span className="text-xs text-muted-foreground">{getCategoryLabel(invoice.category)}</span>
              </div>
            </DialogHeader>

            {/* ========== PAY CONFIRMATION ========== */}
            {showPayConfirm && invoice && canPay && (
              <div className="border border-blue-200 bg-blue-50 dark:bg-blue-950 dark:border-blue-800 rounded-lg p-4 flex items-center justify-between">
                <div className="text-sm">
                  <p className="font-medium">
                    Pay {formatCurrency(invoice.balanceDue)} to {invoice.party?.name}?
                  </p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    via {invoice.balanceDue >= 500000 ? 'NEFT' : 'IMPS'} &middot; A/C {invoice.party?.bankAccountNumber}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <Button variant="ghost" size="sm" onClick={() => setShowPayConfirm(false)} disabled={payProcessing}>
                    Cancel
                  </Button>
                  <Button variant="default" size="sm" onClick={handlePay} disabled={payProcessing}>
                    {payProcessing ? <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" /> : <Send className="h-3.5 w-3.5 mr-1" />}
                    Confirm
                  </Button>
                </div>
              </div>
            )}

            {/* ========== COMPANY + CUSTOMER / VENDOR ========== */}
            <div className="grid grid-cols-2 gap-4 mt-4">
              {/* Company (seller) details */}
              <div className="border rounded-lg p-4 space-y-1">
                <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide mb-1">
                  {invoice.type === 'payable' ? 'Bill To (Us)' : 'From'}
                </p>
                <p className="text-sm font-semibold">{COMPANY_INFO.brand}</p>
                <p className="text-xs text-muted-foreground">{COMPANY_INFO.legal}</p>
                <p className="text-xs text-muted-foreground">GSTIN: {COMPANY_INFO.gstin}</p>
                <p className="text-xs text-muted-foreground">{COMPANY_INFO.address}</p>
                <p className="text-xs text-muted-foreground">State: {COMPANY_INFO.state} ({COMPANY_INFO.stateCode})</p>
              </div>

              {/* Customer / Vendor details */}
              <div className="border rounded-lg p-4 space-y-1">
                <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide mb-1">
                  {invoice.type === 'payable' ? 'Vendor' : 'Bill To'}
                </p>
                {invoice.party && (
                  <>
                    <p className="text-sm font-semibold">{invoice.party.name}</p>
                    {invoice.type === 'payable' && invoice.party.bankAccountNumber && (
                      <div className="text-xs text-muted-foreground space-y-0.5 mt-1">
                        {invoice.party.bankAccountName && <p>A/C: {invoice.party.bankAccountName}</p>}
                        <p>A/C #: {invoice.party.bankAccountNumber}</p>
                        {invoice.party.bankIfsc && <p>IFSC: {invoice.party.bankIfsc}</p>}
                      </div>
                    )}
                    {invoice.party.tdsApplicable && (
                      <p className="text-xs text-muted-foreground">
                        TDS: {invoice.party.tdsSection ?? 'N/A'} @ {invoice.party.tdsRate != null ? `${invoice.party.tdsRate}%` : 'N/A'}
                      </p>
                    )}
                  </>
                )}
                {!invoice.party && (() => {
                  const addr = parseAddress(invoice.order?.shippingAddress);
                  const phone = addr?.phone || invoice.order?.customerPhone;
                  const email = invoice.order?.customerEmail ?? invoice.customer?.email;
                  const state = addr?.state || invoice.order?.customerState;
                  return (
                    <>
                      <p className="text-sm font-semibold">
                        {invoice.order?.customerName
                          ?? (invoice.customer
                            ? [invoice.customer.firstName, invoice.customer.lastName].filter(Boolean).join(' ') || invoice.customer.email
                            : '---')}
                      </p>
                      {addr?.line1 && <p className="text-xs text-muted-foreground">{addr.line1}</p>}
                      {addr?.line2 && <p className="text-xs text-muted-foreground">{addr.line2}</p>}
                      {(addr?.city || state || addr?.zip) && (
                        <p className="text-xs text-muted-foreground">
                          {[addr?.city, state, addr?.zip].filter(Boolean).join(', ')}
                        </p>
                      )}
                      {phone && <p className="text-xs text-muted-foreground">Phone: {phone}</p>}
                      {email && <p className="text-xs text-muted-foreground">Email: {email}</p>}
                    </>
                  );
                })()}
              </div>
            </div>

            {/* ========== ORDER & DATE INFO ========== */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
              <div>
                <p className="text-xs text-muted-foreground">Invoice Date</p>
                <p className="mt-0.5 font-medium">{formatDate(invoice.invoiceDate)}</p>
              </div>
              {invoice.dueDate && (
                <div>
                  <p className="text-xs text-muted-foreground">Due Date</p>
                  <p className="mt-0.5 font-medium">{formatDate(invoice.dueDate)}</p>
                </div>
              )}
              {invoice.billingPeriod && (
                <div>
                  <p className="text-xs text-muted-foreground">Billing Period</p>
                  <p className="mt-0.5 font-medium">{formatPeriod(invoice.billingPeriod)}</p>
                </div>
              )}
              {invoice.order && (
                <>
                  <div>
                    <p className="text-xs text-muted-foreground">Order</p>
                    <p className="mt-0.5 font-medium">#{invoice.order.orderNumber}</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Channel</p>
                    <p className="mt-0.5 font-medium">{formatChannel(invoice.order.channel)}</p>
                  </div>
                  {invoice.order.orderDate && (
                    <div>
                      <p className="text-xs text-muted-foreground">Order Date</p>
                      <p className="mt-0.5 font-medium">{formatDate(invoice.order.orderDate)}</p>
                    </div>
                  )}
                  {(invoice.order.paymentMethod || invoice.order.shopifyCache?.paymentGatewayNames) && (
                    <div>
                      <p className="text-xs text-muted-foreground">Payment Method</p>
                      <p className="mt-0.5 font-medium">
                        {invoice.order.paymentMethod ?? '---'}
                      </p>
                    </div>
                  )}
                  {invoice.order.shopifyCache?.paymentGatewayNames && (
                    <div>
                      <p className="text-xs text-muted-foreground">Payment Gateway</p>
                      <p className="mt-0.5 font-medium">{invoice.order.shopifyCache.paymentGatewayNames}</p>
                    </div>
                  )}
                  {invoice.order.paymentConfirmedAt && (
                    <div>
                      <p className="text-xs text-muted-foreground">Payment Date</p>
                      <p className="mt-0.5 font-medium">{formatDate(invoice.order.paymentConfirmedAt)}</p>
                    </div>
                  )}
                  {invoice.order.shopifyCache?.confirmationNumber && (
                    <div>
                      <p className="text-xs text-muted-foreground">Reference #</p>
                      <p className="mt-0.5 font-medium font-mono text-xs">{invoice.order.shopifyCache.confirmationNumber}</p>
                    </div>
                  )}
                </>
              )}
              {!invoice.order && invoice.settlementBatchRef && (
                <div>
                  <p className="text-xs text-muted-foreground">Settlement Ref</p>
                  <p className="mt-0.5 font-medium font-mono text-xs">{invoice.settlementBatchRef}</p>
                </div>
              )}
            </div>

            {/* ========== AMOUNT SUMMARY ========== */}
            <div className="grid grid-cols-3 gap-3">
              {(() => {
                const items: Array<{ label: string; value: string }> = [];
                if (invoice.subtotal != null) {
                  items.push({ label: 'Subtotal', value: formatCurrency(invoice.subtotal) });
                }
                const hasCgstSgst = invoice.cgstAmount != null && invoice.sgstAmount != null &&
                  (invoice.cgstAmount > 0 || invoice.sgstAmount > 0);
                const hasIgst = invoice.igstAmount != null && invoice.igstAmount > 0;
                if (hasCgstSgst) {
                  items.push({
                    label: `CGST${invoice.gstRate ? ` @${invoice.gstRate / 2}%` : ''}`,
                    value: formatCurrency(invoice.cgstAmount!),
                  });
                  items.push({
                    label: `SGST${invoice.gstRate ? ` @${invoice.gstRate / 2}%` : ''}`,
                    value: formatCurrency(invoice.sgstAmount!),
                  });
                } else if (hasIgst) {
                  items.push({
                    label: `IGST${invoice.gstRate ? ` @${invoice.gstRate}%` : ''}`,
                    value: formatCurrency(invoice.igstAmount!),
                  });
                } else if (invoice.gstAmount != null && invoice.gstAmount > 0) {
                  items.push({
                    label: `GST${invoice.gstRate ? ` @${invoice.gstRate}%` : ''}`,
                    value: formatCurrency(invoice.gstAmount),
                  });
                }
                if (invoice.tdsAmount != null && invoice.tdsAmount > 0) {
                  items.push({
                    label: `TDS${invoice.tdsRate ? ` @${invoice.tdsRate}%` : ''}${invoice.tdsSection ? ` (${invoice.tdsSection})` : ''}`,
                    value: formatCurrency(invoice.tdsAmount),
                  });
                }
                return items.map(item => (
                  <div key={item.label} className="border rounded-lg p-3 text-center">
                    <p className="text-xs text-muted-foreground">{item.label}</p>
                    <p className="text-sm font-mono font-medium mt-0.5">{item.value}</p>
                  </div>
                ));
              })()}
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div className="border rounded-lg p-3 text-center bg-muted/30">
                <p className="text-xs text-muted-foreground">Total</p>
                <p className="text-base font-mono font-semibold mt-0.5">{formatCurrency(invoice.totalAmount)}</p>
              </div>
              <div className="border rounded-lg p-3 text-center bg-green-50 dark:bg-green-950">
                <p className="text-xs text-muted-foreground">Paid</p>
                <p className="text-base font-mono font-semibold text-green-700 dark:text-green-400 mt-0.5">
                  {formatCurrency(invoice.paidAmount ?? 0)}
                </p>
              </div>
              <div className="border rounded-lg p-3 text-center bg-amber-50 dark:bg-amber-950">
                <p className="text-xs text-muted-foreground">Balance Due</p>
                <p className="text-base font-mono font-semibold text-amber-700 dark:text-amber-400 mt-0.5">
                  {formatCurrency(invoice.balanceDue)}
                </p>
              </div>
            </div>

            {/* ========== LINE ITEMS ========== */}
            {invoice.lines.length > 0 && (() => {
              const isFabric = invoice.category === 'fabric';
              const hasOrderLines = invoice.lines.some(l => l.orderLine?.sku);
              return (
                <div>
                  <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2">Line Items</p>
                  <div className="border rounded-lg overflow-hidden">
                    <table className="w-full text-xs">
                      <thead className="bg-muted/50">
                        <tr>
                          <th className="text-center p-2 font-medium w-8">#</th>
                          <th className="text-left p-2 font-medium">Description</th>
                          {hasOrderLines && <th className="text-left p-2 font-medium w-24">SKU</th>}
                          {isFabric && <th className="text-left p-2 font-medium">Fabric Colour</th>}
                          <th className="text-left p-2 font-medium w-16">HSN</th>
                          <th className="text-right p-2 font-medium w-12">Qty</th>
                          <th className="text-right p-2 font-medium w-20">Rate</th>
                          <th className="text-right p-2 font-medium w-20">Amount</th>
                          <th className="text-right p-2 font-medium w-14">GST%</th>
                          {isFabric && <th className="text-left p-2 font-medium w-20">Match</th>}
                        </tr>
                      </thead>
                      <tbody>
                        {invoice.lines.map((line, idx) => {
                          const details = getLineDetails(line);
                          return (
                            <tr key={line.id} className="border-t">
                              <td className="p-2 text-center text-muted-foreground">{idx + 1}</td>
                              <td className="p-2 max-w-[200px]" title={details.description}>
                                <span className="block truncate">{details.description}</span>
                              </td>
                              {hasOrderLines && (
                                <td className="p-2 font-mono text-[11px]">{details.skuCode ?? '---'}</td>
                              )}
                              {isFabric && (
                                <td className="p-2 max-w-[160px]">
                                  {invoice.status === 'draft' ? (
                                    <InlineFabricPicker
                                      lineId={line.id}
                                      invoiceId={invoice.id}
                                      currentFabricColour={line.fabricColour ?? null}
                                    />
                                  ) : (
                                    <span className="truncate text-xs">
                                      {line.fabricColour
                                        ? `${line.fabricColour.fabric.name} — ${line.fabricColour.colourName}`
                                        : <span className="text-muted-foreground">Not matched</span>}
                                    </span>
                                  )}
                                </td>
                              )}
                              <td className="p-2">{details.hsn ?? '---'}</td>
                              <td className="p-2 text-right">{line.qty != null ? String(line.qty) : '---'}</td>
                              <td className="p-2 text-right font-mono">{line.rate != null ? formatCurrency(Number(line.rate)) : '---'}</td>
                              <td className="p-2 text-right font-mono">{line.amount != null ? formatCurrency(Number(line.amount)) : '---'}</td>
                              <td className="p-2 text-right">{line.gstPercent != null ? `${line.gstPercent}%` : '---'}</td>
                              {isFabric && (
                                <td className="p-2">
                                  {line.matchType === 'auto_matched' && (
                                    <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-green-100 text-green-700">Auto</span>
                                  )}
                                  {line.matchType === 'manual_matched' && (
                                    <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-blue-100 text-blue-700">Manual</span>
                                  )}
                                  {line.matchType === 'new_entry' && (
                                    <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-purple-100 text-purple-700">New</span>
                                  )}
                                </td>
                              )}
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              );
            })()}

            {/* ========== LINKED PAYMENTS ========== */}
            {invoice.allocations.length > 0 && (
              <div>
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2">Linked Payments</p>
                <div className="border rounded-lg overflow-hidden">
                  <table className="w-full text-xs">
                    <thead className="bg-muted/50">
                      <tr>
                        <th className="text-left p-2 font-medium">Reference</th>
                        <th className="text-left p-2 font-medium">Bank</th>
                        <th className="text-right p-2 font-medium">Amount</th>
                        <th className="text-left p-2 font-medium">Txn Date</th>
                        <th className="text-left p-2 font-medium">Matched By</th>
                      </tr>
                    </thead>
                    <tbody>
                      {invoice.allocations.map((alloc) => (
                        <tr key={alloc.id} className="border-t">
                          <td className="p-2 font-mono">{alloc.bankTransaction?.reference ?? alloc.bankTransaction?.utr ?? '---'}</td>
                          <td className="p-2">{alloc.bankTransaction?.bank?.toUpperCase() ?? '---'}</td>
                          <td className="p-2 text-right font-mono">{formatCurrency(Number(alloc.amount))}</td>
                          <td className="p-2">
                            {alloc.bankTransaction?.txnDate
                              ? new Date(alloc.bankTransaction.txnDate).toLocaleDateString('en-IN')
                              : '---'}
                          </td>
                          <td className="p-2">{alloc.matchedBy?.name ?? '---'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* ========== FOOTER METADATA ========== */}
            <div className="border-t pt-3 mt-2 space-y-1 text-xs text-muted-foreground">
              {invoice.notes && (
                <p><span className="font-medium">Notes:</span> {invoice.notes}</p>
              )}
              {invoice.createdBy && (
                <p>Created by {invoice.createdBy.name}</p>
              )}
              <p>Created {new Date(invoice.createdAt).toLocaleDateString('en-IN')}</p>
              {invoice.aiConfidence != null && (
                <div className="flex items-center gap-1.5">
                  <div className={`w-2 h-2 rounded-full ${invoice.aiConfidence >= 0.8 ? 'bg-green-500' : invoice.aiConfidence >= 0.5 ? 'bg-amber-500' : 'bg-red-500'}`} />
                  AI confidence: {Math.round(invoice.aiConfidence * 100)}%
                </div>
              )}
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
