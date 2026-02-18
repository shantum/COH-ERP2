/**
 * PayU Settlement API Type Definitions
 *
 * Strongly-typed interfaces for PayU Settlement Range API responses.
 * Endpoint: GET https://info.payu.in/settlement/range/
 */

// ============================================================================
// Per-Transaction Detail (inside a settlement)
// ============================================================================

export interface PayuTransaction {
    action: string;
    payuId: string;
    parentPayuId: string | null;
    requestId: string | null;
    transactionAmount: number;
    merchantServiceFee: number;
    merchantServiceTax: number;
    merchantNetAmount: number;
    sgst: number;
    cgst: number;
    igst: number;
    merchantTransactionId: string | null; // Your order reference
    mode: string;                         // CC, DC, NB, UPI, etc.
    paymentStatus: string;
    transactionDate: string;
    requestDate: string;
    requestedAmount: number;
    bankName: string;
    offerServiceFee: number;
    offerServiceTax: number;
    forexAmount: number;
    discount: number;
    additionalTdrFee: number;
    totalServiceTax: number;
    transactionCurrency: string;
    settlementCurrency: string;
    totalProcessingFee: number;
    additionalTdrTax: number;
}

// ============================================================================
// Settlement Record
// ============================================================================

export interface PayuSettlementRecord {
    settlementId: string;
    settlementCompletedDate: string;    // "2026-02-16 14:40:09"
    settlementAmount: string;           // "60698.25" — STRING, parse to Float
    merchantId: string | number;        // API returns number, coerce with String() before DB storage
    utrNumber: string;                  // UTR for bank matching (multiple settlements may share one UTR)
    transaction: PayuTransaction[];
}

// ============================================================================
// API Response Wrapper
// ============================================================================

export interface PayuSettlementResponse {
    status: number;     // 0 = success
    result: {
        page: number;
        size: number;
        totalCount: number;
        data: PayuSettlementRecord[];
    };
}
