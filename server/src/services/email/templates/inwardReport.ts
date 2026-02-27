/**
 * Daily Inward Ingestion Report — emailed after the nightly auto-ingest cycle.
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

export interface InwardReportData {
    date: string;               // e.g. "27 Feb 2026"
    inwardIngested: number;
    skipped: number;
    rowsMarkedDone: number;
    skusUpdated: number;
    errors: number;
    durationMs: number;
    validationErrors: Record<string, number>;
    balancePassed: boolean | null; // null = not checked
    balanceDrifted: number;
    errorMessage: string | null;  // fatal error, if any
    fabricConsumption?: FabricConsumptionEmailLine[];
}

export function renderInwardReport(data: InwardReportData): { html: string; text: string; subject: string } {
    const status = data.errorMessage ? 'FAILED' : data.errors > 0 ? 'COMPLETED WITH ERRORS' : 'OK';
    const statusEmoji = data.errorMessage ? '\u274c' : data.errors > 0 ? '\u26a0\ufe0f' : '\u2705';
    const subject = `Inward Report ${data.date} — ${data.inwardIngested} ingested${data.errorMessage ? ' (FAILED)' : ''}`;

    const durationSec = (data.durationMs / 1000).toFixed(1);

    let validationSection = '';
    const valErrors = Object.entries(data.validationErrors);
    if (valErrors.length > 0) {
        const rows = valErrors
            .sort((a, b) => b[1] - a[1])
            .map(([reason, count]) => `<tr><td style="padding:4px 12px 4px 0;font-size:13px;color:#666;">${reason}</td><td style="padding:4px 0;font-size:13px;color:#c0392b;font-weight:600;">${count}</td></tr>`)
            .join('');
        validationSection = `
            ${divider()}
            <h3 style="margin:0 0 12px;font-size:16px;font-weight:600;color:#333;">Validation Issues</h3>
            <table role="presentation" cellpadding="0" cellspacing="0">${rows}</table>
        `;
    }

    let balanceSection = '';
    if (data.balancePassed !== null) {
        const balanceStatus = data.balancePassed ? '\u2705 Passed' : `\u26a0\ufe0f ${data.balanceDrifted} SKUs drifted`;
        balanceSection = detailRow('Balance check', balanceStatus);
    }

    // Fabric consumption section
    let fabricSection = '';
    if (data.fabricConsumption && data.fabricConsumption.length > 0) {
        const totalPieces = data.fabricConsumption.reduce((sum, l) => sum + l.piecesProduced, 0);
        const headerRow = `<tr style="border-bottom:2px solid #e0e0e0;">
            <th style="padding:6px 10px;text-align:left;font-size:12px;color:#888;font-weight:600;text-transform:uppercase;">Fabric</th>
            <th style="padding:6px 10px;text-align:left;font-size:12px;color:#888;font-weight:600;text-transform:uppercase;">Colour</th>
            <th style="padding:6px 10px;text-align:right;font-size:12px;color:#888;font-weight:600;text-transform:uppercase;">Pieces</th>
            <th style="padding:6px 10px;text-align:right;font-size:12px;color:#888;font-weight:600;text-transform:uppercase;">Consumed</th>
            <th style="padding:6px 10px;text-align:right;font-size:12px;color:#888;font-weight:600;text-transform:uppercase;">Balance</th>
        </tr>`;
        const bodyRows = data.fabricConsumption.map(line => {
            const lowBalance = line.remainingBalance < 10;
            const balStyle = lowBalance ? 'color:#c0392b;font-weight:600;' : 'color:#333;';
            return `<tr style="border-bottom:1px solid #f0f0f0;">
                <td style="padding:6px 10px;font-size:13px;color:#333;">${line.fabricName}</td>
                <td style="padding:6px 10px;font-size:13px;color:#666;">${line.colourName}</td>
                <td style="padding:6px 10px;font-size:13px;color:#333;text-align:right;">${line.piecesProduced}</td>
                <td style="padding:6px 10px;font-size:13px;color:#333;text-align:right;">${line.fabricConsumed} ${line.unit}</td>
                <td style="padding:6px 10px;font-size:13px;text-align:right;${balStyle}">${line.remainingBalance} ${line.unit}</td>
            </tr>`;
        }).join('');

        fabricSection = `
            ${divider()}
            <h3 style="margin:0 0 4px;font-size:16px;font-weight:600;color:#333;">Fabric Consumption</h3>
            <p style="margin:0 0 12px;font-size:13px;color:#666;">${totalPieces} pieces received from sampling/production — fabric deducted per BOM</p>
            <table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse;">
                ${headerRow}
                ${bodyRows}
            </table>
        `;
    }

    const html = wrapInLayout(`
        ${heading(`${statusEmoji} Inward Report — ${data.date}`)}
        ${paragraph(`Daily auto-ingest completed at ${new Date().toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit' })} IST.`)}

        ${detailTable(`
            ${detailRow('Status', `<span style="font-weight:700;">${status}</span>`)}
            ${detailRow('Ingested', `<span style="font-size:18px;font-weight:700;color:#27ae60;">${data.inwardIngested}</span> rows`)}
            ${detailRow('Skipped', `${data.skipped} rows`)}
            ${detailRow('Marked DONE', `${data.rowsMarkedDone} rows`)}
            ${detailRow('SKUs updated', `${data.skusUpdated}`)}
            ${detailRow('Errors', data.errors > 0 ? `<span style="color:#c0392b;font-weight:600;">${data.errors}</span>` : '0')}
            ${detailRow('Duration', `${durationSec}s`)}
            ${balanceSection}
        `)}

        ${data.errorMessage ? `${divider()}${paragraph(`<strong style="color:#c0392b;">Error:</strong> ${data.errorMessage}`)}` : ''}
        ${validationSection}
        ${fabricSection}
    `, { preheader: `${data.inwardIngested} rows ingested, ${data.skipped} skipped` });

    const fabricText = data.fabricConsumption && data.fabricConsumption.length > 0
        ? [
            '',
            'Fabric Consumption:',
            ...data.fabricConsumption.map(l =>
                `  ${l.fabricName} ${l.colourName}: ${l.piecesProduced} pcs → ${l.fabricConsumed} ${l.unit} consumed, ${l.remainingBalance} ${l.unit} remaining`
            ),
        ].join('\n')
        : '';

    const text = [
        `Inward Report — ${data.date}`,
        `Status: ${status}`,
        `Ingested: ${data.inwardIngested}`,
        `Skipped: ${data.skipped}`,
        `Errors: ${data.errors}`,
        `Duration: ${durationSec}s`,
        data.errorMessage ? `Error: ${data.errorMessage}` : '',
        fabricText,
    ].filter(Boolean).join('\n');

    return { html, text, subject };
}
