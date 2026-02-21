/**
 * Fabric Report Page Search Params
 *
 * Simple schema for the daily fabric stock report view.
 */

import { z } from 'zod';

export const FabricReportSearchParams = z.object({
    /** Tab for future expansion */
    tab: z.enum(['overview', 'reorder', 'consumption']).catch('overview'),
});
export type FabricReportSearchParams = z.infer<typeof FabricReportSearchParams>;
