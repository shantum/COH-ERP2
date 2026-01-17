/**
 * BOM Component Types Configuration
 *
 * Defines the structure for the 3-level BOM system:
 * - ComponentType: FABRIC, TRIM, SERVICE
 * - ComponentRole: Roles within each type (main, accent, lining, button, etc.)
 *
 * This configuration is used to seed the ComponentType and ComponentRole tables.
 * Add new roles here without requiring schema migrations.
 *
 * TO ADD A NEW ROLE:
 * 1. Add entry to COMPONENT_ROLES under the appropriate type code
 * 2. Code should be lowercase_snake_case
 * 3. Run seed script to sync with database
 */

// ============================================
// COMPONENT TYPES
// ============================================

export interface ComponentTypeConfig {
  /** Unique code (stored in DB, uppercase) */
  code: string;
  /** Display name */
  name: string;
  /** Whether this component type has inventory tracking */
  trackInventory: boolean;
  /** Sort order for display */
  sortOrder: number;
}

export const COMPONENT_TYPES: ComponentTypeConfig[] = [
  {
    code: 'FABRIC',
    name: 'Fabric',
    trackInventory: true,
    sortOrder: 1,
  },
  {
    code: 'TRIM',
    name: 'Trim',
    trackInventory: true,
    sortOrder: 2,
  },
  {
    code: 'SERVICE',
    name: 'Service',
    trackInventory: false, // Services don't have inventory
    sortOrder: 3,
  },
];

export type ComponentTypeCode = 'FABRIC' | 'TRIM' | 'SERVICE';

// ============================================
// COMPONENT ROLES BY TYPE
// ============================================

export interface ComponentRoleConfig {
  /** Unique code within type (lowercase_snake_case) */
  code: string;
  /** Display name */
  name: string;
  /** Is this role required for the product? */
  isRequired: boolean;
  /** Can a product have multiple instances of this role? */
  allowMultiple: boolean;
  /** Default quantity for this role */
  defaultQuantity?: number;
  /** Default unit (meter, piece, job) */
  defaultUnit?: string;
  /** Sort order within type */
  sortOrder: number;
}

export const COMPONENT_ROLES: Record<ComponentTypeCode, ComponentRoleConfig[]> = {
  FABRIC: [
    {
      code: 'main',
      name: 'Main Fabric',
      isRequired: true,
      allowMultiple: false,
      defaultUnit: 'meter',
      sortOrder: 1,
    },
    {
      code: 'accent',
      name: 'Accent Fabric',
      isRequired: false,
      allowMultiple: true,
      defaultUnit: 'meter',
      sortOrder: 2,
    },
    {
      code: 'lining',
      name: 'Lining',
      isRequired: false,
      allowMultiple: false,
      defaultUnit: 'meter',
      sortOrder: 3,
    },
    {
      code: 'pocket',
      name: 'Pocket Lining',
      isRequired: false,
      allowMultiple: false,
      defaultUnit: 'meter',
      sortOrder: 4,
    },
    {
      code: 'interfacing',
      name: 'Interfacing',
      isRequired: false,
      allowMultiple: false,
      defaultUnit: 'meter',
      sortOrder: 5,
    },
  ],

  TRIM: [
    {
      code: 'button',
      name: 'Button',
      isRequired: false,
      allowMultiple: true, // Can have different button types
      defaultQuantity: 1,
      defaultUnit: 'piece',
      sortOrder: 1,
    },
    {
      code: 'zipper',
      name: 'Zipper',
      isRequired: false,
      allowMultiple: false,
      defaultQuantity: 1,
      defaultUnit: 'piece',
      sortOrder: 2,
    },
    {
      code: 'label',
      name: 'Label',
      isRequired: false,
      allowMultiple: true, // Brand label, care label, etc.
      defaultQuantity: 1,
      defaultUnit: 'piece',
      sortOrder: 3,
    },
    {
      code: 'thread',
      name: 'Thread',
      isRequired: false,
      allowMultiple: true, // Different thread colors
      defaultQuantity: 0.1,
      defaultUnit: 'spool',
      sortOrder: 4,
    },
    {
      code: 'elastic',
      name: 'Elastic',
      isRequired: false,
      allowMultiple: false,
      defaultUnit: 'meter',
      sortOrder: 5,
    },
    {
      code: 'tape',
      name: 'Tape/Binding',
      isRequired: false,
      allowMultiple: false,
      defaultUnit: 'meter',
      sortOrder: 6,
    },
    {
      code: 'hook',
      name: 'Hook & Eye',
      isRequired: false,
      allowMultiple: false,
      defaultQuantity: 1,
      defaultUnit: 'piece',
      sortOrder: 7,
    },
    {
      code: 'drawstring',
      name: 'Drawstring',
      isRequired: false,
      allowMultiple: false,
      defaultUnit: 'meter',
      sortOrder: 8,
    },
  ],

  SERVICE: [
    {
      code: 'print',
      name: 'Printing',
      isRequired: false,
      allowMultiple: true, // Multiple print locations
      defaultQuantity: 1,
      defaultUnit: 'job',
      sortOrder: 1,
    },
    {
      code: 'embroidery',
      name: 'Embroidery',
      isRequired: false,
      allowMultiple: true,
      defaultQuantity: 1,
      defaultUnit: 'job',
      sortOrder: 2,
    },
    {
      code: 'wash',
      name: 'Washing/Finishing',
      isRequired: false,
      allowMultiple: false,
      defaultQuantity: 1,
      defaultUnit: 'job',
      sortOrder: 3,
    },
    {
      code: 'dye',
      name: 'Dyeing',
      isRequired: false,
      allowMultiple: false,
      defaultQuantity: 1,
      defaultUnit: 'job',
      sortOrder: 4,
    },
    {
      code: 'pleat',
      name: 'Pleating',
      isRequired: false,
      allowMultiple: false,
      defaultQuantity: 1,
      defaultUnit: 'job',
      sortOrder: 5,
    },
  ],
};

