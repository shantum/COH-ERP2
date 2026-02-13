/**
 * Bank Statement Import Rules
 *
 * Central config for how bank transactions get categorized and booked.
 * Used by both RazorpayX and HDFC import scripts.
 *
 * To change how a vendor/payee is categorized, edit the maps below.
 * The import scripts read from here — changes take effect on next run.
 */

// ============================================
// VENDOR → CATEGORY (RazorpayX payouts)
// ============================================

export interface VendorRule {
  /** Finance invoice category */
  category: string;
  /** Ledger account to debit when paying this vendor */
  debitAccount: string;
  /** Human-readable description override */
  description?: string;
  /** If set, debitAccount only applies when payout notes contain this keyword (case-insensitive). Otherwise uses defaultDebitAccount. */
  noteKeyword?: string;
  /** Fallback debit account when noteKeyword doesn't match */
  defaultDebitAccount?: string;
}

/**
 * Maps RazorpayX contact names to their accounting treatment.
 * When a "vendor bill" payout is made to one of these contacts,
 * the debitAccount determines where the expense lands in the ledger.
 */
export const VENDOR_RULES: Record<string, VendorRule> = {
  // ---- Fabric suppliers ----
  'Circular Textiles':        { category: 'fabric',    debitAccount: 'FABRIC_INVENTORY' },
  'Arkap Knits Pvt Ltd':      { category: 'fabric',    debitAccount: 'FABRIC_INVENTORY' },
  'SHREE BALAJI ENTERPRISES': { category: 'fabric',    debitAccount: 'FABRIC_INVENTORY' },
  'Kishanlal & Sons':         { category: 'fabric',    debitAccount: 'FABRIC_INVENTORY' },
  'Kishorkumar Kakubhai':     { category: 'fabric',    debitAccount: 'FABRIC_INVENTORY' },
  'Naaz Handloom':            { category: 'fabric',    debitAccount: 'ACCOUNTS_PAYABLE' }, // has matching invoice
  'Mahaveer & Co':            { category: 'fabric',    debitAccount: 'FABRIC_INVENTORY', description: 'Supima/rib fabric' },
  'Nandlal Vijaykumar':       { category: 'fabric',    debitAccount: 'FABRIC_INVENTORY' },
  'SHREE DHANLAXMI TEXTILES': { category: 'fabric',    debitAccount: 'FABRIC_INVENTORY' },
  'Girish & Co':              { category: 'fabric',    debitAccount: 'FABRIC_INVENTORY', description: 'Linen fabric' },
  'CHACHA Clothing Co.':      { category: 'fabric',    debitAccount: 'FABRIC_INVENTORY', description: 'Sample fabric' },
  'V Clothing':               { category: 'fabric',    debitAccount: 'FABRIC_INVENTORY', description: 'Linen fabric' },
  'Shakti Silk Mills EXP':    { category: 'fabric',    debitAccount: 'FABRIC_INVENTORY', description: 'Silk fabric' },
  'Hitesh Trading Co.':       { category: 'fabric',    debitAccount: 'FABRIC_INVENTORY', description: 'Viscose fabric' },

  // ---- Trims / Labels ----
  'Janaksons':                { category: 'trims',     debitAccount: 'FABRIC_INVENTORY' },
  'Bhairav':                  { category: 'trims',     debitAccount: 'FABRIC_INVENTORY' },
  'Tag House International':  { category: 'trims',     debitAccount: 'FABRIC_INVENTORY', description: 'Tags/labels' },
  'Saraswathi Labels & Packaging Pvt. Ltd.': { category: 'trims', debitAccount: 'FABRIC_INVENTORY', description: 'Labels' },

  // ---- Rent ----
  'PRATIBHA DILIP JADHAV':    { category: 'rent',      debitAccount: 'OPERATING_EXPENSES', description: 'Unit rent' },
  'PRASAD DILIP JADHAV':      { category: 'rent',      debitAccount: 'OPERATING_EXPENSES', description: 'Unit rent' },
  'CMM':                      { category: 'rent',      debitAccount: 'OPERATING_EXPENSES', description: 'Panjim retail store rent' },
  'Dilip Somsing Jadhav':     { category: 'rent',      debitAccount: 'OPERATING_EXPENSES', description: 'Unit rent' },
  'Dilip Somsing Jadhav 2':   { category: 'rent',      debitAccount: 'OPERATING_EXPENSES', description: 'Unit rent' },

  // ---- Marketing ----
  'Google India Pvt. Ltd.':   { category: 'marketing', debitAccount: 'OPERATING_EXPENSES' },
  'Brandslane':               { category: 'marketing', debitAccount: 'OPERATING_EXPENSES' },
  'Snehal Fernandes':         { category: 'marketing', debitAccount: 'OPERATING_EXPENSES', description: 'Social media' },
  'Studio Sousa':             { category: 'marketing', debitAccount: 'OPERATING_EXPENSES', description: 'Photography' },
  'Rijuta Banerjee':          { category: 'marketing', debitAccount: 'OPERATING_EXPENSES', description: 'Modeling' },
  'FRANCESCA D M COTTA':      { category: 'marketing', debitAccount: 'OPERATING_EXPENSES', description: 'Photoshoot styling' },

  // ---- Brokerage ----
  'Urmilla Dias Easy Living':              { category: 'service', debitAccount: 'OPERATING_EXPENSES', description: 'Retail store brokerage' },

  // ---- Service vendors ----
  'Datastraw Technologies Private Limited': { category: 'service', debitAccount: 'OPERATING_EXPENSES', description: 'Tech service' },
  'Brego Business Private Limited':         { category: 'service', debitAccount: 'OPERATING_EXPENSES' },
  'Rhyzome Consulting Private Limited':     { category: 'service', debitAccount: 'OPERATING_EXPENSES', description: 'Website management' },
  'Bharat Pandurang More':                  { category: 'service', debitAccount: 'OPERATING_EXPENSES', description: 'Pattern master' },
  'Wash N Wear Apparels Processor':         { category: 'service', debitAccount: 'OPERATING_EXPENSES', description: 'Wash processing' },
  'Suman Dalal':                            { category: 'service', debitAccount: 'OPERATING_EXPENSES', description: 'Merchandising consultant' },
  'Shefali Ann Cordeiro':                   { category: 'service', debitAccount: 'OPERATING_EXPENSES', description: 'Retail store architect' },

  // ---- Packaging ----
  'Basant Envelopes':         { category: 'packaging', debitAccount: 'OPERATING_EXPENSES' },
  'Shree Satyanarayan Ji Impex': { category: 'packaging', debitAccount: 'OPERATING_EXPENSES', description: 'Packaging bags' },

  // ---- Salary employees (vendor bill payouts) ----
  'Pranay Das':               { category: 'salary',    debitAccount: 'OPERATING_EXPENSES', description: 'Salary' },

  // ---- Statutory payments ----
  'Mohammed Zubear Shaikh':   { category: 'statutory',  debitAccount: 'TDS_PAYABLE', description: 'TDS deposit (statutory)', noteKeyword: 'TDS', defaultDebitAccount: 'OPERATING_EXPENSES' },
  'Swapnil Suresh Gite':      { category: 'salary',    debitAccount: 'OPERATING_EXPENSES', description: 'PF deposit (statutory)' },

  // ---- Unit/misc expenses ----
  'Sanjog Enterprises':       { category: 'other',     debitAccount: 'OPERATING_EXPENSES', description: 'Unit water expenses' },
  'M.R. VISHWAKARMA':         { category: 'equipment', debitAccount: 'OPERATING_EXPENSES', description: 'Machine maintenance' },
  'Kalpesh G. Bhongle':       { category: 'other',     debitAccount: 'OPERATING_EXPENSES', description: 'Unit electrician' },

  // ---- Marketing (Meta Ads via RazorpayX) ----
  'Facebook India Online Services Pvt. Ltd.': { category: 'marketing', debitAccount: 'OPERATING_EXPENSES', description: 'Facebook/Meta Ads' },

  // ---- Packaging ----
  'Greymark Packaging (MUM)': { category: 'packaging', debitAccount: 'OPERATING_EXPENSES', description: 'Packaging' },
  'Barscan Systems & Ribbons Pvt. Ltd': { category: 'packaging', debitAccount: 'OPERATING_EXPENSES', description: 'Barcode labels' },

  // ---- Fabric processing ----
  'MOHD. IMRAN DYEING':       { category: 'service',   debitAccount: 'OPERATING_EXPENSES', description: 'Fabric dyeing' },
  'D. K. Prints':             { category: 'packaging',  debitAccount: 'OPERATING_EXPENSES', description: 'Stickers/labels' },
  'S M Exports':              { category: 'service',   debitAccount: 'OPERATING_EXPENSES', description: 'Production service' },
  'ZED Creation':             { category: 'service',   debitAccount: 'OPERATING_EXPENSES', description: 'Fabric wash processing' },
  'Dev Process':              { category: 'service',   debitAccount: 'OPERATING_EXPENSES', description: 'Fabric processing' },

  // ---- Fabric vendors (production fabrics) ----
  'SHUBH CREATION':           { category: 'fabric',    debitAccount: 'FABRIC_INVENTORY', description: 'Fabric purchase' },
  'DARSHAN CREATION PVT. LTD.': { category: 'fabric',  debitAccount: 'FABRIC_INVENTORY', description: 'Fabric purchase' },
  'Gemini Fashion':           { category: 'fabric',    debitAccount: 'FABRIC_INVENTORY', description: 'Fabric purchase' },
  'Mehta Clothing':           { category: 'fabric',    debitAccount: 'FABRIC_INVENTORY', description: 'Fabric purchase' },
  'MAYKA LIFESTYLE':          { category: 'fabric',    debitAccount: 'FABRIC_INVENTORY', description: 'Fabric purchase' },

  // ---- Retail store ----
  'Bowerbird Interios':       { category: 'service',   debitAccount: 'OPERATING_EXPENSES', description: 'Retail store interiors' },

  // ---- Logistics ----
  'DP INTERNATIONAL':         { category: 'logistics', debitAccount: 'OPERATING_EXPENSES', description: 'Courier/logistics' },
};

