import { google } from 'googleapis';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const KEY_PATH = resolve(import.meta.dirname, '../config/google-service-account.json');
const keyFile = JSON.parse(readFileSync(KEY_PATH, 'utf-8'));
const auth = new google.auth.JWT({ email: keyFile.client_email, key: keyFile.private_key, scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'] });
const sheets = google.sheets({ version: 'v4', auth });

const ID = '1OlEDXXQpKmjicTHn35EMJ2qj3f0BVNAUK3M8kyeergo';

// Row 4 formulas (first data row)
const resp = await sheets.spreadsheets.values.get({ spreadsheetId: ID, range: "'Inventory'!A4:G6", valueRenderOption: 'FORMULA' });
for (const [i, row] of (resp.data.values ?? []).entries()) {
    console.log(`Row ${i+4}:`, row?.map((v: string, j: number) => `${String.fromCharCode(65+j)}=${v}`).join(' | '));
}

// Check Office Inventory formulas too
console.log('\n--- Office Inventory row 4 formulas ---');
const resp2 = await sheets.spreadsheets.values.get({ spreadsheetId: ID, range: "'Office Inventory'!A4:G4", valueRenderOption: 'FORMULA' });
console.log('Row 4:', resp2.data.values?.[0]?.map((v: string, j: number) => `${String.fromCharCode(65+j)}=${v}`).join(' | '));
