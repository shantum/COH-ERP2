/**
 * BOM (Bill of Materials) Components
 *
 * Components for managing product Bill of Materials:
 * - 3-level cascade: Product → Variation → SKU
 * - Template tab: Product-level defaults (trims, services)
 * - Variations tab: Color-specific fabric assignments
 * - SKUs tab: Size-specific quantity overrides
 */

export { default as BomEditorPanel } from './BomEditorPanel';
export { default as BomTemplateTab } from './BomTemplateTab';
export { default as BomVariationsTab } from './BomVariationsTab';
export { default as BomSkuTab } from './BomSkuTab';
export { default as ComponentRow } from './ComponentRow';
export { default as ComponentSelector } from './ComponentSelector';
export { default as CostSummary } from './CostSummary';
