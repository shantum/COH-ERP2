/**
 * Company GST Configuration
 *
 * Centralized GST identity and defaults for invoice generation.
 */

export const COMPANY_GST = {
  /** Company registered state */
  state: 'Maharashtra',
  /** GSTIN state code (first 2 digits of GSTIN) */
  stateCode: '27',
  /** Company GSTIN — loaded from env */
  gstin: process.env.COMPANY_GSTIN ?? '',
  /** Default HSN code for knitted apparel (T-shirts, tops) */
  DEFAULT_HSN: '6109',
  /** Alternative HSN for knitted sweaters/pullovers */
  ALT_HSN_KNITTED: '6110',
} as const;

/**
 * Indian state name → state code mapping (for GST type determination)
 * Only states we commonly ship to are listed; others default to inter-state (IGST).
 */
export const STATE_CODES: Record<string, string> = {
  'Andhra Pradesh': '37',
  'Arunachal Pradesh': '12',
  'Assam': '18',
  'Bihar': '10',
  'Chhattisgarh': '22',
  'Delhi': '07',
  'Goa': '30',
  'Gujarat': '24',
  'Haryana': '06',
  'Himachal Pradesh': '02',
  'Jharkhand': '20',
  'Karnataka': '29',
  'Kerala': '32',
  'Madhya Pradesh': '23',
  'Maharashtra': '27',
  'Manipur': '14',
  'Meghalaya': '17',
  'Mizoram': '15',
  'Nagaland': '13',
  'Odisha': '21',
  'Punjab': '03',
  'Rajasthan': '08',
  'Sikkim': '11',
  'Tamil Nadu': '33',
  'Telangana': '36',
  'Tripura': '16',
  'Uttar Pradesh': '09',
  'Uttarakhand': '05',
  'West Bengal': '19',
  // Union Territories
  'Andaman and Nicobar Islands': '35',
  'Chandigarh': '04',
  'Dadra and Nagar Haveli and Daman and Diu': '26',
  'Jammu and Kashmir': '01',
  'Ladakh': '38',
  'Lakshadweep': '31',
  'Puducherry': '34',
};
