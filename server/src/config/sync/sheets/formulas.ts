/**
 * Google Sheets formula constants and template functions for balance calculations.
 */

import { ORDERS_MASTERSHEET_ID } from './spreadsheets.js';

// ============================================
// ROLLBACK — ORIGINAL FORMULA
// ============================================

/**
 * Original Balance (Final) formula before ERP offload.
 * Saved here so it can be restored if offload is rolled back.
 *
 * Row 3 example (adjust row as needed):
 * =SUMIF('Inward (Final)'!$A:$A,$A3,'Inward (Final)'!$B:$B)
 *  +SUMIF('Inward (Archive)'!$A:$A,$A3,'Inward (Archive)'!$B:$B)
 *  -SUMIF(Outward!$A:$A,$A3,Outward!$B:$B)
 *  -SUMIF('Orders Outward'!$A:$A,$A3,'Orders Outward'!$B:$B)
 *  -SUMIF('Orders Outward 12728-41874'!$N:$N,$A3,'Orders Outward 12728-41874'!$O:$O)
 */
export const ORIGINAL_BALANCE_FORMULA = `=SUMIF('Inward (Final)'!$A:$A,$A3,'Inward (Final)'!$B:$B)+SUMIF('Inward (Archive)'!$A:$A,$A3,'Inward (Archive)'!$B:$B)-SUMIF(Outward!$A:$A,$A3,Outward!$B:$B)-SUMIF('Orders Outward'!$A:$A,$A3,'Orders Outward'!$B:$B)-SUMIF('Orders Outward 12728-41874'!$N:$N,$A3,'Orders Outward 12728-41874'!$O:$O)`;

/**
 * Phase 2 formula — used ERP Past Balance + remaining active sheet tabs.
 * Kept for reference / rollback to Phase 2 state.
 */
export const PHASE2_BALANCE_FORMULA = `=F3+SUMIF('Inward (Final)'!$A:$A,$A3,'Inward (Final)'!$B:$B)-SUMIF(Outward!$A:$A,$A3,Outward!$B:$B)-SUMIF('Orders Outward'!$A:$A,$A3,'Orders Outward'!$B:$B)`;

/**
 * Phase 3 formula — ERP currentBalance (col F) + pending buffer entries.
 * Col F is written by the worker after each ingestion cycle.
 * Live tabs are in COH Orders Mastersheet (IMPORTRANGE or same-sheet reference).
 *
 * NOTE: Live tabs are in the COH Orders Mastersheet, so Balance (Final) in Office Ledger
 * needs IMPORTRANGE. The formula uses the Mastersheet ID for cross-sheet references.
 *
 * Outward (Live) layout matches Orders from COH (A-AD) + AE=Outward Date.
 * SKU is in col G (not A), Qty is in col I (not B) — hence $G:$G and $I:$I.
 */
export const LIVE_BALANCE_FORMULA_TEMPLATE = (row: number) =>
    `=F${row}+IFERROR(SUMIF(IMPORTRANGE("${ORDERS_MASTERSHEET_ID}","'Inward (Live)'!$A:$A"),$A${row},IMPORTRANGE("${ORDERS_MASTERSHEET_ID}","'Inward (Live)'!$B:$B")),0)-IFERROR(SUMIF(IMPORTRANGE("${ORDERS_MASTERSHEET_ID}","'Outward (Live)'!$G:$G"),$A${row},IMPORTRANGE("${ORDERS_MASTERSHEET_ID}","'Outward (Live)'!$I:$I")),0)`;

/**
 * V2 Inventory balance formula — Mastersheet Inventory col C.
 * Uses SUMIFS with "<>DONE:*" to exclude ingested rows from live buffer counts.
 * Same spreadsheet (no IMPORTRANGE needed).
 */
export const INVENTORY_BALANCE_FORMULA_TEMPLATE = (row: number) =>
    `=R${row}+SUMIFS('Inward (Live)'!$B:$B,'Inward (Live)'!$A:$A,$A${row},'Inward (Live)'!$J:$J,"<>DONE:*")-SUMIFS('Outward (Live)'!$I:$I,'Outward (Live)'!$G:$G,$A${row},'Outward (Live)'!$AG:$AG,"<>DONE:*")`;

/**
 * V2 Balance (Final) formula — Office Ledger col E.
 * Uses SUMIFS with IMPORTRANGE + "<>DONE:*" to exclude ingested rows.
 * "id" placeholder is replaced with the Mastersheet ID at runtime.
 */
export const LIVE_BALANCE_FORMULA_V2_TEMPLATE = (row: number) =>
    `=F${row}+IFERROR(SUMIFS(IMPORTRANGE("${ORDERS_MASTERSHEET_ID}","'Inward (Live)'!$B:$B"),IMPORTRANGE("${ORDERS_MASTERSHEET_ID}","'Inward (Live)'!$A:$A"),$A${row},IMPORTRANGE("${ORDERS_MASTERSHEET_ID}","'Inward (Live)'!$J:$J"),"<>DONE:*"),0)-IFERROR(SUMIFS(IMPORTRANGE("${ORDERS_MASTERSHEET_ID}","'Outward (Live)'!$I:$I"),IMPORTRANGE("${ORDERS_MASTERSHEET_ID}","'Outward (Live)'!$G:$G"),$A${row},IMPORTRANGE("${ORDERS_MASTERSHEET_ID}","'Outward (Live)'!$AG:$AG"),"<>DONE:*"),0)`;
