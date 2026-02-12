/**
 * Backfill salary invoices + ledger entries for existing PayrollRuns.
 * Replicates what confirmPayrollRun does, but for already-confirmed historical runs.
 * Then attempts to match invoices to existing bank payments by amount + date proximity.
 *
 * Usage: DATABASE_URL=... tsx server/scripts/backfill-payroll-invoices.ts
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** Tolerance for amount matching (₹) */
const MATCH_TOLERANCE = 5;

/** Payment date window: from 1st of the payroll month to 15th of next month */
function getPaymentWindow(month: number, year: number) {
  const from = new Date(year, month - 1, 1);
  const toYear = month === 12 ? year + 1 : year;
  const toMonth = month === 12 ? 1 : month;
  const to = new Date(toYear, toMonth - 1, 15);
  return { from, to };
}

async function main() {
  // Get admin user for createdById
  const admin = await prisma.user.findFirst({ where: { role: 'admin' } });
  if (!admin) throw new Error('No admin user found');

  // Get ledger account IDs
  const accounts = await prisma.ledgerAccount.findMany({
    where: { code: { in: ['OPERATING_EXPENSES', 'ACCOUNTS_PAYABLE'] } },
    select: { id: true, code: true },
  });
  const accountMap = new Map(accounts.map(a => [a.code, a.id]));
  if (!accountMap.has('OPERATING_EXPENSES') || !accountMap.has('ACCOUNTS_PAYABLE')) {
    throw new Error('Missing ledger accounts: OPERATING_EXPENSES or ACCOUNTS_PAYABLE');
  }

  // Load all runs with slips
  const runs = await prisma.payrollRun.findMany({
    include: {
      slips: {
        include: {
          employee: { select: { id: true, name: true, partyId: true } },
        },
      },
    },
    orderBy: [{ year: 'asc' }, { month: 'asc' }],
  });

  console.log(`Found ${runs.length} payroll runs\n`);

  let totalInvoices = 0;
  let totalMatched = 0;
  const allInvoiceIds: Array<{ invoiceId: string; employeeName: string; partyId: string | null; netPay: number; month: number; year: number }> = [];

  // ─── Step 1: Create invoices + ledger entries ───

  for (const run of runs) {
    const monthLabel = `${MONTH_NAMES[run.month - 1]} ${run.year}`;
    const lastDay = new Date(run.year, run.month, 0).getDate();
    const invoiceDate = new Date(run.year, run.month - 1, lastDay);

    console.log(`=== ${monthLabel} (${run.slips.length} slips) ===`);

    for (const slip of run.slips) {
      if (slip.netPay <= 0) {
        console.log(`  Skip ${slip.employee.name} (netPay = ${slip.netPay})`);
        continue;
      }

      // Already has invoice?
      if (slip.invoiceId) {
        console.log(`  Skip ${slip.employee.name} (already has invoice)`);
        continue;
      }

      // Create invoice
      const invoice = await prisma.invoice.create({
        data: {
          type: 'payable',
          category: 'salary',
          status: 'draft',
          invoiceDate,
          totalAmount: slip.netPay,
          balanceDue: slip.netPay,
          counterpartyName: slip.employee.name,
          ...(slip.employee.partyId ? { partyId: slip.employee.partyId } : {}),
          notes: `Salary for ${monthLabel}`,
          createdById: admin.id,
        },
      });

      // Create ledger entry
      const entry = await prisma.ledgerEntry.create({
        data: {
          entryDate: invoiceDate,
          description: `Salary: ${slip.employee.name} - ${monthLabel}`,
          sourceType: 'invoice_confirmed',
          sourceId: invoice.id,
          createdById: admin.id,
          lines: {
            create: [
              {
                accountId: accountMap.get('OPERATING_EXPENSES')!,
                debit: slip.netPay,
                credit: 0,
                description: `Salary - ${slip.employee.name}`,
              },
              {
                accountId: accountMap.get('ACCOUNTS_PAYABLE')!,
                debit: 0,
                credit: slip.netPay,
                description: `Salary payable - ${slip.employee.name}`,
              },
            ],
          },
        },
      });

      // Confirm invoice + link ledger entry + link to slip
      await prisma.invoice.update({
        where: { id: invoice.id },
        data: { status: 'confirmed', ledgerEntryId: entry.id },
      });

      await prisma.payrollSlip.update({
        where: { id: slip.id },
        data: { invoiceId: invoice.id },
      });

      allInvoiceIds.push({
        invoiceId: invoice.id,
        employeeName: slip.employee.name,
        partyId: slip.employee.partyId,
        netPay: slip.netPay,
        month: run.month,
        year: run.year,
      });

      totalInvoices++;
      console.log(`  ✓ ${slip.employee.name} — ₹${slip.netPay.toLocaleString()} → invoice ${invoice.id.slice(0, 8)}`);
    }
  }

  console.log(`\n✅ Created ${totalInvoices} salary invoices with ledger entries\n`);

  // ─── Step 2: Try to match payments ───

  console.log('=== Attempting payment matching ===\n');

  for (const inv of allInvoiceIds) {
    if (!inv.partyId) {
      console.log(`  ⏭ ${inv.employeeName} ${MONTH_NAMES[inv.month - 1]} ${inv.year} — no partyId, skip matching`);
      continue;
    }

    const { from, to } = getPaymentWindow(inv.month, inv.year);

    // Find payments to this employee in the date window
    const payments = await prisma.payment.findMany({
      where: {
        partyId: inv.partyId,
        direction: 'outgoing',
        status: { not: 'cancelled' },
        paymentDate: { gte: from, lte: to },
        unmatchedAmount: { gt: 0 },
      },
      orderBy: { paymentDate: 'asc' },
    });

    if (payments.length === 0) continue; // Most won't have payments (paid via RazorpayPayroll IDFC)

    // Look for exact-ish match
    const match = payments.find(p => Math.abs(p.unmatchedAmount - inv.netPay) <= MATCH_TOLERANCE);

    if (!match) {
      // Log near-misses for debugging
      const amounts = payments.map(p => `₹${p.amount} (${p.paymentDate.toISOString().slice(0, 10)})`).join(', ');
      console.log(`  ⚠ ${inv.employeeName} ${MONTH_NAMES[inv.month - 1]} ${inv.year} — no amount match. Invoice: ₹${inv.netPay}, Payments: ${amounts}`);
      continue;
    }

    // Create the match
    await prisma.$transaction(async (tx) => {
      await tx.paymentInvoice.create({
        data: {
          paymentId: match.id,
          invoiceId: inv.invoiceId,
          amount: inv.netPay,
          notes: `Backfill match: salary ${MONTH_NAMES[inv.month - 1]} ${inv.year}`,
          matchedById: admin.id,
        },
      });

      const newPaymentMatched = match.matchedAmount + inv.netPay;
      const newPaymentUnmatched = match.unmatchedAmount - inv.netPay;
      await tx.payment.update({
        where: { id: match.id },
        data: {
          matchedAmount: newPaymentMatched,
          unmatchedAmount: Math.max(0, newPaymentUnmatched),
        },
      });

      await tx.invoice.update({
        where: { id: inv.invoiceId },
        data: {
          paidAmount: inv.netPay,
          balanceDue: 0,
          status: 'paid',
        },
      });
    });

    totalMatched++;
    console.log(`  ✅ ${inv.employeeName} ${MONTH_NAMES[inv.month - 1]} ${inv.year} — matched to payment ₹${match.amount} on ${match.paymentDate.toISOString().slice(0, 10)}`);
  }

  console.log(`\n✅ Done! ${totalInvoices} invoices created, ${totalMatched} matched to payments`);
  console.log(`   ${totalInvoices - totalMatched} invoices unmatched (paid via RazorpayPayroll IDFC)`);
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