// ============================================
// TAILOR NAMES (piecework detection)
// ============================================

/**
 * People who are on salary but also get small "vendor bill" payouts
 * for production piecework. When their name appears on a vendor bill,
 * it's booked as production service expense (not salary).
 */
export const TAILOR_NAMES = new Set([
  'Anwar Ali',
  'Bablu Turi',
  'Rajkumar',
  'Ramji Prajapati',
  'Leena Divekar',
  'Chintamani Rajkumar',
  'Haresh Sadhu Poojary',
  'Manoj Kumar Goutam',
  'Vishal Vishwanath Jadhav',
  'Mohamad Hasmuddin Mansuri',
  'ABDULLAH ANSARI',
  'Jyoti Rakesh Kumar Patel',
  'Prabhakar Maharana',
  'Mahindra P',
  'Sanjay Kumar',
  'MD ARIF',
]);

// ============================================
// RAZORPAYX PURPOSE → ACCOUNTS
// ============================================

/**
 * For non-vendor-bill payouts, the purpose field tells us what it is.
 */
export const PURPOSE_RULES: Record<string, { debitAccount: string; creditAccount: string }> = {
  refund:   { debitAccount: 'SALES_REVENUE',     creditAccount: 'BANK_RAZORPAYX' },
  salary:   { debitAccount: 'OPERATING_EXPENSES', creditAccount: 'BANK_RAZORPAYX' },
  rzp_fees: { debitAccount: 'MARKETPLACE_FEES',   creditAccount: 'BANK_RAZORPAYX' },
};

