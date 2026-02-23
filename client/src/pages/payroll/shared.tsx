import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ChevronLeft, ChevronRight, Loader2 } from 'lucide-react';
import { PAYROLL_STATUS_LABELS } from '@coh/shared';

export function formatINR(amount: number): string {
  return '\u20B9' + amount.toLocaleString('en-IN', { maximumFractionDigits: 0 });
}

export const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function StatusBadge({ status }: { status: string }) {
  const variant =
    status === 'confirmed' ? 'default' :
    status === 'draft' ? 'secondary' :
    status === 'cancelled' ? 'destructive' :
    'outline';
  return <Badge variant={variant}>{PAYROLL_STATUS_LABELS[status] ?? status}</Badge>;
}

export function Pagination({ page, total, limit, onPageChange }: { page: number; total: number; limit: number; onPageChange: (p: number) => void }) {
  const totalPages = Math.ceil(total / limit);
  if (totalPages <= 1) return null;
  return (
    <div className="flex items-center justify-between mt-4 text-sm text-muted-foreground">
      <span>{total} total</span>
      <div className="flex items-center gap-2">
        <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => onPageChange(page - 1)}>
          <ChevronLeft className="h-4 w-4" />
        </Button>
        <span>Page {page} of {totalPages}</span>
        <Button variant="outline" size="sm" disabled={page >= totalPages} onClick={() => onPageChange(page + 1)}>
          <ChevronRight className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}

export function LoadingState() {
  return (
    <div className="flex items-center justify-center p-12 text-muted-foreground">
      <Loader2 className="h-5 w-5 animate-spin mr-2" /> Loading...
    </div>
  );
}

export function SummaryCard({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div className={`border rounded-lg p-3 ${highlight ? 'bg-primary/5 border-primary/20' : ''}`}>
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className={`text-lg font-bold ${highlight ? 'text-primary' : ''}`}>{value}</div>
    </div>
  );
}
