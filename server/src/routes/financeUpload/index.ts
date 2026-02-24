/**
 * Finance Upload Routes — directory index
 *
 * Creates and exports the Express router.
 * Import as: `import financeUploadRoutes from './financeUpload.js'`
 */

import { Router } from 'express';
import { registerRoutes } from './routes.js';

const router = Router();
registerRoutes(router);

export default router;

// Re-export utilities for external use
export { enrichPartyFromInvoice, createPartyFromInvoice, panFromGstin, FIELD_LABELS } from './partyEnricher.js';
export type { EnrichmentResult } from './partyEnricher.js';
export { previewEnrichment } from './enrichmentPreview.js';
export { createDraftInvoice, deriveGstRate, deriveBillingPeriod, INVOICE_SELECT } from './invoiceBuilder.js';