// ============================================
// UPI PAYEE → CATEGORY (HDFC statement)
// ============================================

export interface UpiPayeeRule {
  debitAccount: string;
  description: string;
  category?: string;
}

/**
 * Maps UPI payee names (partial match) to their accounting treatment.
 * Used when parsing HDFC bank statement UPI transactions.
 */
export const UPI_PAYEE_RULES: Record<string, UpiPayeeRule> = {
  'CRED CLUB':                { debitAccount: 'CREDIT_CARD',         description: 'Credit card bill payment via CRED' },
  'ITHINK LOGISTIC':          { debitAccount: 'ADVANCES_GIVEN',      description: 'Logistics wallet top-up' },
  'GOOGLE INDIA DIGITAL':     { debitAccount: 'OPERATING_EXPENSES',  description: 'Google Ads', category: 'marketing' },
  'GOOGLE INDIA SERVICE':     { debitAccount: 'OPERATING_EXPENSES',  description: 'Google services', category: 'marketing' },
  'GOOGLE PLAY':              { debitAccount: 'OPERATING_EXPENSES',  description: 'Google Play subscription', category: 'marketing' },
  'ADOBE SYSTEMS':            { debitAccount: 'OPERATING_EXPENSES',  description: 'Adobe subscription', category: 'service' },
  'SHOPIFY COMMERCE':         { debitAccount: 'MARKETPLACE_FEES',    description: 'Shopify subscription' },
  'SHOPFLO':                  { debitAccount: 'MARKETPLACE_FEES',    description: 'Shopflo fee' },
  'KAISHAR KHAN':             { debitAccount: 'CASH',                description: 'Petty cash' },
  'SWAPNIL SURESH':           { debitAccount: 'OPERATING_EXPENSES',  description: 'PF deposit (statutory)', category: 'salary' },
  'PALLAVI  DESAI':           { debitAccount: 'OPERATING_EXPENSES',  description: 'Reimbursement' },
  'GIRISH AND COMPANY':       { debitAccount: 'FABRIC_INVENTORY',    description: 'Fabric purchase', category: 'fabric' },
  'PORTER':                   { debitAccount: 'OPERATING_EXPENSES',  description: 'Porter logistics', category: 'logistics' },
  'BLINKIT':                  { debitAccount: 'OPERATING_EXPENSES',  description: 'Office supplies' },
  'VIMAL ELECTRONICS':        { debitAccount: 'OPERATING_EXPENSES',  description: 'Office equipment', category: 'equipment' },
  'MAPUSA SERVICE':           { debitAccount: 'OPERATING_EXPENSES',  description: 'Vehicle/fuel' },
  'MANISHA SANJAY':           { debitAccount: 'OPERATING_EXPENSES',  description: 'Misc payment' },
  'MSSHREE SUNDHA':           { debitAccount: 'OPERATING_EXPENSES',  description: 'Courier/transport', category: 'logistics' },
  'RZPX PRIVATE':             { debitAccount: 'MARKETPLACE_FEES',    description: 'Razorpay charges' },
  'FRANCESCA DINA':           { debitAccount: 'OPERATING_EXPENSES',  description: 'Photoshoot styling', category: 'marketing' },
  'KISHOR TEXTILES':          { debitAccount: 'FABRIC_INVENTORY',    description: 'Fabric purchase', category: 'fabric' },
  'BILLDESKRELENERGY':        { debitAccount: 'OPERATING_EXPENSES',  description: 'Electricity bill' },
  'DILIP SOMSING':            { debitAccount: 'OPERATING_EXPENSES',  description: 'Unit rent (Jadhav)', category: 'rent' },
  'KIA MOTORS':               { debitAccount: 'OPERATING_EXPENSES',  description: 'Vehicle service' },
  'STUDIOBACKDROPS':          { debitAccount: 'OPERATING_EXPENSES',  description: 'Photography backdrops', category: 'marketing' },
  'SWIGGY':                   { debitAccount: 'OPERATING_EXPENSES',  description: 'Food/office supplies' },
  'SAYMA ELECTRICIAN':        { debitAccount: 'OPERATING_EXPENSES',  description: 'Unit electrician' },
};

