/**
 * BOM (Bill of Materials) Server Functions — Barrel File
 *
 * Re-exports from domain modules. Consumers import from this file unchanged.
 */

// Shared types
export type { MutationResult, DbRecord } from './bomHelpers';

// Queries
export {
    getBomForVariation,
    getBomForProduct,
    getAvailableComponents,
    getComponentRoles,
    getSizeConsumptions,
    getCostConfig,
} from './bomQueries';

export type {
    BomLineResult,
    AvailableComponentsResult,
    ComponentRoleResult,
    SizeConsumptionResult,
    CostConfigResult,
} from './bomQueries';

// CRUD
export {
    createBomLine,
    updateBomLine,
    deleteBomLine,
} from './bomCrud';

export type {
    CreateBomLineResult,
    UpdateBomLineResult,
    DeleteBomLineResult,
} from './bomCrud';

// Templates
export {
    getProductBom,
    updateTemplate,
    updateProductBom,
} from './bomTemplates';

export type {
    ProductBomTemplateLine,
    VariationBomData,
    ProductBomResult,
} from './bomTemplates';

// Fabric Mapping
export {
    linkFabricToVariation,
    getFabricAssignments,
    linkVariationsToColour,
    clearVariationsFabricMapping,
} from './bomFabricMapping';

export type {
    LinkFabricResult,
    FabricAssignment,
} from './bomFabricMapping';
