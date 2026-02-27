/**
 * Combined Daily Pipeline Report — emailed after the nightly auto-ingest cycle.
 * Includes inward, move-shipped, and outward sections.
 */

import { wrapInLayout, heading, paragraph, detailTable, detailRow, divider } from './layout.js';

export interface FabricConsumptionEmailLine {
    fabricName: string;
    colourName: string;
    unit: string;
    piecesProduced: number;
    fabricConsumed: number;
    remainingBalance: number;
}

export interface DailyReportData {
    date: string;               // e.g. "27 Feb 2026"

    // Inward
    inwardIngested: number;
    inwardSkipped: number;
    inwardRowsMarkedDone: number;
    inwardSkusUpdated: number;
    inwardErrors: number;
    inwardDurationMs: number;
    inwardValidationErrors: Record<string, number>;
    inwardBalancePassed: boolean | null;
    inwardBalanceDrifted: number;
    inwardErrorMessage: string | null;
    fabricConsumption?: FabricConsumptionEmailLine[];

    // Move Shipped
    moveShippedRowsFound: number;
    moveShippedSkipped: number;
    moveShippedSkipReasons: Record<string, number>;
    moveShippedWritten: number;
    moveShippedVerified: number;
    moveShippedDeleted: number;
    moveShippedErrors: string[];
    moveShippedDurationMs: number;

    // Outward
    outwardIngested: number;
    outwardLinked: number;
    outwardSkipped: number;
    outwardErrors: number;
    outwardDurationMs: number;
    outwardSkipReasons?: Record<string, number>;
    outwardBalancePassed: boolean | null;
    outwardBalanceDrifted: number;
    outwardErrorMessage: string | null;
}

