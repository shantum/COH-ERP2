/**
 * Credit Card Transaction Data
 *
 * Hardcoded CC transactions extracted from PDF statements.
 * Moved here from import-cc-charges.ts for reuse by Bank Import V2.
 */

interface CCTransaction {
  date: string;
  description: string;
  amount: number;
  type: 'debit' | 'credit';
  card: 'hdfc' | 'icici';
  source: string;
}

// ============================================
// HDFC PDF TRANSACTIONS (manually extracted)
// ============================================

export const hdfcPdfTransactions: CCTransaction[] = [
  // === Jan 2025 billing (18 Dec '24 - 17 Jan '25) ===
  { date: '2024-12-16', description: 'Adobe ADOBE.LY/E', amount: 4600.00, type: 'debit', card: 'hdfc', source: 'pdf_jan2025' },
  { date: '2024-12-17', description: 'IGST on Finance Charges (Dec)', amount: 4737.00, type: 'debit', card: 'hdfc', source: 'pdf_jan2025' },
  { date: '2024-12-31', description: 'RAZ*IThink Logistic Quick Mumbai', amount: 10320.96, type: 'debit', card: 'hdfc', source: 'pdf_jan2025' },
  { date: '2025-01-04', description: 'GOOGLE WORKSPACE MUMBAI', amount: 13110.37, type: 'debit', card: 'hdfc', source: 'pdf_jan2025' },
  { date: '2025-01-05', description: 'Adobe Systems Software I Bangalore', amount: 1420.00, type: 'debit', card: 'hdfc', source: 'pdf_jan2025' },
  { date: '2025-01-05', description: 'MICROSOFT INDIA CYBS SI MUMBAI', amount: 852.11, type: 'debit', card: 'hdfc', source: 'pdf_jan2025' },
  { date: '2025-01-05', description: 'MICROSOFT INDIA CYBS SI MUMBAI (2)', amount: 4499.13, type: 'debit', card: 'hdfc', source: 'pdf_jan2025' },
  { date: '2025-01-06', description: 'Adobe Systems Software I Bangalore', amount: 1834.90, type: 'debit', card: 'hdfc', source: 'pdf_jan2025' },
  { date: '2025-01-06', description: 'RAZ*IThink Logistic Quick Mumbai', amount: 5160.48, type: 'debit', card: 'hdfc', source: 'pdf_jan2025' },
  { date: '2025-01-07', description: 'RAZ*IThink Logistic Quick Mumbai', amount: 10320.96, type: 'debit', card: 'hdfc', source: 'pdf_jan2025' },
  { date: '2025-01-10', description: 'Adobe ADOBE.LY/E', amount: 4600.00, type: 'debit', card: 'hdfc', source: 'pdf_jan2025' },
  { date: '2025-01-10', description: 'RAZ*IThink Logistic Quick Mumbai', amount: 5160.48, type: 'debit', card: 'hdfc', source: 'pdf_jan2025' },
  { date: '2025-01-11', description: '1% DCC Transaction Fee', amount: 46.00, type: 'debit', card: 'hdfc', source: 'pdf_jan2025' },
  { date: '2025-01-11', description: 'IGST on DCC Fee', amount: 8.28, type: 'debit', card: 'hdfc', source: 'pdf_jan2025' },
  { date: '2025-01-16', description: 'WATI.IO TSIM SHA T', amount: 5999.00, type: 'debit', card: 'hdfc', source: 'pdf_jan2025' },
  { date: '2025-01-17', description: 'FINANCE CHARGES (Jan)', amount: 27361.30, type: 'debit', card: 'hdfc', source: 'pdf_jan2025' },

  // === Feb 2025 billing (18 Jan - 17 Feb '25) ===
  { date: '2025-01-17', description: 'IGST on Finance Charges (Jan)', amount: 4925.03, type: 'debit', card: 'hdfc', source: 'pdf_feb2025' },
  { date: '2025-01-18', description: 'IGST on DCC Fee', amount: 10.80, type: 'debit', card: 'hdfc', source: 'pdf_feb2025' },
  { date: '2025-01-18', description: '1% DCC Transaction Fee', amount: 59.99, type: 'debit', card: 'hdfc', source: 'pdf_feb2025' },
  { date: '2025-01-24', description: 'SLACK T0399SE875F DUBLIN', amount: 883.19, type: 'debit', card: 'hdfc', source: 'pdf_feb2025' },
  { date: '2025-01-25', description: 'IGST on DCC', amount: 1.59, type: 'debit', card: 'hdfc', source: 'pdf_feb2025' },
  { date: '2025-01-25', description: 'RAZ*IThink Logistic Quick Mumbai', amount: 5160.48, type: 'debit', card: 'hdfc', source: 'pdf_feb2025' },
  { date: '2025-01-25', description: '1% DCC Transaction Fee', amount: 8.83, type: 'debit', card: 'hdfc', source: 'pdf_feb2025' },
  { date: '2025-01-27', description: 'Adobe Systems Software I Bangalore', amount: 1420.00, type: 'debit', card: 'hdfc', source: 'pdf_feb2025' },
  { date: '2025-01-27', description: 'RAZ*IThink Logistic Quick Mumbai', amount: 5160.48, type: 'debit', card: 'hdfc', source: 'pdf_feb2025' },
  { date: '2025-01-29', description: 'RAZ*IThink Logistic Quick Mumbai', amount: 5160.48, type: 'debit', card: 'hdfc', source: 'pdf_feb2025' },
  { date: '2025-01-31', description: 'RAZ*IThink Logistic Quick Mumbai', amount: 5160.48, type: 'debit', card: 'hdfc', source: 'pdf_feb2025' },
  { date: '2025-01-31', description: 'IGST on charges', amount: 16.74, type: 'debit', card: 'hdfc', source: 'pdf_feb2025' },
  { date: '2025-01-30', description: 'BACKBLAZE INC (intl)', amount: 2657.15, type: 'debit', card: 'hdfc', source: 'pdf_feb2025' },
  { date: '2025-02-02', description: 'MICROSOFT INDIA CYBS SI MUMBAI', amount: 852.11, type: 'debit', card: 'hdfc', source: 'pdf_feb2025' },
  { date: '2025-02-06', description: 'Adobe Systems Software I Bangalore', amount: 1834.90, type: 'debit', card: 'hdfc', source: 'pdf_feb2025' },
  { date: '2025-02-06', description: 'RAZ*IThink Logistic Quick Mumbai', amount: 10320.96, type: 'debit', card: 'hdfc', source: 'pdf_feb2025' },
  { date: '2025-02-07', description: 'GOOGLE PLAY MUMBAI', amount: 1950.00, type: 'debit', card: 'hdfc', source: 'pdf_feb2025' },
  { date: '2025-02-08', description: 'MICROSOFT INDIA CYBS SI MUMBAI', amount: 4499.13, type: 'debit', card: 'hdfc', source: 'pdf_feb2025' },
  { date: '2025-02-10', description: 'Adobe ADOBE.LY/E', amount: 4600.00, type: 'debit', card: 'hdfc', source: 'pdf_feb2025' },
  { date: '2025-02-11', description: '1% DCC Transaction Fee', amount: 46.00, type: 'debit', card: 'hdfc', source: 'pdf_feb2025' },
  { date: '2025-02-11', description: 'IGST on DCC Fee', amount: 8.28, type: 'debit', card: 'hdfc', source: 'pdf_feb2025' },
  { date: '2025-02-13', description: 'PAYPAL *REANONYMOUS TO', amount: 913.55, type: 'debit', card: 'hdfc', source: 'pdf_feb2025' },
  { date: '2025-02-13', description: 'SHOPFLO TECHNOLOGIES PRIV SouthWestD', amount: 23200.00, type: 'debit', card: 'hdfc', source: 'pdf_feb2025' },
  { date: '2025-02-13', description: 'RAZ*IThink Logistic Quick Mumbai', amount: 5160.48, type: 'debit', card: 'hdfc', source: 'pdf_feb2025' },
  { date: '2025-02-13', description: 'REAL DEBRID LEVALLOIS (intl EUR 4)', amount: 362.68, type: 'debit', card: 'hdfc', source: 'pdf_feb2025' },
  { date: '2025-02-13', description: 'REAL DEBRID LEVALLOIS (intl EUR 3)', amount: 272.01, type: 'debit', card: 'hdfc', source: 'pdf_feb2025' },
  { date: '2025-02-15', description: 'RAZ*IThink Logistic Quick Mumbai', amount: 5160.48, type: 'debit', card: 'hdfc', source: 'pdf_feb2025' },
  { date: '2025-02-17', description: '1% DCC Transaction Fee', amount: 9.14, type: 'debit', card: 'hdfc', source: 'pdf_feb2025' },
  { date: '2025-02-17', description: 'CONSOLIDATED FCY MARKUP FEE', amount: 93.00, type: 'debit', card: 'hdfc', source: 'pdf_feb2025' },
  { date: '2025-02-17', description: 'FINANCE CHARGES (Feb)', amount: 27025.12, type: 'debit', card: 'hdfc', source: 'pdf_feb2025' },

  // === Mar 2025 billing (18 Feb - 17 Mar '25) ===
  { date: '2025-02-17', description: 'IGST on Finance Charges (Feb)', amount: 4864.52, type: 'debit', card: 'hdfc', source: 'pdf_mar2025' },
  { date: '2025-02-17', description: 'IGST on DCC Fee', amount: 1.65, type: 'debit', card: 'hdfc', source: 'pdf_mar2025' },
  { date: '2025-02-18', description: 'IGST on FCY Markup', amount: 1.71, type: 'debit', card: 'hdfc', source: 'pdf_mar2025' },
  { date: '2025-02-18', description: 'IGST on charges', amount: 2.28, type: 'debit', card: 'hdfc', source: 'pdf_mar2025' },
  { date: '2025-02-24', description: 'RAZ*IThink Logistic Quick Mumbai', amount: 10320.96, type: 'debit', card: 'hdfc', source: 'pdf_mar2025' },
  { date: '2025-02-27', description: 'Adobe Systems Software I Bangalore', amount: 1420.00, type: 'debit', card: 'hdfc', source: 'pdf_mar2025' },
  { date: '2025-03-01', description: 'WATI.IO TSIM SHA T', amount: 5999.00, type: 'debit', card: 'hdfc', source: 'pdf_mar2025' },
  { date: '2025-03-02', description: 'IGST on DCC', amount: 10.80, type: 'debit', card: 'hdfc', source: 'pdf_mar2025' },
  { date: '2025-03-02', description: '1% DCC Transaction Fee', amount: 59.99, type: 'debit', card: 'hdfc', source: 'pdf_mar2025' },
  { date: '2025-03-02', description: 'IGST on charges', amount: 8.32, type: 'debit', card: 'hdfc', source: 'pdf_mar2025' },
  { date: '2025-03-05', description: 'MICROSOFT INDIA CYBS SI MUMBAI', amount: 852.11, type: 'debit', card: 'hdfc', source: 'pdf_mar2025' },
  { date: '2025-03-01', description: 'BACKBLAZE INC (intl)', amount: 1320.79, type: 'debit', card: 'hdfc', source: 'pdf_mar2025' },
  { date: '2025-03-15', description: 'RAZ*IThink Logistic Quick Mumbai', amount: 10320.96, type: 'debit', card: 'hdfc', source: 'pdf_mar2025' },
  { date: '2025-03-15', description: 'SHOPFLO TECHNOLOGIES PRIV SouthWestD', amount: 23200.00, type: 'debit', card: 'hdfc', source: 'pdf_mar2025' },
  { date: '2025-03-16', description: 'Adobe Systems Software I Bangalore', amount: 1834.90, type: 'debit', card: 'hdfc', source: 'pdf_mar2025' },
  { date: '2025-03-17', description: 'FINANCE CHARGES (Mar)', amount: 24510.27, type: 'debit', card: 'hdfc', source: 'pdf_mar2025' },
  { date: '2025-03-17', description: 'CONSOLIDATED FCY MARKUP FEE', amount: 68.44, type: 'debit', card: 'hdfc', source: 'pdf_mar2025' },

  // === Oct 2025 billing (18 Sep - 17 Oct '25) ===
  { date: '2025-09-17', description: 'IGST on Finance Charges (Sep)', amount: 4910.56, type: 'debit', card: 'hdfc', source: 'pdf_oct2025' },
  { date: '2025-09-22', description: 'Adobe Systems Software I Bangalore', amount: 1834.90, type: 'debit', card: 'hdfc', source: 'pdf_oct2025' },
  { date: '2025-09-23', description: 'IGST on charges', amount: 2.51, type: 'debit', card: 'hdfc', source: 'pdf_oct2025' },
  { date: '2025-09-23', description: 'SHOPFLO SOUTH WEST', amount: 23200.00, type: 'debit', card: 'hdfc', source: 'pdf_oct2025' },
  { date: '2025-09-23', description: 'DP* DODOPAY (intl)', amount: 397.59, type: 'debit', card: 'hdfc', source: 'pdf_oct2025' },
  { date: '2025-09-27', description: 'GODADDY INDIA DOMAIN MUMBAI', amount: 1060.82, type: 'debit', card: 'hdfc', source: 'pdf_oct2025' },
  { date: '2025-09-27', description: 'Adobe Systems Software I Bangalore', amount: 1555.00, type: 'debit', card: 'hdfc', source: 'pdf_oct2025' },
  { date: '2025-09-27', description: 'OPENAI *CHATGPT SUBSCR', amount: 399.00, type: 'debit', card: 'hdfc', source: 'pdf_oct2025' },
  { date: '2025-09-29', description: 'Adobe ADOBE.LY/E', amount: 4600.00, type: 'debit', card: 'hdfc', source: 'pdf_oct2025' },
  { date: '2025-09-29', description: '1% DCC Transaction Fee', amount: 3.99, type: 'debit', card: 'hdfc', source: 'pdf_oct2025' },
  { date: '2025-09-29', description: 'IGST on DCC', amount: 0.72, type: 'debit', card: 'hdfc', source: 'pdf_oct2025' },
  { date: '2025-09-30', description: '1% DCC Transaction Fee', amount: 46.00, type: 'debit', card: 'hdfc', source: 'pdf_oct2025' },
  { date: '2025-09-30', description: 'IGST on DCC', amount: 8.28, type: 'debit', card: 'hdfc', source: 'pdf_oct2025' },
  { date: '2025-09-30', description: 'BACKBLAZE INC (intl)', amount: 1543.50, type: 'debit', card: 'hdfc', source: 'pdf_oct2025' },
  { date: '2025-10-01', description: 'IGST on charges', amount: 9.72, type: 'debit', card: 'hdfc', source: 'pdf_oct2025' },
  { date: '2025-10-01', description: 'CANVA CANVA.COM', amount: 500.00, type: 'debit', card: 'hdfc', source: 'pdf_oct2025' },
  { date: '2025-10-01', description: 'WATI.IO TSIM SHA T', amount: 5999.00, type: 'debit', card: 'hdfc', source: 'pdf_oct2025' },
  { date: '2025-10-02', description: 'MICROSOFT INDIA CYBS SI MUMBAI', amount: 852.11, type: 'debit', card: 'hdfc', source: 'pdf_oct2025' },
  { date: '2025-10-03', description: '1% DCC Transaction Fee', amount: 64.99, type: 'debit', card: 'hdfc', source: 'pdf_oct2025' },
  { date: '2025-10-03', description: 'IGST on DCC', amount: 11.70, type: 'debit', card: 'hdfc', source: 'pdf_oct2025' },
  { date: '2025-10-04', description: 'X CORP. PAID FEATURES', amount: 427.00, type: 'debit', card: 'hdfc', source: 'pdf_oct2025' },
  { date: '2025-10-06', description: '1% DCC Transaction Fee', amount: 4.27, type: 'debit', card: 'hdfc', source: 'pdf_oct2025' },
  { date: '2025-10-06', description: 'IGST on DCC', amount: 0.77, type: 'debit', card: 'hdfc', source: 'pdf_oct2025' },
  { date: '2025-10-13', description: 'CLAUDE.AI SUBSCRIPTION (intl)', amount: 2096.42, type: 'debit', card: 'hdfc', source: 'pdf_oct2025' },
  { date: '2025-10-13', description: 'REPLICATE (intl)', amount: 888.31, type: 'debit', card: 'hdfc', source: 'pdf_oct2025' },
  { date: '2025-10-13', description: 'OPENART AI (intl)', amount: 1243.64, type: 'debit', card: 'hdfc', source: 'pdf_oct2025' },
  { date: '2025-10-14', description: 'IGST on charges', amount: 13.21, type: 'debit', card: 'hdfc', source: 'pdf_oct2025' },
  { date: '2025-10-14', description: 'IGST on charges (2)', amount: 5.60, type: 'debit', card: 'hdfc', source: 'pdf_oct2025' },
  { date: '2025-10-14', description: 'IGST on charges (3)', amount: 7.84, type: 'debit', card: 'hdfc', source: 'pdf_oct2025' },
  { date: '2025-10-17', description: 'FINANCE CHARGES (Oct)', amount: 26223.74, type: 'debit', card: 'hdfc', source: 'pdf_oct2025' },
  { date: '2025-10-17', description: 'CONSOLIDATED FCY MARKUP FEE', amount: 215.93, type: 'debit', card: 'hdfc', source: 'pdf_oct2025' },

  // === Nov 2025 billing (18 Oct - 17 Nov '25) ===
  { date: '2025-10-17', description: 'IGST on Finance Charges (Oct)', amount: 4720.27, type: 'debit', card: 'hdfc', source: 'pdf_nov2025' },
  { date: '2025-10-23', description: 'SHOPFLO SOUTH WEST', amount: 23606.00, type: 'debit', card: 'hdfc', source: 'pdf_nov2025' },
  { date: '2025-10-24', description: 'DP* DODOPAY (intl)', amount: 395.85, type: 'debit', card: 'hdfc', source: 'pdf_nov2025' },
  { date: '2025-10-25', description: 'IGST on charges', amount: 2.49, type: 'debit', card: 'hdfc', source: 'pdf_nov2025' },
  { date: '2025-10-26', description: 'Adobe Systems Software I Bangalore', amount: 1834.90, type: 'debit', card: 'hdfc', source: 'pdf_nov2025' },
  { date: '2025-10-27', description: 'OPENAI *CHATGPT SUBSCR', amount: 399.00, type: 'debit', card: 'hdfc', source: 'pdf_nov2025' },
  { date: '2025-10-29', description: '1% DCC Transaction Fee', amount: 3.99, type: 'debit', card: 'hdfc', source: 'pdf_nov2025' },
  { date: '2025-10-29', description: 'IGST on DCC', amount: 0.72, type: 'debit', card: 'hdfc', source: 'pdf_nov2025' },
  { date: '2025-11-11', description: 'Adobe ADOBE.LY/E', amount: 5277.00, type: 'debit', card: 'hdfc', source: 'pdf_nov2025' },
  { date: '2025-11-11', description: 'MICROSOFT INDIA CYBS SI MUMBAI', amount: 852.11, type: 'debit', card: 'hdfc', source: 'pdf_nov2025' },
  { date: '2025-11-12', description: 'CANVA CANVA.COM', amount: 500.00, type: 'debit', card: 'hdfc', source: 'pdf_nov2025' },
  { date: '2025-11-12', description: '1% DCC Transaction Fee', amount: 52.77, type: 'debit', card: 'hdfc', source: 'pdf_nov2025' },
  { date: '2025-11-12', description: 'IGST on DCC', amount: 9.50, type: 'debit', card: 'hdfc', source: 'pdf_nov2025' },
  { date: '2025-11-12', description: 'Adobe Systems Software I Bangalore', amount: 1834.90, type: 'debit', card: 'hdfc', source: 'pdf_nov2025' },
  { date: '2025-11-13', description: 'WATI.IO TSIM SHA T', amount: 5999.00, type: 'debit', card: 'hdfc', source: 'pdf_nov2025' },
  { date: '2025-11-13', description: '1% DCC Transaction Fee', amount: 5.00, type: 'debit', card: 'hdfc', source: 'pdf_nov2025' },
  { date: '2025-11-13', description: 'IGST on DCC', amount: 0.90, type: 'debit', card: 'hdfc', source: 'pdf_nov2025' },
  { date: '2025-11-14', description: '1% DCC Transaction Fee', amount: 59.99, type: 'debit', card: 'hdfc', source: 'pdf_nov2025' },
  { date: '2025-11-14', description: 'IGST on DCC', amount: 10.80, type: 'debit', card: 'hdfc', source: 'pdf_nov2025' },
  { date: '2025-11-14', description: 'ELEVENLABS.IO', amount: 1142.24, type: 'debit', card: 'hdfc', source: 'pdf_nov2025' },
  { date: '2025-11-14', description: 'SUNO INC SUNO.COM', amount: 850.00, type: 'debit', card: 'hdfc', source: 'pdf_nov2025' },
  { date: '2025-11-14', description: 'OPENART AI (intl)', amount: 1242.29, type: 'debit', card: 'hdfc', source: 'pdf_nov2025' },
  { date: '2025-11-15', description: 'IGST on charges', amount: 7.83, type: 'debit', card: 'hdfc', source: 'pdf_nov2025' },
  { date: '2025-11-16', description: 'Adobe Systems Software I Bangalore', amount: 1555.00, type: 'debit', card: 'hdfc', source: 'pdf_nov2025' },
  { date: '2025-11-17', description: '1% DCC Transaction Fee', amount: 19.92, type: 'debit', card: 'hdfc', source: 'pdf_nov2025' },
  { date: '2025-11-17', description: 'FINANCE CHARGES (Nov)', amount: 27231.35, type: 'debit', card: 'hdfc', source: 'pdf_nov2025' },
  { date: '2025-11-17', description: 'CONSOLIDATED FCY MARKUP FEE', amount: 57.33, type: 'debit', card: 'hdfc', source: 'pdf_nov2025' },

  // === Dec 2025 billing (18 Nov - 17 Dec '25) ===
  { date: '2025-11-17', description: 'IGST on DCC', amount: 3.59, type: 'debit', card: 'hdfc', source: 'pdf_dec2025' },
  { date: '2025-11-17', description: 'IGST on Finance Charges (Nov)', amount: 4901.64, type: 'debit', card: 'hdfc', source: 'pdf_dec2025' },
  { date: '2025-11-28', description: 'Adobe Systems Software I Bangalore', amount: 1555.00, type: 'debit', card: 'hdfc', source: 'pdf_dec2025' },
  { date: '2025-11-29', description: 'WATI.IO TSIM SHA T', amount: 5999.00, type: 'debit', card: 'hdfc', source: 'pdf_dec2025' },
  { date: '2025-11-30', description: '1% DCC Transaction Fee', amount: 59.99, type: 'debit', card: 'hdfc', source: 'pdf_dec2025' },
  { date: '2025-11-30', description: 'IGST on DCC', amount: 10.80, type: 'debit', card: 'hdfc', source: 'pdf_dec2025' },
  { date: '2025-12-01', description: 'CANVA CANVA.COM', amount: 500.00, type: 'debit', card: 'hdfc', source: 'pdf_dec2025' },
  { date: '2025-12-02', description: 'MICROSOFT INDIA CYBS SI MUMBAI', amount: 852.11, type: 'debit', card: 'hdfc', source: 'pdf_dec2025' },
  { date: '2025-12-03', description: '1% DCC Transaction Fee', amount: 5.00, type: 'debit', card: 'hdfc', source: 'pdf_dec2025' },
  { date: '2025-12-03', description: 'IGST on DCC', amount: 0.90, type: 'debit', card: 'hdfc', source: 'pdf_dec2025' },
  { date: '2025-12-06', description: 'Adobe Systems Software I Bangalore', amount: 1834.90, type: 'debit', card: 'hdfc', source: 'pdf_dec2025' },
  { date: '2025-12-14', description: 'BACKBLAZE INC (intl)', amount: 3142.23, type: 'debit', card: 'hdfc', source: 'pdf_dec2025' },
  { date: '2025-12-15', description: 'IGST on charges', amount: 19.80, type: 'debit', card: 'hdfc', source: 'pdf_dec2025' },
  { date: '2025-12-17', description: 'FINANCE CHARGES (Dec)', amount: 26373.86, type: 'debit', card: 'hdfc', source: 'pdf_dec2025' },
  { date: '2025-12-17', description: 'CONSOLIDATED FCY MARKUP FEE', amount: 109.98, type: 'debit', card: 'hdfc', source: 'pdf_dec2025' },

  // === Jan 2026 billing (18 Dec '25 - 17 Jan '26) ===
  { date: '2025-12-17', description: 'IGST on Finance Charges (Dec)', amount: 4747.29, type: 'debit', card: 'hdfc', source: 'pdf_jan2026' },
  { date: '2025-12-22', description: 'SUNO INC SUNO.COM', amount: 850.00, type: 'debit', card: 'hdfc', source: 'pdf_jan2026' },
  { date: '2025-12-23', description: 'Adobe ADOBE.LY/E', amount: 5277.00, type: 'debit', card: 'hdfc', source: 'pdf_jan2026' },
  { date: '2025-12-23', description: '1% DCC Transaction Fee', amount: 8.50, type: 'debit', card: 'hdfc', source: 'pdf_jan2026' },
  { date: '2025-12-23', description: 'IGST on DCC', amount: 1.53, type: 'debit', card: 'hdfc', source: 'pdf_jan2026' },
  { date: '2025-12-24', description: '1% DCC Transaction Fee', amount: 52.77, type: 'debit', card: 'hdfc', source: 'pdf_jan2026' },
  { date: '2025-12-24', description: 'IGST on DCC', amount: 9.50, type: 'debit', card: 'hdfc', source: 'pdf_jan2026' },
  { date: '2025-12-27', description: 'Adobe Systems Software I Bangalore', amount: 1555.00, type: 'debit', card: 'hdfc', source: 'pdf_jan2026' },
  { date: '2025-12-30', description: 'BACKBLAZE INC (intl)', amount: 739.78, type: 'debit', card: 'hdfc', source: 'pdf_jan2026' },
  { date: '2025-12-31', description: 'CANVA CANVA.COM', amount: 500.00, type: 'debit', card: 'hdfc', source: 'pdf_jan2026' },
  { date: '2025-12-31', description: 'IGST on charges', amount: 4.66, type: 'debit', card: 'hdfc', source: 'pdf_jan2026' },
  { date: '2025-12-31', description: 'IGST on charges (2)', amount: 2.27, type: 'debit', card: 'hdfc', source: 'pdf_jan2026' },
  { date: '2025-12-31', description: 'IGST on charges (3)', amount: 56.40, type: 'debit', card: 'hdfc', source: 'pdf_jan2026' },
  { date: '2025-12-31', description: 'GITHUB INC (intl)', amount: 360.21, type: 'debit', card: 'hdfc', source: 'pdf_jan2026' },
  { date: '2025-12-31', description: 'CLAUDE.AI SUBSCRIPTION ANTHROPIC (intl)', amount: 8952.97, type: 'debit', card: 'hdfc', source: 'pdf_jan2026' },
  { date: '2026-01-01', description: '1% DCC Transaction Fee', amount: 5.00, type: 'debit', card: 'hdfc', source: 'pdf_jan2026' },
  { date: '2026-01-01', description: 'IGST on DCC', amount: 0.90, type: 'debit', card: 'hdfc', source: 'pdf_jan2026' },
  { date: '2026-01-17', description: 'FINANCE CHARGES (Jan 2026)', amount: 26871.89, type: 'debit', card: 'hdfc', source: 'pdf_jan2026' },
  { date: '2026-01-17', description: 'CONSOLIDATED FCY MARKUP FEE', amount: 351.85, type: 'debit', card: 'hdfc', source: 'pdf_jan2026' },
];