// ============================================
// HDFC NARRATION PATTERNS
// ============================================

/**
 * Rules for categorizing HDFC transactions based on narration text.
 * Checked in order — first match wins. Use UPPERCASE for matching.
 *
 * 'match' is checked against the narration (case-insensitive).
 * 'skip' means this transaction is an inter-account transfer and should not be imported.
 */
export interface NarrationRule {
  /** String to look for in narration (uppercase) */
  match: string;
  /** Second string that must also be present (optional) */
  matchAlso?: string;
  /** Whether this applies to withdrawals, deposits, or both */
  direction: 'in' | 'out' | 'both';
  /** Skip this transaction (inter-account transfer) */
  skip?: boolean;
  /** Ledger account to debit */
  debitAccount?: string;
  /** Ledger account to credit */
  creditAccount?: string;
  /** Description for the ledger entry */
  description?: string;
  /** Finance category */
  category?: string;
}

export const HDFC_NARRATION_RULES: NarrationRule[] = [
  // ---- Inter-account transfers ----
  { match: 'CANOE DESIGN RAZORPAY RBL', direction: 'out', debitAccount: 'BANK_RAZORPAYX', creditAccount: 'BANK_HDFC', description: 'Transfer to RazorpayX' },
  { match: 'XXXXXXXX5105',              direction: 'out', debitAccount: 'BANK_RAZORPAYX', creditAccount: 'BANK_HDFC', description: 'Transfer to RazorpayX' },
  { match: '054105001906-CANOE DESIGN',  direction: 'both', skip: true, description: 'Transfer from ICICI account' },

  // ---- Incoming: Gateway & Marketplace settlements ----
  { match: 'RAZORPAY SOFTWARE', matchAlso: 'ESCROW', direction: 'in', debitAccount: 'BANK_HDFC', creditAccount: 'SALES_REVENUE', description: 'Razorpay settlement' },
  { match: 'PAYU PAYMENTS',              direction: 'in', debitAccount: 'BANK_HDFC', creditAccount: 'SALES_REVENUE', description: 'PayU settlement' },
  { match: 'RAZORPAY SOFTWARE', matchAlso: 'NODAL', direction: 'in', debitAccount: 'BANK_HDFC', creditAccount: 'SALES_REVENUE', description: 'Razorpay Nodal settlement' },
  { match: 'RAZORPAY PAYMENTS',          direction: 'in', debitAccount: 'BANK_HDFC', creditAccount: 'SALES_REVENUE', description: 'Razorpay Payments settlement' },
  { match: 'MYNTRA',                     direction: 'in', debitAccount: 'BANK_HDFC', creditAccount: 'SALES_REVENUE', description: 'Myntra settlement' },
  { match: 'NYKAA FASHION',              direction: 'in', debitAccount: 'BANK_HDFC', creditAccount: 'SALES_REVENUE', description: 'Nykaa settlement' },
  { match: 'ITHINK LOGISTIC',            direction: 'in', debitAccount: 'BANK_HDFC', creditAccount: 'SALES_REVENUE', description: 'iThink COD remittance' },
  { match: 'SHOPFLO',                    direction: 'in', debitAccount: 'BANK_HDFC', creditAccount: 'SALES_REVENUE', description: 'Shopflo settlement' },

  // ---- Incoming: Owner capital ----
  { match: 'ANIL GUPTA',                 direction: 'in', debitAccount: 'BANK_HDFC', creditAccount: 'OWNER_CAPITAL', description: 'Owner capital — Anil Gupta' },
  { match: 'SANTOSH DESAI',              direction: 'in', debitAccount: 'BANK_HDFC', creditAccount: 'OWNER_CAPITAL', description: 'Owner capital (loan) — Santosh Desai' },
  { match: 'SHANTUM  GUPTA',             direction: 'in', debitAccount: 'BANK_HDFC', creditAccount: 'OWNER_CAPITAL', description: 'Owner capital — Shantum Gupta' },
  { match: 'SHANTUM GUPTA',              direction: 'in', debitAccount: 'BANK_HDFC', creditAccount: 'OWNER_CAPITAL', description: 'Owner capital — Shantum Gupta' },
  { match: 'KAAVNI MULTIMELTS',          direction: 'in', debitAccount: 'BANK_HDFC', creditAccount: 'OWNER_CAPITAL', description: 'Owner capital (loan) — Kaavni Multimelts' },

  // ---- Incoming: B2B / Retail partners ----
  { match: 'AMALA EARTH',                direction: 'in', debitAccount: 'BANK_HDFC', creditAccount: 'SALES_REVENUE', description: 'Amala Earth (retail partner)' },
  { match: 'OGAAN RETAIL',               direction: 'in', debitAccount: 'BANK_HDFC', creditAccount: 'SALES_REVENUE', description: 'Ogaan Retail (retail partner)' },
  { match: 'PAYPAL PAYMENTS',            direction: 'in', debitAccount: 'BANK_HDFC', creditAccount: 'SALES_REVENUE', description: 'PayPal settlement' },

  // ---- Outgoing: Known categories ----
  { match: 'RAZORPAY PAYROLL',           direction: 'out', debitAccount: 'OPERATING_EXPENSES', creditAccount: 'BANK_HDFC', description: 'Salary: Payroll', category: 'salary' },
  { match: 'FACEBOOK INDIA',             direction: 'out', debitAccount: 'OPERATING_EXPENSES', creditAccount: 'BANK_HDFC', description: 'Facebook/Meta Ads', category: 'marketing' },
  { match: 'BILLDKPLAYSTOREGOOGL',       direction: 'out', debitAccount: 'OPERATING_EXPENSES', creditAccount: 'BANK_HDFC', description: 'Google Play Store', category: 'marketing' },
  { match: 'BILLDKGOOGLECLOUD',          direction: 'out', debitAccount: 'OPERATING_EXPENSES', creditAccount: 'BANK_HDFC', description: 'Google Cloud', category: 'service' },
  { match: 'BROWNTAPE',                  direction: 'out', debitAccount: 'OPERATING_EXPENSES', creditAccount: 'BANK_HDFC', description: 'BrownTape (software)', category: 'service' },
  { match: 'CBDT',                       direction: 'out', debitAccount: 'TDS_PAYABLE', creditAccount: 'BANK_HDFC', description: 'TDS deposit (CBDT)', category: 'statutory' },
  { match: 'COSME MATIAS MENEZES',       direction: 'out', debitAccount: 'ADVANCES_GIVEN', creditAccount: 'BANK_HDFC', description: 'Security deposit — retail store' },
  { match: 'ACTARTLYTEQA',               direction: 'out', debitAccount: 'LOAN_GETVANTAGE', creditAccount: 'BANK_HDFC', description: 'Razorpay ACH (GetVantage loan repayment)' },
  { match: 'PAYUCUSTOMEREXPL',           direction: 'out', debitAccount: 'OPERATING_EXPENSES', creditAccount: 'BANK_HDFC', description: 'PayU fees/refund (review needed)' },

  // ---- Outgoing: Cash ----
  { match: 'ATW-',                       direction: 'out', debitAccount: 'CASH', creditAccount: 'BANK_HDFC', description: 'ATM withdrawal' },
  { match: 'NWD-',                       direction: 'out', debitAccount: 'CASH', creditAccount: 'BANK_HDFC', description: 'Cash withdrawal' },

  // ---- Outgoing: Bank charges ----
  { match: 'SI ',                        direction: 'out', debitAccount: 'OPERATING_EXPENSES', creditAccount: 'BANK_HDFC', description: 'Bank standing instruction' },
];

