/**
 * Apps Script for COH Orders Mastersheet
 *
 * Moves shipped orders from "Orders from COH" to "Outward (Live)"
 * so the ERP worker can ingest them.
 *
 * Trigger: Manual — run moveShippedToOutward() from menu or script editor.
 *
 * Logic:
 *   - Scans "Orders from COH" for rows where col X (Shipped) = TRUE and col AD (Outward Done) != 1
 *   - Copies entire row (A-AD) as-is to "Outward (Live)" — layouts are identical
 *   - Appends today's date in col AE (Outward Date)
 *   - Sets col AD (Outward Done) = 1 on the source row
 *
 * Column layout (shared by both tabs):
 *   A: Order Date, B: Order#, C: Name, D: City, E: Mob, F: Channel,
 *   G: SKU, H: Product Name, I: Qty, J: Status, K: Order Note, L: COH Note,
 *   M-P: (Qty Balance, Assigned, Picked, Order Age), Q: source_, R: samplingDate,
 *   S: Fabric Stock, T: (empty), U: Packed, V-W: (empty), X: Shipped,
 *   Y: Shopify Status, Z: Courier, AA: AWB, AB: Ready To Ship,
 *   AC: AWB Scan, AD: Outward Done, AE: Outward Date (appended on move)
 */

// Column indices in "Orders from COH" (0-based)
var SRC = {
  SKU: 6,           // G
  SHIPPED: 23,      // X
  OUTWARD_DONE: 29, // AD
};

// Total columns in Orders from COH (A-AD = 30)
var TOTAL_SRC_COLS = 30;

/**
 * Adds a custom menu to the spreadsheet.
 */
function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('COH Tools')
    .addItem('Move Shipped → Outward (Live)', 'moveShippedToOutward')
    .addToUi();
}

/**
 * Main function: moves shipped orders to Outward (Live).
 * 1:1 copy of entire row (A-AD) + Outward Date at AE.
 */
function moveShippedToOutward() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var srcSheet = ss.getSheetByName('Orders from COH');
  var dstSheet = ss.getSheetByName('Outward (Live)');

  if (!srcSheet || !dstSheet) {
    SpreadsheetApp.getUi().alert('Error: Could not find "Orders from COH" or "Outward (Live)" tab.');
    return;
  }

  var srcData = srcSheet.getDataRange().getValues();
  var today = new Date();
  var todayStr = Utilities.formatDate(today, 'Asia/Kolkata', 'dd/MM/yyyy');

  var rowsToMove = [];
  var srcRowIndices = []; // 1-based row numbers in source sheet

  // Skip header row (index 0)
  for (var i = 1; i < srcData.length; i++) {
    var row = srcData[i];
    var shipped = row[SRC.SHIPPED];
    var outwardDone = row[SRC.OUTWARD_DONE];
    var sku = row[SRC.SKU];

    // Shipped = TRUE (checkbox) and not already processed, has SKU
    if (shipped === true && outwardDone != 1 && sku) {
      // Copy all 30 columns (A-AD) as-is, pad if shorter
      var outwardRow = [];
      for (var c = 0; c < TOTAL_SRC_COLS; c++) {
        outwardRow.push(row[c] !== undefined ? row[c] : '');
      }
      // Append Outward Date at col AE (index 30)
      outwardRow.push(todayStr);

      rowsToMove.push(outwardRow);
      srcRowIndices.push(i + 1); // 1-based for sheet operations
    }
  }

  if (rowsToMove.length === 0) {
    SpreadsheetApp.getUi().alert('No new shipped orders to move.');
    return;
  }

  // Find first empty row in Outward (Live) — skip row 1 (header)
  var dstLastRow = dstSheet.getLastRow();
  var appendRow = Math.max(dstLastRow + 1, 2); // At least row 2

  // Write all rows at once — A through AE (31 columns)
  dstSheet.getRange(appendRow, 1, rowsToMove.length, 31).setValues(rowsToMove);

  // Mark source rows as processed (col AD = 1)
  for (var j = 0; j < srcRowIndices.length; j++) {
    srcSheet.getRange(srcRowIndices[j], SRC.OUTWARD_DONE + 1).setValue(1);
  }

  // Show result
  SpreadsheetApp.getActive().toast(
    rowsToMove.length + ' shipped order(s) moved to Outward (Live).',
    'Outward Done',
    5
  );
}
