import { useQuery } from '@tanstack/react-query';
import { useServerFn } from '@tanstack/react-start';
import { getInvoice } from '../../server/functions/finance';
import { formatCurrency, formatPeriod, formatStatus, StatusBadge, LoadingState } from './shared';
import { getCategoryLabel } from '@coh/shared';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { ArrowUpRight, ArrowDownLeft, ExternalLink, Download } from 'lucide-react';
import { Button } from '@/components/ui/button';

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

  const { data, isLoading } = useQuery({
    queryKey: ['finance', 'invoice', invoiceId],
    queryFn: () => getInvoiceFn({ data: { id: invoiceId } }),
    enabled: open && !!invoiceId,
  });

  const invoice = data?.success ? data.invoice : null;

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto">
        {isLoading ? (
          <LoadingState />
        ) : !invoice ? (
          <div className="p-8 text-center text-muted-foreground">Invoice not found</div>
        ) : (
          <>
            {/* Header */}
            <DialogHeader>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <DialogTitle className="text-lg">
                    {invoice.invoiceNumber ? `Invoice #${invoice.invoiceNumber}` : 'Draft Invoice'}
                  </DialogTitle>
                  <StatusBadge status={invoice.status} />
                </div>
                <div className="flex items-center gap-2">
                  {invoice.driveUrl && (
                    <Button variant="outline" size="sm" asChild>
                      <a href={invoice.driveUrl} target="_blank" rel="noopener noreferrer">
                        <ExternalLink className="h-3.5 w-3.5 mr-1" /> Drive
                      </a>
                    </Button>
                  )}
                  {invoice.fileName && (
                    <Button variant="outline" size="sm" asChild>
                      <a href={`/api/finance/invoices/${invoice.id}/file`}>
                        <Download className="h-3.5 w-3.5 mr-1" /> Download
                      </a>
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

            {/* Amount Summary */}
            <div className="grid grid-cols-3 gap-3 mt-4">
              {[
                { label: 'Subtotal', value: invoice.subtotal != null ? formatCurrency(invoice.subtotal) : null },
                { label: `GST${invoice.gstRate ? ` @${invoice.gstRate}%` : ''}`, value: invoice.gstAmount != null && invoice.gstAmount > 0 ? formatCurrency(invoice.gstAmount) : null },
                { label: `TDS${invoice.tdsRate ? ` @${invoice.tdsRate}%` : ''}${invoice.tdsSection ? ` (${invoice.tdsSection})` : ''}`, value: invoice.tdsAmount != null && invoice.tdsAmount > 0 ? formatCurrency(invoice.tdsAmount) : null },
              ].filter(item => item.value != null).map(item => (
                <div key={item.label} className="border rounded-lg p-3 text-center">
                  <p className="text-xs text-muted-foreground">{item.label}</p>
                  <p className="text-sm font-mono font-medium mt-0.5">{item.value}</p>
                </div>
              ))}
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div className="border rounded-lg p-3 text-center bg-muted/30">
                <p className="text-xs text-muted-foreground">Total</p>
                <p className="text-base font-mono font-semibold mt-0.5">{formatCurrency(invoice.totalAmount)}</p>
              </div>
              <div className="border rounded-lg p-3 text-center bg-green-50 dark:bg-green-950">
                <p className="text-xs text-muted-foreground">Paid</p>
                <p className="text-base font-mono font-semibold text-green-700 dark:text-green-400 mt-0.5">
                  {formatCurrency(invoice.totalAmount - invoice.balanceDue)}
                </p>
              </div>
              <div className="border rounded-lg p-3 text-center bg-amber-50 dark:bg-amber-950">
                <p className="text-xs text-muted-foreground">Balance Due</p>
                <p className="text-base font-mono font-semibold text-amber-700 dark:text-amber-400 mt-0.5">
                  {formatCurrency(invoice.balanceDue)}
                </p>
              </div>
            </div>

            {/* Party / Customer */}
            {(invoice.party || invoice.customer) && (
              <div className="border rounded-lg p-4 space-y-2">
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                  {invoice.type === 'payable' ? 'Vendor' : 'Customer'}
                </p>
                {invoice.party && (
                  <div className="space-y-1">
                    <p className="text-sm font-medium">{invoice.party.name}</p>
                    {invoice.type === 'payable' && invoice.party.bankAccountNumber && (
                      <div className="text-xs text-muted-foreground space-y-0.5 mt-1">
                        {invoice.party.bankAccountName && <p>Account Name: {invoice.party.bankAccountName}</p>}
                        <p>Account #: {invoice.party.bankAccountNumber}</p>
                        {invoice.party.bankIfsc && <p>IFSC: {invoice.party.bankIfsc}</p>}
                      </div>
                    )}
                    {invoice.party.tdsApplicable && (
                      <p className="text-xs text-muted-foreground">
                        TDS: {invoice.party.tdsSection ?? 'N/A'} @ {invoice.party.tdsRate != null ? `${invoice.party.tdsRate}%` : 'N/A'}
                      </p>
                    )}
                  </div>
                )}
                {invoice.customer && (
                  <p className="text-sm font-medium">
                    {[invoice.customer.firstName, invoice.customer.lastName].filter(Boolean).join(' ') || invoice.customer.email}
                  </p>
                )}
              </div>
            )}

            {/* Dates */}
            <div className="grid grid-cols-3 gap-4 text-sm">
              <div>
                <p className="text-xs text-muted-foreground">Invoice Date</p>
                <p className="mt-0.5">
                  {invoice.invoiceDate ? new Date(invoice.invoiceDate).toLocaleDateString('en-IN') : '---'}
                </p>
              </div>
              {invoice.dueDate && (
                <div>
                  <p className="text-xs text-muted-foreground">Due Date</p>
                  <p className="mt-0.5">{new Date(invoice.dueDate).toLocaleDateString('en-IN')}</p>
                </div>
              )}
              {invoice.billingPeriod && (
                <div>
                  <p className="text-xs text-muted-foreground">Billing Period</p>
                  <p className="mt-0.5">{formatPeriod(invoice.billingPeriod)}</p>
                </div>
              )}
            </div>

            {/* Line Items */}
            {invoice.lines.length > 0 && (
              <div>
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2">Line Items</p>
                <div className="border rounded-lg overflow-hidden">
                  <table className="w-full text-xs">
                    <thead className="bg-muted/50">
                      <tr>
                        <th className="text-left p-2 font-medium">Description</th>
                        <th className="text-left p-2 font-medium w-16">HSN</th>
                        <th className="text-right p-2 font-medium w-12">Qty</th>
                        <th className="text-left p-2 font-medium w-12">Unit</th>
                        <th className="text-right p-2 font-medium w-20">Rate</th>
                        <th className="text-right p-2 font-medium w-20">Amount</th>
                        <th className="text-right p-2 font-medium w-14">GST%</th>
                      </tr>
                    </thead>
                    <tbody>
                      {invoice.lines.map((line) => (
                        <tr key={line.id} className="border-t">
                          <td className="p-2 max-w-[200px] truncate" title={line.description ?? ''}>
                            {line.description ?? '---'}
                          </td>
                          <td className="p-2">{line.hsnCode ?? '---'}</td>
                          <td className="p-2 text-right">{line.qty != null ? String(line.qty) : '---'}</td>
                          <td className="p-2">{line.unit ?? '---'}</td>
                          <td className="p-2 text-right font-mono">{line.rate != null ? formatCurrency(Number(line.rate)) : '---'}</td>
                          <td className="p-2 text-right font-mono">{line.amount != null ? formatCurrency(Number(line.amount)) : '---'}</td>
                          <td className="p-2 text-right">{line.gstPercent != null ? `${line.gstPercent}%` : '---'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* Linked Payments */}
            {invoice.allocations.length > 0 && (
              <div>
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2">Linked Payments</p>
                <div className="border rounded-lg overflow-hidden">
                  <table className="w-full text-xs">
                    <thead className="bg-muted/50">
                      <tr>
                        <th className="text-left p-2 font-medium">Reference #</th>
                        <th className="text-left p-2 font-medium">Method</th>
                        <th className="text-right p-2 font-medium">Amount</th>
                        <th className="text-left p-2 font-medium">Payment Date</th>
                        <th className="text-left p-2 font-medium">Matched By</th>
                      </tr>
                    </thead>
                    <tbody>
                      {invoice.allocations.map((alloc) => (
                        <tr key={alloc.id} className="border-t">
                          <td className="p-2 font-mono">{alloc.payment.referenceNumber ?? '---'}</td>
                          <td className="p-2">{formatStatus(alloc.payment.method)}</td>
                          <td className="p-2 text-right font-mono">{formatCurrency(Number(alloc.amount))}</td>
                          <td className="p-2">
                            {alloc.payment.paymentDate
                              ? new Date(alloc.payment.paymentDate).toLocaleDateString('en-IN')
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

            {/* Footer Metadata */}
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