// ============================================
// HELPERS
// ============================================

/** Look up a vendor rule by RazorpayX contact name. Falls back to tailor piecework or default. */
export function getVendorRule(contactName: string, purpose: string, noteDesc?: string | null): VendorRule {
  const rule = VENDOR_RULES[contactName];
  if (rule) {
    // If rule has a noteKeyword filter, check the payout notes
    if (rule.noteKeyword && rule.defaultDebitAccount) {
      const matches = noteDesc && noteDesc.toUpperCase().includes(rule.noteKeyword.toUpperCase());
      if (!matches) {
        return { ...rule, debitAccount: rule.defaultDebitAccount };
      }
    }
    return rule;
  }
  if (purpose === 'vendor bill' && TAILOR_NAMES.has(contactName)) {
    return { category: 'salary', debitAccount: 'OPERATING_EXPENSES', description: 'Production piecework' };
  }
  return { category: 'other', debitAccount: 'UNMATCHED_PAYMENTS' };
}

/** Look up a UPI payee rule by partial name match. Returns null if no match. */
export function getUpiPayeeRule(payeeName: string): UpiPayeeRule | null {
  const upper = payeeName.toUpperCase();
  for (const [key, rule] of Object.entries(UPI_PAYEE_RULES)) {
    if (upper.includes(key)) return rule;
  }
  return null;
}

/** Match an HDFC narration against the rules. Returns the first matching rule or null. */
export function matchNarrationRule(narration: string, isWithdrawal: boolean): NarrationRule | null {
  const n = narration.toUpperCase();
  const direction = isWithdrawal ? 'out' : 'in';

  for (const rule of HDFC_NARRATION_RULES) {
    if (rule.direction !== 'both' && rule.direction !== direction) continue;
    if (!n.includes(rule.match)) continue;
    if (rule.matchAlso && !n.includes(rule.matchAlso)) continue;
    return rule;
  }
  return null;
}
