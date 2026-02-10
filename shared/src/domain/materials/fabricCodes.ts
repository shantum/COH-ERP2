/**
 * Fabric Colour Code Generator
 *
 * Generates short, readable codes for FabricColour records.
 * Format: {MATERIAL}-{FABRIC}-{COLOUR} e.g. "LIN-60L-NVY"
 *
 * Only 4 materials and 17 fabrics — hardcoded maps are simplest.
 */

// ============================================
// MATERIAL ABBREVIATIONS
// ============================================

const MATERIAL_ABBR: Record<string, string> = {
    'Cotton': 'COT',
    'Hemp': 'HMP',
    'Linen': 'LIN',
    'Modal': 'MOD',
    'Pima Cotton': 'PIMA',
    'Tencel': 'TEN',
};

// ============================================
// FABRIC ABBREVIATIONS
// ============================================

const FABRIC_ABBR: Record<string, string> = {
    'Brushed Terry': 'BT',
    'Cotton Canvas': 'CAN',
    'Cotton Dobby': 'DOB',
    'Cotton Twill': 'TWL',
    'Egyptian Cotton': 'EGY',
    'Katpatti': 'KAT',
    'Rib': 'RIB',
    'Satin': 'SAT',
    'Seersucker': 'SSK',
    'Single Jersey': 'SJ',
    'Surekha': 'SUR',
    'Vintage': 'VIN',
    'Cord': 'CRD',
    'Cotton Modal Single Jersey': 'CMSJ',
    'Hemp': 'HMP',
    'Modal Knit': 'MK',
    'TENCEL': 'TCL',
    'Linen 25 Lea': '25L',
    'Linen 60 Lea': '60L',
    'Supima French Terry': 'SFT',
    'Supima Single Jersey': 'SSJ',
};

// ============================================
// COLOUR ABBREVIATIONS
// ============================================

const COLOUR_ABBR: Record<string, string> = {
    'Aqua Blue': 'AQU',
    'Beige': 'BGE',
    'Beige Stripes': 'BGS',
    'Berry Pink': 'BRP',
    'Black': 'BLK',
    'Black Melange': 'BKM',
    'Black & White': 'B&W',
    'Blue': 'BLU',
    'Bottle Green': 'BTG',
    'Brown': 'BRN',
    'Carbon Black': 'CBK',
    'Castle Grey': 'CSG',
    'Charcoal Grey': 'CHG',
    'Cloud White': 'CWH',
    'Cobalt Blue': 'COB',
    'Cornflower Blue': 'CFB',
    'Cream Melange': 'CRM',
    'Dark Grey': 'DGR',
    'Dark Teal': 'DTL',
    'Deep Sea Blue': 'DSB',
    'Deep Wine': 'DWN',
    'Denim Blue': 'DNM',
    'Easy Care White': 'ECW',
    'Eggshell': 'EGS',
    'Eggyolk': 'EGY',
    'Floral Print': 'FLR',
    'Forest Green': 'FSG',
    'Ginger': 'GNG',
    'Graphite': 'GRP',
    'Green': 'GRN',
    'Grey': 'GRY',
    'Indian Red': 'IDR',
    'Indigo': 'IND',
    'Jet Black': 'JBK',
    'Lavender': 'LAV',
    'Lemon Yellow': 'LMY',
    'Light Blue': 'LBL',
    'Light Grey': 'LGR',
    'Light Pink': 'LPK',
    'Light Turqouise': 'LTQ',
    'Lilac': 'LIL',
    'Marine Green': 'MRG',
    'Marshmallow White': 'MMW',
    'Midnight Black': 'MBK',
    'Midnight Forest': 'MDF',
    'Military Green': 'MLG',
    'Mineral Grey': 'MNG',
    'Mustard': 'MUS',
    'Nautical Blue': 'NTB',
    'Navy Blue': 'NVY',
    'Ocean Blue': 'OCB',
    'Olive Green': 'OLV',
    'Pebble Grey': 'PBG',
    'Pine Green': 'PNG',
    'Pink': 'PNK',
    'Pinstripe Blue': 'PSB',
    'Pirate Black': 'PRB',
    'Pistachio': 'PIS',
    'Polka Dot': 'PLK',
    'Port Red': 'PRT',
    'Powder Blue': 'PWB',
    'Rain Forest Green': 'RFG',
    'Raspberry Glaze': 'RSP',
    'Red & White': 'R&W',
    'Riviera Stripes Blue': 'RSB',
    'Royal Purple': 'RPL',
    'Sage Green': 'SGE',
    'Sky Blue': 'SKY',
    'Slate Grey': 'SLG',
    'Stone Grey': 'STG',
    'Sunset Pink': 'SSP',
    'Taupe': 'TAU',
    'Vintage Pink': 'VPK',
    'Walnut Brown': 'WBR',
    'White': 'WHT',
    'Wildflower Blue': 'WFB',
    'Yellow': 'YLW',
};

// ============================================
// CODE GENERATOR
// ============================================

/**
 * Generate a fabric colour code from material, fabric, and colour names.
 *
 * Falls back to first 3 uppercase letters if a name isn't in the map.
 */
export function generateFabricColourCode(
    materialName: string,
    fabricName: string,
    colourName: string,
): string {
    const mat = MATERIAL_ABBR[materialName] ?? materialName.slice(0, 3).toUpperCase();
    const fab = FABRIC_ABBR[fabricName] ?? fabricName.slice(0, 3).toUpperCase();
    const col = COLOUR_ABBR[colourName] ?? colourName.slice(0, 3).toUpperCase();
    return `${mat}-${fab}-${col}`;
}
