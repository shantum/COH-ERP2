/**
 * Sheet Offload Worker — barrel file
 * Re-exports the same default object + named types as the original sheetOffloadWorker.ts
 */

import { getCycleProgress, resetCycleProgress } from './state.js';
import { ingestInwardLive, triggerIngestInward, previewIngestInward } from './inward.js';
import { ingestOutwardLive, triggerIngestOutward, previewIngestOutward, triggerMoveShipped } from './outward.js';
import {
  triggerPushBalances,
  triggerCleanupDoneRows,
  triggerMigrateFormulas,
  previewPushBalances,
} from './balances.js';
import {
  previewFabricInward,
  triggerFabricInward,
  triggerPushFabricBalances,
  triggerImportFabricBalances,
} from './fabric.js';
import {
  start,
  stop,
  getStatus,
  getBufferCounts,
  runInwardCycle,
  runOutwardCycle,
} from './cycles.js';

// Named type re-exports
export type {
  IngestInwardResult,
  IngestOutwardResult,
  IngestPreviewResult,
  MoveShippedResult,
  CleanupDoneResult,
  MigrateFormulasResult,
  PushBalancesResult,
  PushFabricBalancesResult,
  ImportFabricBalancesResult,
  PushBalancesPreviewResult,
  OffloadStatus,
  RunSummary,
  BalanceVerificationResult,
  BalanceSnapshot,
  InwardPreviewRow,
  OutwardPreviewRow,
  FabricInwardResult,
  FabricInwardPreviewResult,
  FabricInwardPreviewRow,
  CycleStep,
  CycleProgressState,
} from './state.js';

export default {
  start,
  stop,
  getStatus,
  triggerIngestInward,
  triggerIngestOutward,
  triggerMoveShipped,
  triggerCleanupDoneRows,
  triggerMigrateFormulas,
  triggerPushBalances,
  triggerPushFabricBalances,
  triggerImportFabricBalances,
  getBufferCounts,
  previewIngestInward,
  previewIngestOutward,
  previewPushBalances,
  previewFabricInward,
  triggerFabricInward,
  runInwardCycle,
  runOutwardCycle,
  getCycleProgress,
  resetCycleProgress,
};
