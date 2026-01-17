/**
 * Unified Product Edit Modal
 *
 * Hierarchical editing of Product → Variation → SKU
 * with dialog-stack navigation and cost cascade visualization.
 */

// Main component
export { UnifiedProductEditModal } from './UnifiedProductEditModal';

// Types
export type {
  UnifiedProductEditModalProps,
  EditLevel,
  ProductFormData,
  VariationFormData,
  SkuFormData,
  CostCascade,
  CostCascadeValue,
} from './types';

// Shared components (for custom use cases)
export { CostInheritanceField, SimpleCostField } from './shared/CostInheritanceField';
export { FabricSelector, ColorSwatch } from './shared/FabricSelector';
export { EditDialogFooter, UnsavedIndicator } from './shared/EditDialogFooter';
