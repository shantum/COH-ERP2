/**
 * Types for Unified Product Edit Modal
 *
 * Handles Product → Variation → SKU hierarchy editing
 * with cost cascade visualization and inheritance tracking.
 */

// === Navigation Types ===

export type EditLevel = 'product' | 'variation' | 'sku';

export interface DialogStackState {
  activeLevel: EditLevel;
  productId: string;
  variationId?: string;
  skuId?: string;
  productName: string;
  variationName?: string;
  skuName?: string;
}

export interface NavigationContext {
  stack: DialogStackState[];
  push: (state: Omit<DialogStackState, 'activeLevel'> & { activeLevel: EditLevel }) => void;
  pop: () => void;
  reset: () => void;
  current: DialogStackState | null;
  canGoBack: boolean;
}

// === Form Data Types ===

export interface ProductFormData {
  name: string;
  styleCode: string | null;
  category: string;
  productType: string;
  gender: string;
  baseProductionTimeMins: number;
  defaultFabricConsumption: number | null;
  trimsCost: number | null;
  liningCost: number | null;
  packagingCost: number | null;
  isActive: boolean;
}

export interface VariationFormData {
  colorName: string;
  colorHex: string | null;
  hasLining: boolean;
  trimsCost: number | null;
  liningCost: number | null;
  packagingCost: number | null;
  laborMinutes: number | null;
  isActive: boolean;
}

export interface SkuFormData {
  size: string;
  fabricConsumption: number | null;
  mrp: number | null;
  targetStockQty: number | null;
  trimsCost: number | null;
  liningCost: number | null;
  packagingCost: number | null;
  laborMinutes: number | null;
  isActive: boolean;
}

// === Cost Cascade Types ===

export type CostSource = 'sku' | 'variation' | 'product' | 'default' | 'none';

export interface CostCascadeValue {
  effectiveValue: number | null;
  source: CostSource;
  skuValue: number | null;
  variationValue: number | null;
  productValue: number | null;
  defaultValue: number | null;
}

export interface CostCascade {
  trimsCost: CostCascadeValue;
  liningCost: CostCascadeValue;
  packagingCost: CostCascadeValue;
  laborMinutes: CostCascadeValue;
  fabricConsumption: CostCascadeValue;
}

// === API Data Types ===

export interface ProductDetailData {
  id: string;
  name: string;
  styleCode: string | null;
  category: string;
  productType: string;
  gender: string;
  baseProductionTimeMins: number;
  defaultFabricConsumption: number | null;
  trimsCost: number | null;
  liningCost: number | null;
  packagingCost: number | null;
  isActive: boolean;
  imageUrl: string | null;
  variations: VariationDetailData[];
}

export interface VariationDetailData {
  id: string;
  productId: string;
  colorName: string;
  colorHex: string | null;
  // Fabric info derived from BOM (read-only display)
  fabricColourId: string | null;
  fabricColourName: string | null;
  fabricName: string | null;
  materialName: string | null;
  hasLining: boolean;
  trimsCost: number | null;
  liningCost: number | null;
  packagingCost: number | null;
  laborMinutes: number | null;
  isActive: boolean;
  imageUrl: string | null;
  skus: SkuDetailData[];
}

export interface SkuDetailData {
  id: string;
  skuCode: string;
  variationId: string;
  size: string;
  fabricConsumption: number | null;
  mrp: number | null;
  targetStockQty: number | null;
  trimsCost: number | null;
  liningCost: number | null;
  packagingCost: number | null;
  laborMinutes: number | null;
  isActive: boolean;
  currentBalance: number;
}

// === Filter/Dropdown Data ===

export interface FabricColour {
  id: string;
  name: string;
  code: string | null;
  hex: string | null;
  fabricId: string;
  fabricName: string;
  materialId: string;
  materialName: string;
  costPerUnit: number | null;
  productImages?: string[]; // Linked product thumbnails
}

export interface CatalogFilters {
  fabricColours: FabricColour[];
  categories: string[];
  genders: string[];
}

// === Component Props ===

export interface UnifiedProductEditModalProps {
  isOpen: boolean;
  onClose: () => void;
  initialLevel?: EditLevel;
  productId?: string;
  variationId?: string;
  skuId?: string;
  onSuccess?: () => void;
}

export interface LevelDialogProps {
  isActive: boolean;
  onNavigate: (level: EditLevel, id: string, name: string) => void;
  onSave: () => void;
  onClose: () => void;
  onBack?: () => void;
  canGoBack: boolean;
}

export interface ProductEditDialogProps extends LevelDialogProps {
  productId: string;
}

export interface VariationEditDialogProps extends LevelDialogProps {
  variationId: string;
  product: ProductDetailData;
}

export interface SkuEditDialogProps extends LevelDialogProps {
  skuId: string;
  variation: VariationDetailData;
  product: ProductDetailData;
}

// === Tab Types ===

export type ProductTabId = 'info' | 'variations' | 'costs' | 'bom';
export type VariationTabId = 'info' | 'skus' | 'fabric' | 'costs';
export type SkuTabId = 'info' | 'costs' | 'inventory';

export interface TabConfig {
  id: string;
  label: string;
  icon?: React.ComponentType<{ size?: number }>;
}

// === Default Values ===

export const DEFAULT_COST_VALUES = {
  trimsCost: 0,
  liningCost: 0,
  packagingCost: 50,
  laborMinutes: 60,
  fabricConsumption: 1.5,
};

export const PRODUCT_TABS: TabConfig[] = [
  { id: 'info', label: 'Info' },
  { id: 'variations', label: 'Variations' },
  { id: 'costs', label: 'Costs' },
  { id: 'bom', label: 'BOM' },
];

export const VARIATION_TABS: TabConfig[] = [
  { id: 'info', label: 'Info' },
  { id: 'skus', label: 'SKUs' },
  { id: 'fabric', label: 'Fabric' },
  { id: 'costs', label: 'Costs' },
];

export const SKU_TABS: TabConfig[] = [
  { id: 'info', label: 'Info' },
  { id: 'costs', label: 'Costs' },
  { id: 'inventory', label: 'Inventory' },
];

// === Utility Types ===

export type SetFieldValue<T> = <K extends keyof T>(field: K, value: T[K]) => void;

export interface FormState<T> {
  data: T;
  isDirty: boolean;
  isValid: boolean;
  errors: Partial<Record<keyof T, string>>;
}
