/**
 * Materials Domain Zod Schemas
 *
 * These schemas are used for validating inline edit operations
 * in the materials hierarchy (Material → Fabric → Colour).
 *
 * Key patterns:
 * - Same schemas used for both auto-save and button-save cells
 * - Backend remains agnostic to save method
 * - Frontend validates before sending to server
 */
import { z } from 'zod';
// ============================================
// FABRIC INLINE EDIT SCHEMAS
// ============================================
/**
 * Update fabric cost per unit
 * Used by CostCell when editing a fabric node
 */
export const UpdateFabricCostSchema = z.object({
    fabricId: z.string().uuid('Invalid fabric ID'),
    costPerUnit: z.number().min(0, 'Cost must be non-negative').nullable(),
});
/**
 * Update fabric lead time in days
 * Used by LeadTimeCell when editing a fabric node
 */
export const UpdateFabricLeadTimeSchema = z.object({
    fabricId: z.string().uuid('Invalid fabric ID'),
    leadTimeDays: z.number().int('Lead time must be a whole number').min(0, 'Lead time must be non-negative').nullable(),
});
/**
 * Update fabric minimum order quantity
 * Used by MinOrderCell when editing a fabric node
 */
export const UpdateFabricMinOrderSchema = z.object({
    fabricId: z.string().uuid('Invalid fabric ID'),
    minOrderQty: z.number().min(0, 'Minimum order must be non-negative').nullable(),
});
// ============================================
// COLOUR INLINE EDIT SCHEMAS
// ============================================
/**
 * Update colour cost per unit
 * Used by CostCell when editing a colour node
 * Note: null value means inherit from parent fabric
 */
export const UpdateColourCostSchema = z.object({
    colourId: z.string().uuid('Invalid colour ID'),
    costPerUnit: z.number().min(0, 'Cost must be non-negative').nullable(),
});
/**
 * Update colour lead time in days
 * Used by LeadTimeCell when editing a colour node
 * Note: null value means inherit from parent fabric
 */
export const UpdateColourLeadTimeSchema = z.object({
    colourId: z.string().uuid('Invalid colour ID'),
    leadTimeDays: z.number().int('Lead time must be a whole number').min(0, 'Lead time must be non-negative').nullable(),
});
/**
 * Update colour minimum order quantity
 * Used by MinOrderCell when editing a colour node
 * Note: null value means inherit from parent fabric
 */
export const UpdateColourMinOrderSchema = z.object({
    colourId: z.string().uuid('Invalid colour ID'),
    minOrderQty: z.number().min(0, 'Minimum order must be non-negative').nullable(),
});
// ============================================
// PRODUCT/VARIATION FABRIC MAPPING SCHEMAS
// ============================================
/**
 * Update product fabric type
 * Used by FabricEditPopover for product-level fabric type assignment
 */
export const UpdateProductFabricTypeSchema = z.object({
    productId: z.string().uuid('Invalid product ID'),
    fabricTypeId: z.string().uuid('Invalid fabric type ID').nullable(),
});
/**
 * Update variation fabric
 * Used by FabricEditPopover for variation-level fabric assignment
 */
export const UpdateVariationFabricSchema = z.object({
    variationId: z.string().uuid('Invalid variation ID'),
    fabricId: z.string().uuid('Invalid fabric ID'),
});
// ============================================
// UNIFIED MATERIAL NODE UPDATE SCHEMA
// ============================================
/**
 * Generic material node cost update
 * Unified schema that works for both fabric and colour nodes
 * The nodeType discriminates which entity is being updated
 */
export const UpdateMaterialCostSchema = z.discriminatedUnion('nodeType', [
    z.object({
        nodeType: z.literal('fabric'),
        id: z.string().uuid('Invalid fabric ID'),
        costPerUnit: z.number().min(0, 'Cost must be non-negative').nullable(),
    }),
    z.object({
        nodeType: z.literal('colour'),
        id: z.string().uuid('Invalid colour ID'),
        costPerUnit: z.number().min(0, 'Cost must be non-negative').nullable(),
    }),
]);
/**
 * Generic material node lead time update
 */
export const UpdateMaterialLeadTimeSchema = z.discriminatedUnion('nodeType', [
    z.object({
        nodeType: z.literal('fabric'),
        id: z.string().uuid('Invalid fabric ID'),
        leadTimeDays: z.number().int().min(0, 'Lead time must be non-negative').nullable(),
    }),
    z.object({
        nodeType: z.literal('colour'),
        id: z.string().uuid('Invalid colour ID'),
        leadTimeDays: z.number().int().min(0, 'Lead time must be non-negative').nullable(),
    }),
]);
/**
 * Generic material node min order update
 */
export const UpdateMaterialMinOrderSchema = z.discriminatedUnion('nodeType', [
    z.object({
        nodeType: z.literal('fabric'),
        id: z.string().uuid('Invalid fabric ID'),
        minOrderQty: z.number().min(0, 'Minimum order must be non-negative').nullable(),
    }),
    z.object({
        nodeType: z.literal('colour'),
        id: z.string().uuid('Invalid colour ID'),
        minOrderQty: z.number().min(0, 'Minimum order must be non-negative').nullable(),
    }),
]);
//# sourceMappingURL=materials.js.map