/**
 * Transaction Type Resolver
 *
 * Matches bank narrations to Party records via aliases,
 * then returns the accounting treatment from the Party's TransactionType.
 *
 * Resolution: Narration → Party (via aliases, longest match wins) → TransactionType
 */

export interface PartyWithTxnType {
  id: string;
  name: string;
  aliases: string[];
  category: string;
  tdsApplicable: boolean;
  tdsSection: string | null;
  tdsRate: number | null;
  invoiceRequired: boolean;
  transactionType: {
    id: string;
    name: string;
    debitAccountCode: string | null;
    creditAccountCode: string | null;
    defaultGstRate: number | null;
    defaultTdsApplicable: boolean;
    defaultTdsSection: string | null;
    defaultTdsRate: number | null;
    invoiceRequired: boolean;
    expenseCategory: string | null;
  } | null;
}

export interface ResolvedAccounting {
  partyId: string;
  partyName: string;
  debitAccount: string | null;
  creditAccount: string | null;
  category: string | null;
  invoiceRequired: boolean;
  tdsApplicable: boolean;
  tdsSection: string | null;
  tdsRate: number | null;
}

/**
 * Match a narration string to a Party using alias matching.
 *
 * Rules:
 * - Aliases are stored uppercase
 * - Matching is substring-based on the uppercased narration
 * - Compound aliases use `+` separator: "RAZORPAY SOFTWARE+ESCROW" means
 *   both "RAZORPAY SOFTWARE" AND "ESCROW" must appear in the narration
 * - Longest matching alias wins (prevents short alias stealing matches from longer ones)
 */
export function findPartyByNarration(
  narration: string,
  parties: PartyWithTxnType[],
): PartyWithTxnType | null {
  const upper = narration.toUpperCase();

  let bestMatch: PartyWithTxnType | null = null;
  let bestLength = 0;

  for (const party of parties) {
    for (const alias of party.aliases) {
      const aliasUpper = alias.toUpperCase();

      // Check for compound alias (parts joined by +)
      const parts = aliasUpper.split('+');
      const allMatch = parts.every(part => upper.includes(part.trim()));

      if (allMatch) {
        // Total length of all parts = match quality
        const matchLength = parts.reduce((sum, p) => sum + p.trim().length, 0);
        if (matchLength > bestLength) {
          bestLength = matchLength;
          bestMatch = party;
        }
      }
    }
  }

  return bestMatch;
}

/**
 * Resolve the accounting treatment for a matched Party.
 * Party-level overrides take precedence over TransactionType defaults.
 */
export function resolveAccounting(party: PartyWithTxnType): ResolvedAccounting {
  const tt = party.transactionType;

  return {
    partyId: party.id,
    partyName: party.name,
    debitAccount: tt?.debitAccountCode ?? null,
    creditAccount: tt?.creditAccountCode ?? null,
    category: tt?.expenseCategory ?? party.category,
    invoiceRequired: party.invoiceRequired,
    // Party overrides for TDS
    tdsApplicable: party.tdsApplicable || (tt?.defaultTdsApplicable ?? false),
    tdsSection: party.tdsSection ?? tt?.defaultTdsSection ?? null,
    tdsRate: party.tdsRate ?? tt?.defaultTdsRate ?? null,
  };
}
