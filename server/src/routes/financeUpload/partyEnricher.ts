/**
 * Party Enrichment — auto-fill Party fields from AI-parsed invoice data.
 */

import type { Request } from 'express';
import type { Prisma } from '@prisma/client';
import type { ParsedInvoice } from '../../services/invoiceParser.js';
import logger from '../../utils/logger.js';

const log = logger.child({ module: 'financeUpload' });

export interface EnrichmentResult {
  fieldsAdded: string[];
  bankMismatch: boolean;
  bankMismatchDetails?: string;
  partyCreated: boolean;
  partyName?: string;
}

/** Derive PAN from 15-char GSTIN (chars at index 2..11) */
export function panFromGstin(gstin: string): string | null {
  if (gstin.length === 15) return gstin.slice(2, 12);
  return null;
}

/** Human-readable label for a Party field */
export const FIELD_LABELS: Record<string, string> = {
  gstin: 'GSTIN',
  pan: 'PAN',
  email: 'Email',
  phone: 'Phone',
  address: 'Address',
  stateCode: 'State Code',
  bankAccountNumber: 'Bank Account',
  bankIfsc: 'Bank IFSC',
  bankName: 'Bank Name',
  bankAccountName: 'Beneficiary Name',
};

/**
 * Auto-fill missing Party fields from AI-parsed invoice data.
 * Bank details: only fill if party has none; flag mismatch if different.
 */
export async function enrichPartyFromInvoice(
  prisma: Request['prisma'],
  partyId: string,
  parsed: ParsedInvoice,
): Promise<EnrichmentResult> {
  const result: EnrichmentResult = { fieldsAdded: [], bankMismatch: false, partyCreated: false };

  const party = await prisma.party.findUnique({
    where: { id: partyId },
    select: {
      gstin: true, pan: true, email: true, phone: true,
      address: true, stateCode: true,
      bankAccountNumber: true, bankIfsc: true, bankName: true, bankAccountName: true,
    },
  });
  if (!party) return result;

  // Map: partyField → parsed value
  const nonBankFields: Array<{ field: keyof typeof party; value: string | null | undefined }> = [
    { field: 'gstin', value: parsed.supplierGstin },
    { field: 'pan', value: parsed.supplierPan ?? (parsed.supplierGstin ? panFromGstin(parsed.supplierGstin) : null) },
    { field: 'email', value: parsed.supplierEmail },
    { field: 'phone', value: parsed.supplierPhone },
    { field: 'address', value: parsed.supplierAddress },
    { field: 'stateCode', value: parsed.supplierStateCode },
  ];

  const bankFields: Array<{ field: keyof typeof party; value: string | null | undefined }> = [
    { field: 'bankAccountNumber', value: parsed.supplierBankAccountNumber },
    { field: 'bankIfsc', value: parsed.supplierBankIfsc },
    { field: 'bankName', value: parsed.supplierBankName },
    { field: 'bankAccountName', value: parsed.supplierBankAccountName },
  ];

  const updates: Record<string, string> = {};

  // Non-bank: fill if party is missing
  for (const { field, value } of nonBankFields) {
    if (value && !party[field]) {
      updates[field] = value;
      result.fieldsAdded.push(FIELD_LABELS[field] ?? field);
    }
  }

  // Bank: fill only if party has NO bank details at all
  const partyHasBank = !!party.bankAccountNumber;
  const invoiceHasBank = !!parsed.supplierBankAccountNumber;

  if (invoiceHasBank && !partyHasBank) {
    // Party has no bank info → auto-fill
    for (const { field, value } of bankFields) {
      if (value) {
        updates[field] = value;
        result.fieldsAdded.push(FIELD_LABELS[field] ?? field);
      }
    }
  } else if (invoiceHasBank && partyHasBank) {
    // Both have bank info → check for mismatch
    const invoiceAcct = parsed.supplierBankAccountNumber?.replace(/\s/g, '') ?? '';
    const partyAcct = party.bankAccountNumber?.replace(/\s/g, '') ?? '';
    if (invoiceAcct && partyAcct && invoiceAcct !== partyAcct) {
      result.bankMismatch = true;
      result.bankMismatchDetails = `Invoice: ${parsed.supplierBankAccountNumber} (${parsed.supplierBankIfsc ?? '?'}) vs ERP: ${party.bankAccountNumber} (${party.bankIfsc ?? '?'})`;
    }
  }

  // Apply updates
  if (Object.keys(updates).length > 0) {
    await prisma.party.update({
      where: { id: partyId },
      data: updates,
    });
    log.info({ partyId, fieldsAdded: result.fieldsAdded }, 'Party enriched from invoice');
  }

  return result;
}

/**
 * Create a new Party from AI-parsed invoice data when no match is found.
 */
export async function createPartyFromInvoice(
  prisma: Request['prisma'],
  parsed: ParsedInvoice,
): Promise<{ partyId: string; enrichment: EnrichmentResult } | null> {
  const name = parsed.supplierName?.trim();
  if (!name) return null;

  const fieldsAdded: string[] = [];

  // Build optional fields from AI-parsed data, tracking which were found
  const optionalFields: Array<{ key: keyof Prisma.PartyUncheckedCreateInput; value: string | null | undefined; label: string }> = [
    { key: 'gstin', value: parsed.supplierGstin, label: 'GSTIN' },
    { key: 'pan', value: parsed.supplierPan ?? (parsed.supplierGstin ? panFromGstin(parsed.supplierGstin) : null), label: 'PAN' },
    { key: 'email', value: parsed.supplierEmail, label: 'Email' },
    { key: 'phone', value: parsed.supplierPhone, label: 'Phone' },
    { key: 'address', value: parsed.supplierAddress, label: 'Address' },
    { key: 'stateCode', value: parsed.supplierStateCode, label: 'State Code' },
    { key: 'bankAccountNumber', value: parsed.supplierBankAccountNumber, label: 'Bank Account' },
    { key: 'bankIfsc', value: parsed.supplierBankIfsc, label: 'Bank IFSC' },
    { key: 'bankName', value: parsed.supplierBankName, label: 'Bank Name' },
    { key: 'bankAccountName', value: parsed.supplierBankAccountName, label: 'Beneficiary Name' },
  ];

  const extras: Partial<Prisma.PartyUncheckedCreateInput> = {};
  for (const { key, value, label } of optionalFields) {
    if (value) {
      (extras[key] as string) = value;
      fieldsAdded.push(label);
    }
  }

  try {
    const newParty = await prisma.party.create({
      data: {
        name,
        category: 'other',
        isActive: true,
        aliases: [name.toUpperCase()],
        ...extras,
      },
      select: { id: true, name: true },
    });

    log.info({ partyId: newParty.id, name: newParty.name, fieldsAdded }, 'New Party created from invoice');

    return {
      partyId: newParty.id,
      enrichment: {
        fieldsAdded,
        bankMismatch: false,
        partyCreated: true,
        partyName: newParty.name,
      },
    };
  } catch (err: unknown) {
    // Unique constraint on name — party might already exist with exact name
    log.warn({ name, error: err instanceof Error ? err.message : err }, 'Failed to create party from invoice (possible duplicate name)');
    return null;
  }
}
