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
/**
 * Update fabric cost per unit
 * Used by CostCell when editing a fabric node
 */
export declare const UpdateFabricCostSchema: z.ZodObject<{
    fabricId: z.ZodString;
    costPerUnit: z.ZodNullable<z.ZodNumber>;
}, z.core.$strip>;
export type UpdateFabricCostInput = z.infer<typeof UpdateFabricCostSchema>;
/**
 * Update fabric lead time in days
 * Used by LeadTimeCell when editing a fabric node
 */
export declare const UpdateFabricLeadTimeSchema: z.ZodObject<{
    fabricId: z.ZodString;
    leadTimeDays: z.ZodNullable<z.ZodNumber>;
}, z.core.$strip>;
export type UpdateFabricLeadTimeInput = z.infer<typeof UpdateFabricLeadTimeSchema>;
/**
 * Update fabric minimum order quantity
 * Used by MinOrderCell when editing a fabric node
 */
export declare const UpdateFabricMinOrderSchema: z.ZodObject<{
    fabricId: z.ZodString;
    minOrderQty: z.ZodNullable<z.ZodNumber>;
}, z.core.$strip>;
export type UpdateFabricMinOrderInput = z.infer<typeof UpdateFabricMinOrderSchema>;
/**
 * Update colour cost per unit
 * Used by CostCell when editing a colour node
 * Note: null value means inherit from parent fabric
 */
export declare const UpdateColourCostSchema: z.ZodObject<{
    colourId: z.ZodString;
    costPerUnit: z.ZodNullable<z.ZodNumber>;
}, z.core.$strip>;
export type UpdateColourCostInput = z.infer<typeof UpdateColourCostSchema>;
/**
 * Update colour lead time in days
 * Used by LeadTimeCell when editing a colour node
 * Note: null value means inherit from parent fabric
 */
export declare const UpdateColourLeadTimeSchema: z.ZodObject<{
    colourId: z.ZodString;
    leadTimeDays: z.ZodNullable<z.ZodNumber>;
}, z.core.$strip>;
export type UpdateColourLeadTimeInput = z.infer<typeof UpdateColourLeadTimeSchema>;
/**
 * Update colour minimum order quantity
 * Used by MinOrderCell when editing a colour node
 * Note: null value means inherit from parent fabric
 */
export declare const UpdateColourMinOrderSchema: z.ZodObject<{
    colourId: z.ZodString;
    minOrderQty: z.ZodNullable<z.ZodNumber>;
}, z.core.$strip>;
export type UpdateColourMinOrderInput = z.infer<typeof UpdateColourMinOrderSchema>;
/**
 * Update product fabric type
 * Used by FabricEditPopover for product-level fabric type assignment
 */
export declare const UpdateProductFabricTypeSchema: z.ZodObject<{
    productId: z.ZodString;
    fabricTypeId: z.ZodNullable<z.ZodString>;
}, z.core.$strip>;
export type UpdateProductFabricTypeInput = z.infer<typeof UpdateProductFabricTypeSchema>;
/**
 * Update variation fabric
 * Used by FabricEditPopover for variation-level fabric assignment
 */
export declare const UpdateVariationFabricSchema: z.ZodObject<{
    variationId: z.ZodString;
    fabricId: z.ZodString;
}, z.core.$strip>;
export type UpdateVariationFabricInput = z.infer<typeof UpdateVariationFabricSchema>;
/**
 * Generic material node cost update
 * Unified schema that works for both fabric and colour nodes
 * The nodeType discriminates which entity is being updated
 */
export declare const UpdateMaterialCostSchema: z.ZodDiscriminatedUnion<[z.ZodObject<{
    nodeType: z.ZodLiteral<"fabric">;
    id: z.ZodString;
    costPerUnit: z.ZodNullable<z.ZodNumber>;
}, z.core.$strip>, z.ZodObject<{
    nodeType: z.ZodLiteral<"colour">;
    id: z.ZodString;
    costPerUnit: z.ZodNullable<z.ZodNumber>;
}, z.core.$strip>], "nodeType">;
export type UpdateMaterialCostInput = z.infer<typeof UpdateMaterialCostSchema>;
/**
 * Generic material node lead time update
 */
export declare const UpdateMaterialLeadTimeSchema: z.ZodDiscriminatedUnion<[z.ZodObject<{
    nodeType: z.ZodLiteral<"fabric">;
    id: z.ZodString;
    leadTimeDays: z.ZodNullable<z.ZodNumber>;
}, z.core.$strip>, z.ZodObject<{
    nodeType: z.ZodLiteral<"colour">;
    id: z.ZodString;
    leadTimeDays: z.ZodNullable<z.ZodNumber>;
}, z.core.$strip>], "nodeType">;
export type UpdateMaterialLeadTimeInput = z.infer<typeof UpdateMaterialLeadTimeSchema>;
/**
 * Generic material node min order update
 */
export declare const UpdateMaterialMinOrderSchema: z.ZodDiscriminatedUnion<[z.ZodObject<{
    nodeType: z.ZodLiteral<"fabric">;
    id: z.ZodString;
    minOrderQty: z.ZodNullable<z.ZodNumber>;
}, z.core.$strip>, z.ZodObject<{
    nodeType: z.ZodLiteral<"colour">;
    id: z.ZodString;
    minOrderQty: z.ZodNullable<z.ZodNumber>;
}, z.core.$strip>], "nodeType">;
export type UpdateMaterialMinOrderInput = z.infer<typeof UpdateMaterialMinOrderSchema>;
//# sourceMappingURL=materials.d.ts.map