export function renderDailyReport(data: DailyReportData): { html: string; text: string; subject: string } {
    const hasInwardError = !!data.inwardErrorMessage;
    const hasOutwardError = !!data.outwardErrorMessage;
    const hasMoveErrors = data.moveShippedErrors.length > 0;
    const hasAnyError = hasInwardError || hasOutwardError || hasMoveErrors;

    const statusEmoji = hasAnyError ? '\u26a0\ufe0f' : '\u2705';
    const subject = `COH Daily Ingest — ${data.date} — ${data.inwardIngested}\u2191 ${data.outwardIngested}\u2193${hasAnyError ? ' (errors)' : ''}`;

    // --- Inward section ---
    const inwardDurationSec = (data.inwardDurationMs / 1000).toFixed(1);
    const inwardStatus = data.inwardErrorMessage ? 'FAILED' : data.inwardErrors > 0 ? 'ERRORS' : 'OK';

    let inwardValidationSection = '';
    const valErrors = Object.entries(data.inwardValidationErrors);
    if (valErrors.length > 0) {
        const rows = valErrors
            .sort((a, b) => b[1] - a[1])
            .map(([reason, count]) => `<tr><td style="padding:2px 8px 2px 0;font-size:12px;color:#666;">${reason}</td><td style="padding:2px 0;font-size:12px;color:#c0392b;font-weight:600;">${count}</td></tr>`)
            .join('');
        inwardValidationSection = `<table role="presentation" cellpadding="0" cellspacing="0" style="margin-top:8px;">${rows}</table>`;
    }

    let inwardBalanceRow = '';
    if (data.inwardBalancePassed !== null) {
        const txt = data.inwardBalancePassed ? '\u2705 Passed' : `\u26a0\ufe0f ${data.inwardBalanceDrifted} drifted`;
        inwardBalanceRow = detailRow('Balance', txt);
    }

    let fabricSection = '';
    if (data.fabricConsumption && data.fabricConsumption.length > 0) {
        const totalPieces = data.fabricConsumption.reduce((sum, l) => sum + l.piecesProduced, 0);
        const headerRow = `<tr style="border-bottom:2px solid #e0e0e0;">
            <th style="padding:4px 8px;text-align:left;font-size:11px;color:#888;font-weight:600;text-transform:uppercase;">Fabric</th>
            <th style="padding:4px 8px;text-align:left;font-size:11px;color:#888;font-weight:600;text-transform:uppercase;">Colour</th>
            <th style="padding:4px 8px;text-align:right;font-size:11px;color:#888;font-weight:600;text-transform:uppercase;">Pcs</th>
            <th style="padding:4px 8px;text-align:right;font-size:11px;color:#888;font-weight:600;text-transform:uppercase;">Used</th>
            <th style="padding:4px 8px;text-align:right;font-size:11px;color:#888;font-weight:600;text-transform:uppercase;">Bal</th>
        </tr>`;
        const bodyRows = data.fabricConsumption.map(line => {
            const lowBalance = line.remainingBalance < 10;
            const balStyle = lowBalance ? 'color:#c0392b;font-weight:600;' : 'color:#333;';
            return `<tr style="border-bottom:1px solid #f0f0f0;">
                <td style="padding:4px 8px;font-size:12px;color:#333;">${line.fabricName}</td>
                <td style="padding:4px 8px;font-size:12px;color:#666;">${line.colourName}</td>
                <td style="padding:4px 8px;font-size:12px;color:#333;text-align:right;">${line.piecesProduced}</td>
                <td style="padding:4px 8px;font-size:12px;color:#333;text-align:right;">${line.fabricConsumed} ${line.unit}</td>
                <td style="padding:4px 8px;font-size:12px;text-align:right;${balStyle}">${line.remainingBalance} ${line.unit}</td>
            </tr>`;
        }).join('');

        fabricSection = `
            <p style="margin:8px 0 4px;font-size:12px;color:#666;">${totalPieces} pcs from sampling \u2014 fabric deducted per BOM</p>
            <table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse;">
                ${headerRow}${bodyRows}
            </table>
        `;
    }

    // --- Move Shipped section ---
    const moveDurationSec = (data.moveShippedDurationMs / 1000).toFixed(1);

    let moveSkipSection = '';
    const skipEntries = Object.entries(data.moveShippedSkipReasons);
    if (skipEntries.length > 0) {
        const rows = skipEntries
            .sort((a, b) => b[1] - a[1])
            .map(([reason, count]) => `<tr><td style="padding:2px 8px 2px 0;font-size:12px;color:#666;">${reason}</td><td style="padding:2px 0;font-size:12px;color:#e67e22;font-weight:600;">${count}</td></tr>`)
            .join('');
        moveSkipSection = `<table role="presentation" cellpadding="0" cellspacing="0" style="margin-top:8px;">${rows}</table>`;
    }

    // --- Outward section ---
    const outwardDurationSec = (data.outwardDurationMs / 1000).toFixed(1);
    const outwardStatus = data.outwardErrorMessage ? 'FAILED' : data.outwardErrors > 0 ? 'ERRORS' : 'OK';

    let outwardBalanceRow = '';
    if (data.outwardBalancePassed !== null) {
        const txt = data.outwardBalancePassed ? '\u2705 Passed' : `\u26a0\ufe0f ${data.outwardBalanceDrifted} drifted`;
        outwardBalanceRow = detailRow('Balance', txt);
    }

    let outwardSkipSection = '';
    if (data.outwardSkipReasons) {
        const entries = Object.entries(data.outwardSkipReasons);
        if (entries.length > 0) {
            const rows = entries
                .sort((a, b) => b[1] - a[1])
                .map(([reason, count]) => `<tr><td style="padding:2px 8px 2px 0;font-size:12px;color:#666;">${reason}</td><td style="padding:2px 0;font-size:12px;color:#c0392b;font-weight:600;">${count}</td></tr>`)
                .join('');
            outwardSkipSection = `<table role="presentation" cellpadding="0" cellspacing="0" style="margin-top:8px;">${rows}</table>`;
        }
    }

    const html = wrapInLayout(`
        ${heading(`${statusEmoji} Daily Ingest \u2014 ${data.date}`)}
        ${paragraph(`Pipeline completed at ${new Date().toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit' })} IST.`)}

        <h3 style="margin:0 0 8px;font-size:16px;font-weight:600;color:#333;">\u2191 Inward</h3>
        ${detailTable(`
            ${detailRow('Status', `<span style="font-weight:700;">${inwardStatus}</span>`)}
            ${detailRow('Ingested', `<span style="font-size:18px;font-weight:700;color:#27ae60;">${data.inwardIngested}</span> rows`)}
            ${detailRow('Skipped', `${data.inwardSkipped} rows`)}
            ${detailRow('Errors', data.inwardErrors > 0 ? `<span style="color:#c0392b;font-weight:600;">${data.inwardErrors}</span>` : '0')}
            ${detailRow('Duration', `${inwardDurationSec}s`)}
            ${inwardBalanceRow}
        `)}
        ${data.inwardErrorMessage ? paragraph(`<strong style="color:#c0392b;">Error:</strong> ${data.inwardErrorMessage}`) : ''}
        ${inwardValidationSection}
        ${fabricSection}

        ${divider()}

        <h3 style="margin:0 0 8px;font-size:16px;font-weight:600;color:#333;">\u21c4 Move Shipped</h3>
        ${detailTable(`
            ${detailRow('Found', `${data.moveShippedRowsFound} shipped rows`)}
            ${detailRow('Written', `<span style="font-size:18px;font-weight:700;color:#2980b9;">${data.moveShippedWritten}</span> to Outward (Live)`)}
            ${detailRow('Verified', `${data.moveShippedVerified}`)}
            ${detailRow('Deleted', `${data.moveShippedDeleted} from Orders`)}
            ${detailRow('Skipped', `${data.moveShippedSkipped}`)}
            ${detailRow('Duration', `${moveDurationSec}s`)}
        `)}
        ${hasMoveErrors ? paragraph(`<strong style="color:#c0392b;">Errors:</strong> ${data.moveShippedErrors.join('; ')}`) : ''}
        ${moveSkipSection}

        ${divider()}

        <h3 style="margin:0 0 8px;font-size:16px;font-weight:600;color:#333;">\u2193 Outward</h3>
        ${detailTable(`
            ${detailRow('Status', `<span style="font-weight:700;">${outwardStatus}</span>`)}
            ${detailRow('Ingested', `<span style="font-size:18px;font-weight:700;color:#e67e22;">${data.outwardIngested}</span> rows`)}
            ${detailRow('Orders linked', `${data.outwardLinked}`)}
            ${detailRow('Skipped', `${data.outwardSkipped} rows`)}
            ${detailRow('Errors', data.outwardErrors > 0 ? `<span style="color:#c0392b;font-weight:600;">${data.outwardErrors}</span>` : '0')}
            ${detailRow('Duration', `${outwardDurationSec}s`)}
            ${outwardBalanceRow}
        `)}
        ${data.outwardErrorMessage ? paragraph(`<strong style="color:#c0392b;">Error:</strong> ${data.outwardErrorMessage}`) : ''}
        ${outwardSkipSection}
    `, { preheader: `${data.inwardIngested}\u2191 ${data.outwardIngested}\u2193 \u2014 ${data.moveShippedWritten} moved` });

    const text = [
        `COH Daily Ingest \u2014 ${data.date}`,
        '',
        'INWARD:',
        `  Ingested: ${data.inwardIngested}`,
        `  Skipped: ${data.inwardSkipped}`,
        `  Errors: ${data.inwardErrors}`,
        `  Duration: ${inwardDurationSec}s`,
        data.inwardErrorMessage ? `  Error: ${data.inwardErrorMessage}` : '',
        '',
        'MOVE SHIPPED:',
        `  Found: ${data.moveShippedRowsFound}`,
        `  Written: ${data.moveShippedWritten}`,
        `  Verified: ${data.moveShippedVerified}`,
        `  Deleted: ${data.moveShippedDeleted}`,
        hasMoveErrors ? `  Errors: ${data.moveShippedErrors.join('; ')}` : '',
        '',
        'OUTWARD:',
        `  Ingested: ${data.outwardIngested}`,
        `  Orders linked: ${data.outwardLinked}`,
        `  Skipped: ${data.outwardSkipped}`,
        `  Errors: ${data.outwardErrors}`,
        `  Duration: ${outwardDurationSec}s`,
        data.outwardErrorMessage ? `  Error: ${data.outwardErrorMessage}` : '',
    ].filter(line => line !== '').join('\n');

    return { html, text, subject };
}
