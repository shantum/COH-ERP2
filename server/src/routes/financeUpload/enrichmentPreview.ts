/**
 * Enrichment Preview — read-only analysis of what enrichment WOULD happen.
 */

import type { Request } from 'express';
import type { ParsedInvoice } from '../../services/invoiceParser.js';
import type { EnrichmentPreview } from '../../services/invoicePreviewCache.js';
import { panFromGstin, FIELD_LABELS } from './partyEnricher.js';

/**
 * Preview what enrichment WOULD happen without writing anything.
 * Returns field changes that would occur on confirm.
 */
export async function previewEnrichment(
  prisma: Request['prisma'],
  partyId: string | undefined,
  parsed: ParsedInvoice,
): Promise<EnrichmentPreview> {
  if (partyId) {
    // Existing party — check what fields would be added
    const party = await prisma.party.findUnique({
      where: { id: partyId },
      select: {
        gstin: true, pan: true, email: true, phone: true,
        address: true, stateCode: true,
        bankAccountNumber: true, bankIfsc: true, bankName: true, bankAccountName: true,
      },
    });
    if (!party) return { willCreateNewParty: false, fieldsWillBeAdded: [], bankMismatch: false };

    const fieldsWillBeAdded: string[] = [];

    // Non-bank fields
    const nonBank: Array<{ field: keyof typeof party; value: string | null | undefined }> = [
      { field: 'gstin', value: parsed.supplierGstin },
      { field: 'pan', value: parsed.supplierPan ?? (parsed.supplierGstin ? panFromGstin(parsed.supplierGstin) : null) },
      { field: 'email', value: parsed.supplierEmail },
      { field: 'phone', value: parsed.supplierPhone },
      { field: 'address', value: parsed.supplierAddress },
      { field: 'stateCode', value: parsed.supplierStateCode },
    ];
    for (const { field, value } of nonBank) {
      if (value && !party[field]) fieldsWillBeAdded.push(FIELD_LABELS[field] ?? field);
    }

    // Bank fields
    const partyHasBank = !!party.bankAccountNumber;
    const invoiceHasBank = !!parsed.supplierBankAccountNumber;
    let bankMismatch = false;
    let bankMismatchDetails: string | undefined;

    if (invoiceHasBank && !partyHasBank) {
      const bankFields: Array<{ field: keyof typeof party; value: string | null | undefined }> = [
        { field: 'bankAccountNumber', value: parsed.supplierBankAccountNumber },
        { field: 'bankIfsc', value: parsed.supplierBankIfsc },
        { field: 'bankName', value: parsed.supplierBankName },
        { field: 'bankAccountName', value: parsed.supplierBankAccountName },
      ];
      for (const { field, value } of bankFields) {
        if (value) fieldsWillBeAdded.push(FIELD_LABELS[field] ?? field);
      }
    } else if (invoiceHasBank && partyHasBank) {
      const invoiceAcct = parsed.supplierBankAccountNumber?.replace(/\s/g, '') ?? '';
      const partyAcct = party.bankAccountNumber?.replace(/\s/g, '') ?? '';
      if (invoiceAcct && partyAcct && invoiceAcct !== partyAcct) {
        bankMismatch = true;
        bankMismatchDetails = `Invoice: ${parsed.supplierBankAccountNumber} (${parsed.supplierBankIfsc ?? '?'}) vs ERP: ${party.bankAccountNumber} (${party.bankIfsc ?? '?'})`;
      }
    }

    return { willCreateNewParty: false, fieldsWillBeAdded, bankMismatch, bankMismatchDetails };
  }

  if (parsed.supplierName) {
    // No party match — would create new party
    const fieldsWillBeAdded: string[] = [];
    const optionalFields: Array<{ value: string | null | undefined; label: string }> = [
      { value: parsed.supplierGstin, label: 'GSTIN' },
      { value: parsed.supplierPan ?? (parsed.supplierGstin ? panFromGstin(parsed.supplierGstin) : null), label: 'PAN' },
      { value: parsed.supplierEmail, label: 'Email' },
      { value: parsed.supplierPhone, label: 'Phone' },
      { value: parsed.supplierAddress, label: 'Address' },
      { value: parsed.supplierStateCode, label: 'State Code' },
      { value: parsed.supplierBankAccountNumber, label: 'Bank Account' },
      { value: parsed.supplierBankIfsc, label: 'Bank IFSC' },
      { value: parsed.supplierBankName, label: 'Bank Name' },
      { value: parsed.supplierBankAccountName, label: 'Beneficiary Name' },
    ];
    for (const { value, label } of optionalFields) {
      if (value) fieldsWillBeAdded.push(label);
    }
    return { willCreateNewParty: true, newPartyName: parsed.supplierName, fieldsWillBeAdded, bankMismatch: false };
  }

  return { willCreateNewParty: false, fieldsWillBeAdded: [], bankMismatch: false };
}