// ============================================
// HELPER FUNCTIONS
// ============================================

/** Get component type config by code */
export function getComponentType(code: ComponentTypeCode): ComponentTypeConfig | undefined {
  return COMPONENT_TYPES.find((t) => t.code === code);
}

/** Get all roles for a component type */
export function getRolesByType(typeCode: ComponentTypeCode): ComponentRoleConfig[] {
  return COMPONENT_ROLES[typeCode] || [];
}

/** Get role config by type and role code */
export function getRole(
  typeCode: ComponentTypeCode,
  roleCode: string
): ComponentRoleConfig | undefined {
  return COMPONENT_ROLES[typeCode]?.find((r) => r.code === roleCode);
}

/** Get all roles as a flat array with type info */
export function getAllRoles(): Array<ComponentRoleConfig & { typeCode: ComponentTypeCode }> {
  const result: Array<ComponentRoleConfig & { typeCode: ComponentTypeCode }> = [];

  for (const [typeCode, roles] of Object.entries(COMPONENT_ROLES)) {
    for (const role of roles) {
      result.push({ ...role, typeCode: typeCode as ComponentTypeCode });
    }
  }

  return result;
}

/** Validate role code exists for type */
export function isValidRole(typeCode: ComponentTypeCode, roleCode: string): boolean {
  return COMPONENT_ROLES[typeCode]?.some((r) => r.code === roleCode) ?? false;
}

// ============================================
// TRIM CATEGORIES (for TrimItem.category)
// ============================================

export const TRIM_CATEGORIES = [
  'button',
  'zipper',
  'label',
  'thread',
  'elastic',
  'tape',
  'hook',
  'drawstring',
  'other',
] as const;

export type TrimCategory = (typeof TRIM_CATEGORIES)[number];

// ============================================
// SERVICE CATEGORIES (for ServiceItem.category)
// ============================================

export const SERVICE_CATEGORIES = [
  'printing',
  'embroidery',
  'washing',
  'dyeing',
  'pleating',
  'other',
] as const;

export type ServiceCategory = (typeof SERVICE_CATEGORIES)[number];

// ============================================
// QUANTITY UNITS
// ============================================

export const QUANTITY_UNITS = ['meter', 'piece', 'spool', 'job', 'set', 'pair', 'yard'] as const;

export type QuantityUnit = (typeof QUANTITY_UNITS)[number];