// ============================================
// ICICI PDF TRANSACTIONS (from agent analysis)
// ============================================

export const iciciPdfTransactions: CCTransaction[] = [
  // === Mar 2025 (stmt17) ===
  { date: '2025-03-01', description: 'RAZ*IThink Logistic Quick Mumbai (5x10K)', amount: 50000.00, type: 'debit', card: 'icici', source: 'pdf_mar2025' },
  { date: '2025-03-04', description: 'GOOGLE WORKSPACE', amount: 18779.00, type: 'debit', card: 'icici', source: 'pdf_mar2025' },
  { date: '2025-03-07', description: 'PADDLE.NET ADGUARD', amount: 252.00, type: 'debit', card: 'icici', source: 'pdf_mar2025' },
  { date: '2025-03-16', description: 'Interest Charges (Mar)', amount: 7270.97, type: 'debit', card: 'icici', source: 'pdf_mar2025' },
  { date: '2025-03-16', description: 'IGST on Interest (Mar)', amount: 1308.78, type: 'debit', card: 'icici', source: 'pdf_mar2025' },

  // === Apr 2025 (stmt18) ===
  { date: '2025-04-01', description: 'Shopify Commerce India Private Mumbai', amount: 63931.00, type: 'debit', card: 'icici', source: 'pdf_apr2025' },
  { date: '2025-04-16', description: 'Interest Charges (Apr)', amount: 7238.69, type: 'debit', card: 'icici', source: 'pdf_apr2025' },
  { date: '2025-04-16', description: 'IGST on Interest (Apr)', amount: 1302.96, type: 'debit', card: 'icici', source: 'pdf_apr2025' },

  // === May 2025 (stmt19) ===
  { date: '2025-05-01', description: 'Shopify Commerce India Private Mumbai', amount: 63367.00, type: 'debit', card: 'icici', source: 'pdf_may2025' },
  { date: '2025-05-05', description: 'TradingView', amount: 8454.00, type: 'debit', card: 'icici', source: 'pdf_may2025' },
  { date: '2025-05-10', description: 'DCC Fee + IGST', amount: 100.00, type: 'debit', card: 'icici', source: 'pdf_may2025' },
  { date: '2025-05-16', description: 'Interest Charges (May)', amount: 7644.09, type: 'debit', card: 'icici', source: 'pdf_may2025' },
  { date: '2025-05-16', description: 'IGST on Interest (May)', amount: 1375.94, type: 'debit', card: 'icici', source: 'pdf_may2025' },

  // === Jun 2025 (stmt20) ===
  { date: '2025-06-01', description: 'Shopify Commerce India Private Mumbai', amount: 63013.00, type: 'debit', card: 'icici', source: 'pdf_jun2025' },
  { date: '2025-06-05', description: 'LAWJOY GENERAL Singapore', amount: 25773.00, type: 'debit', card: 'icici', source: 'pdf_jun2025' },
  { date: '2025-06-05', description: 'DCC Fee + GST on Lawjoy', amount: 304.00, type: 'debit', card: 'icici', source: 'pdf_jun2025' },
  { date: '2025-06-10', description: 'PERPLEXITY AI', amount: 1790.00, type: 'debit', card: 'icici', source: 'pdf_jun2025' },
  { date: '2025-06-16', description: 'Interest Charges (Jun)', amount: 7271.49, type: 'debit', card: 'icici', source: 'pdf_jun2025' },
  { date: '2025-06-16', description: 'IGST on Interest (Jun)', amount: 1308.87, type: 'debit', card: 'icici', source: 'pdf_jun2025' },

  // === Jul 2025 (stmt21) ===
  { date: '2025-07-01', description: 'Shopify Commerce India Private Mumbai', amount: 63306.00, type: 'debit', card: 'icici', source: 'pdf_jul2025' },
  { date: '2025-07-16', description: 'Interest Charges (Jul)', amount: 7604.52, type: 'debit', card: 'icici', source: 'pdf_jul2025' },
  { date: '2025-07-16', description: 'IGST on Interest (Jul)', amount: 1368.81, type: 'debit', card: 'icici', source: 'pdf_jul2025' },

  // === Aug 2025 (stmt22) ===
  { date: '2025-08-01', description: 'Shopify Commerce India Private Mumbai', amount: 63420.00, type: 'debit', card: 'icici', source: 'pdf_aug2025' },
  { date: '2025-08-16', description: 'Interest Charges (Aug)', amount: 7685.45, type: 'debit', card: 'icici', source: 'pdf_aug2025' },
  { date: '2025-08-16', description: 'IGST on Interest (Aug)', amount: 1383.38, type: 'debit', card: 'icici', source: 'pdf_aug2025' },

  // === Sep 2025 (stmt23) ===
  { date: '2025-09-01', description: 'Shopify Commerce India Private Mumbai', amount: 63835.00, type: 'debit', card: 'icici', source: 'pdf_sep2025' },
  { date: '2025-09-05', description: 'BROWNTAPE', amount: 5900.00, type: 'debit', card: 'icici', source: 'pdf_sep2025' },
  { date: '2025-09-06', description: 'GODADDY', amount: 1061.00, type: 'debit', card: 'icici', source: 'pdf_sep2025' },
  { date: '2025-09-08', description: 'IND*LINKEDIN', amount: 2000.00, type: 'debit', card: 'icici', source: 'pdf_sep2025' },
  { date: '2025-09-10', description: 'CODASHOP Singapore', amount: 1508.00, type: 'debit', card: 'icici', source: 'pdf_sep2025' },
  { date: '2025-09-12', description: 'BOOSTEROID', amount: 1084.00, type: 'debit', card: 'icici', source: 'pdf_sep2025' },
  { date: '2025-09-16', description: 'Interest Charges (Sep)', amount: 7439.79, type: 'debit', card: 'icici', source: 'pdf_sep2025' },
  { date: '2025-09-16', description: 'IGST on Interest (Sep)', amount: 1339.16, type: 'debit', card: 'icici', source: 'pdf_sep2025' },

  // === Oct 2025 (stmt24) ===
  { date: '2025-10-01', description: 'Shopify Commerce India Private Mumbai', amount: 68528.00, type: 'debit', card: 'icici', source: 'pdf_oct2025' },
  { date: '2025-10-05', description: 'SUDOWRITE', amount: 1758.00, type: 'debit', card: 'icici', source: 'pdf_oct2025' },
  { date: '2025-10-08', description: 'BOOSTEROID', amount: 1063.00, type: 'debit', card: 'icici', source: 'pdf_oct2025' },
  { date: '2025-10-10', description: 'DCC Fee + IGST', amount: 13.00, type: 'debit', card: 'icici', source: 'pdf_oct2025' },
  { date: '2025-10-16', description: 'Interest Charges (Oct)', amount: 7710.09, type: 'debit', card: 'icici', source: 'pdf_oct2025' },
  { date: '2025-10-16', description: 'IGST on Interest (Oct)', amount: 1387.82, type: 'debit', card: 'icici', source: 'pdf_oct2025' },

  // === Nov 2025 ===
  { date: '2025-11-01', description: 'Shopify Commerce India Private Mumbai', amount: 65961.00, type: 'debit', card: 'icici', source: 'pdf_nov2025' },
  { date: '2025-11-10', description: 'CLAUDE AI SUBSCRIPTION', amount: 2200.00, type: 'debit', card: 'icici', source: 'pdf_nov2025' },
  { date: '2025-11-16', description: 'Interest Charges (Nov)', amount: 7475.20, type: 'debit', card: 'icici', source: 'pdf_nov2025' },
  { date: '2025-11-16', description: 'IGST on Interest (Nov)', amount: 1345.54, type: 'debit', card: 'icici', source: 'pdf_nov2025' },

  // === Dec 2025 ===
  { date: '2025-12-01', description: 'Shopify Commerce India Private Mumbai', amount: 54585.00, type: 'debit', card: 'icici', source: 'pdf_dec2025' },
  { date: '2025-12-05', description: 'CLAUDE AI SUBSCRIPTION', amount: 11505.00, type: 'debit', card: 'icici', source: 'pdf_dec2025' },
  { date: '2025-12-08', description: 'ANTHROPIC', amount: 3359.00, type: 'debit', card: 'icici', source: 'pdf_dec2025' },
  { date: '2025-12-10', description: 'RAILWAY', amount: 1797.00, type: 'debit', card: 'icici', source: 'pdf_dec2025' },
  { date: '2025-12-12', description: 'WATI.IO TSIM SHA TSUI', amount: 5999.00, type: 'debit', card: 'icici', source: 'pdf_dec2025' },
  { date: '2025-12-12', description: 'DCC Fee + IGST on WATI', amount: 71.00, type: 'debit', card: 'icici', source: 'pdf_dec2025' },
  { date: '2025-12-16', description: 'Interest Charges (Dec)', amount: 7660.79, type: 'debit', card: 'icici', source: 'pdf_dec2025' },
  { date: '2025-12-16', description: 'IGST on Interest (Dec)', amount: 1378.94, type: 'debit', card: 'icici', source: 'pdf_dec2025' },
];
