# Permissions System PRD

- **Document Type:** Product Requirements Document
- **Project:** COH-ERP2 Permissions & Access Control System
- **Date:** January 11, 2026

## 1. Executive Summary

### Problem Statement
COH-ERP2 currently has a minimal authentication system with only two roles (staff, admin) and a single `requireAdmin` middleware. This creates significant limitations:

- **No confidential data protection** - All users can view costs, consumption rates, and margins
- **No granular edit control** - Either full admin access or basic staff access
- **No audit trail** - No tracking of who accessed or modified sensitive data
- **Business risk** - Cost information visible to production/warehouse staff could leak to competitors or suppliers

### Solution Overview
Implement a comprehensive Role-Based Access Control (RBAC) system with:

- **Data Classification** - Tag fields as confidential, internal, or public
- **Permission Scopes** - Separate view and edit permissions per domain
- **Predefined Roles** - Common role templates (Owner, Manager, Operations, Warehouse, etc.)
- **Custom Permissions** - Override specific permissions per user
- **Admin UI** - Clean, intuitive interface for managing user permissions

## 2. Current State Analysis

### Existing Authentication

| Component | Current State |
| :--- | :--- |
| **User Model** | `id`, `email`, `password`, `name`, `role` (string: "staff" or "admin"), `isActive` |
| **JWT Auth** | Token with `id`, `email`, `role` - expires in 7 days |
| **Middleware** | `authenticateToken` (any user) and `requireAdmin` (admin only) |
| **Frontend** | Simple `isAuthenticated` check, no permission awareness |

### Identified Confidential Data

**Cost & Financial Data (HIGH sensitivity)**

| Model | Fields |
| :--- | :--- |
| **Sku** | `mrp`, `fabricConsumption`, `trimsCost`, `liningCost`, `packagingCost`, `laborMinutes` |
| **SkuCosting** | `fabricCost`, `laborCost`, `totalCogs`, `laborRatePerMin` |
| **CostConfig** | `laborRatePerMin`, `defaultPackagingCost`, `gstThreshold`, `gstRateAbove`, `gstRateBelow` |
| **Product** | `trimsCost`, `liningCost`, `packagingCost` |
| **Variation** | `trimsCost`, `liningCost`, `packagingCost`, `laborMinutes` |
| **Fabric** | `costPerUnit` |
| **FabricType** | `defaultCostPerUnit` |
| **FabricOrder** | `costPerUnit`, `totalCost` |
| **Order** | `totalAmount`, `codRemittedAmount` |
| **OrderLine** | `unitPrice`, `refundAmount` |

**Business-Sensitive Data (MEDIUM sensitivity)**

| Model | Fields |
| :--- | :--- |
| **Customer** | `email`, `phone`, `defaultAddress`, `returnCount`, `exchangeCount`, `rtoCount` |
| **Order** | `customerPhone`, `shippingAddress`, `paymentMethod`, `codRemittanceUtr` |
| **Supplier** | Contact details, pricing agreements |

### Current API Routes (19 files)

| Route File | Edit Operations | View Operations |
| :--- | :--- | :--- |
| `orders/` | Ship, hold, cancel, allocate | List all order views |
| `products.js` | Create, update products | List products |
| `fabrics.js` | CRUD fabrics, fabric orders | List fabrics with costs |
| `catalog.js` | Update SKU costing | Full catalog with costs |
| `inventory.js` | Inward, outward, RTO processing | Inventory balances |
| `production.js` | Create/complete batches | Production schedules |
| `returns.js` | Process returns, issue refunds | Return requests |
| `customers.js` | Update customer info | Customer list |
| `admin.js` | User management, system settings | Stats, configurations |
| `tracking.js` | - | Shipment tracking |
| `remittance.js` | Upload COD reconciliation | COD reports |

## 3. Proposed Permission Architecture

### 3.1 Data Classification Schema

- **Level 1: PUBLIC** - Product names, SKU codes, sizes, colors
- **Level 2: INTERNAL** - Inventory quantities, order status, customer names
- **Level 3: CONFIDENTIAL** - Costs, margins, consumption rates, financial data
- **Level 4: RESTRICTED** - System settings, user management, API credentials

### 3.2 Permission Domains

| Domain | View Permissions | Edit Permissions |
| :--- | :--- | :--- |
| **Orders** | `orders:view` - Basic order info<br>`orders:view:financial` - Prices, totals | `orders:ship`<br>`orders:hold`<br>`orders:cancel`<br>`orders:allocate` |
| **Products** | `products:view` - Names, sizes<br>`products:view:cost` - Costing data<br>`products:view:consumption` - Fabric consumption | `products:create`<br>`products:edit`<br>`products:edit:inventory` - Update stock targets<br>`products:edit:cost` - Trims, lining, labor<br>`products:edit:consumption` - Fabric consumption<br>`products:delete` |
| **Fabrics** | `fabrics:view`<br>`fabrics:view:cost` | `fabrics:create`<br>`fabrics:edit`<br>`fabrics:edit:cost`<br>`fabrics:order`<br>`fabrics:delete` |
| **Inventory** | `inventory:view` | `inventory:inward`<br>`inventory:outward`<br>`inventory:adjust`<br>`inventory:delete:inward` - Delete inward txns<br>`inventory:delete:outward` - Delete outward txns |
| **Production** | `production:view` | `production:create`<br>`production:complete`<br>`production:delete` |
| **Returns** | `returns:view`<br>`returns:view:financial` | `returns:process`<br>`returns:refund`<br>`returns:delete` |
| **Customers** | `customers:view`<br>`customers:view:contact` | `customers:edit`<br>`customers:delete` |
| **Settings** | `settings:view` | `settings:edit` |
| **Users** | `users:view` | `users:create`<br>`users:edit`<br>`users:delete`<br>`users:reset-password` |
| **Analytics** | `analytics:view`<br>`analytics:view:financial` | - |

### 3.3 Predefined Roles

| Role | Description | Key Permissions |
| :--- | :--- | :--- |
| **Owner** | Full access to everything | All permissions |
| **Manager** | Operations + financial visibility | All view permissions, limited edit (no user management) |
| **Operations** | Day-to-day order management | Orders (all), Inventory, Production - no cost viewing |
| **Warehouse** | Inward/outward processing | Inventory inward/outward, Production inward only |
| **Production** | Manufacturing oversight | Production domain only |
| **Accounts** | Financial data | All financial view permissions, remittance edit |
| **Viewer** | Read-only access | All non-confidential view permissions |
| **Custom** | User-defined | Per-user permission set |

## 4. Database Schema Changes

### New Models
```prisma
// New permission-related models to add to schema.prisma
model Role {
  id          String   @id @default(uuid())
  name        String   @unique  // owner, manager, operations, warehouse, etc.
  displayName String
  description String?
  permissions Json     // Array of permission strings
  isBuiltIn   Boolean  @default(false)  // Prevents deletion of system roles
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt
  
  users User[]
}

model UserPermissionOverride {
  id           String   @id @default(uuid())
  userId       String
  permission   String   // e.g., "products:view:cost"
  granted      Boolean  // true = explicitly grant, false = explicitly deny
  createdAt    DateTime @default(now())
  
  user User @relation(fields: [userId], references: [id], onDelete: Cascade)
  
  @@unique([userId, permission])
  @@index([userId])
}

model PermissionAuditLog {
  id           String   @id @default(uuid())
  userId       String
  action       String   // view, create, update, delete
  resource     String   // orders, products, etc.
  resourceId   String?
  details      Json?    // Additional context
  ipAddress    String?
  createdAt    DateTime @default(now())
  
  @@index([userId])
  @@index([resource])
  @@index([createdAt])
}
```

### User Model Update
```diff
model User {
  id        String   @id @default(uuid())
  email     String   @unique
  password  String
  name      String
- role      String   @default("staff")
+ roleId    String?
  isActive  Boolean  @default(true)
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
+ role                 Role?                     @relation(fields: [roleId], references: [id])
+ permissionOverrides  UserPermissionOverride[]
  
  // ... existing relations
}
```

## 5. Backend Implementation

### 5.1 Permission Middleware
```javascript
// server/src/middleware/permissions.js

// Check single permission
export const requirePermission = (permission) => (req, res, next) => {
  if (!hasPermission(req.user, permission)) {
    return res.status(403).json({ 
      error: 'Access denied',
      required: permission 
    });
  }
  next();
};

// Check any of multiple permissions
export const requireAnyPermission = (...permissions) => (req, res, next) => {
  if (!permissions.some(p => hasPermission(req.user, p))) {
    return res.status(403).json({ 
      error: 'Access denied',
      required: permissions 
    });
  }
  next();
};

// Field-level filtering based on permissions
export const filterConfidentialFields = (data, userPermissions) => {
  // Returns data with confidential fields removed or masked
};
```

### 5.2 API Response Filtering
All API endpoints returning confidential data will filter based on user permissions:

```javascript
// Example: Catalog endpoint
router.get('/sku-inventory', authenticateToken, async (req, res) => {
  const items = await fetchCatalogData();
  
  // Filter cost fields if user lacks permission
  const filtered = items.map(item => {
    if (!hasPermission(req.user, 'products:view:cost')) {
      delete item.fabricCost;
      delete item.laborCost;
      delete item.totalCost;
      delete item.costMultiple;
      // ... etc
    }
    return item;
  });
  
  res.json({ items: filtered });
});
```

### 5.3 Protected Endpoints

| Endpoint | Current Auth | Proposed Auth |
| :--- | :--- | :--- |
| `GET /catalog/sku-inventory` | `authenticateToken` | `authenticateToken` + filter costs |
| `PUT /products/:id/costing` | `authenticateToken` | `requirePermission('products:edit:cost')` |
| `POST /inventory/inward` | `authenticateToken` | `requirePermission('inventory:inward')` |
| `POST /orders/:id/ship` | `authenticateToken` | `requirePermission('orders:ship')` |
| `GET /admin/users` | `requireAdmin` | `requirePermission('users:view')` |
| `POST /remittance/upload` | `authenticateToken` | `requirePermission('returns:refund')` |

## 6. Frontend Implementation

### 6.1 Permission Context
```typescript
// client/src/hooks/usePermissions.ts
interface PermissionContext {
  permissions: string[];
  hasPermission: (permission: string) => boolean;
  hasAnyPermission: (...permissions: string[]) => boolean;
  canView: (domain: string) => boolean;
  canViewCosts: () => boolean;
  canEdit: (domain: string, action?: string) => boolean;
}

export const usePermissions = (): PermissionContext => {
  // ...
};
```

### 6.2 Permission-Aware Components

**Conditional rendering based on permissions**
```tsx
<PermissionGate permission="products:view:cost">
  <CostColumn />
</PermissionGate>
```

**Hide cost columns in AG-Grid when user lacks permission**
```typescript
const columns = useMemo(() => {
  const base = [...baseColumns];
  if (hasPermission('products:view:cost')) {
    base.push(costColumn, marginColumn, cogsColumn);
  }
  return base;
}, [hasPermission]);
```

### 6.3 Navigation Filtering
```typescript
// Layout.tsx - Filter nav items based on permissions
const navItems = useMemo(() => {
  return allNavItems.filter(item => {
    if (item.permission && !hasPermission(item.permission)) {
      return false;
    }
    return true;
  });
}, [hasPermission]);
```

## 7. AG-Grid Integration
The project uses AG-Grid extensively with shared utilities in `agGridColumns.ts`, `agGridHelpers.ts`, and a `ColumnVisibilityDropdown` component. This section details how permissions integrate with AG-Grid.

### 7.1 Column Visibility Control

**Current State:**
- 6 grid components (Orders, Shipped, RTO, COD Pending, Archived, Cancelled)
- Shared column builders in `agGridColumns.ts` (e.g., `createAmountColumn`, `createSkuColumn`)
- `ColumnVisibilityDropdown` component with localStorage persistence

**Proposed Enhancement:**

```typescript
// Enhanced column builder with permission awareness
// utils/agGridColumns.ts

interface PermissionAwareColumnOptions extends Partial<ColDef> {
  viewPermission?: string;   // Required permission to see column
  editPermission?: string;   // Required permission to edit cells
}

export const createAmountColumn = (
  field: string,
  headerName: string,
  options: PermissionAwareColumnOptions = {}
): ColDef | null => {
  const { viewPermission, editPermission, ...colOptions } = options;
  
  // Return null if user lacks view permission (column won't render)
  if (viewPermission && !hasPermission(viewPermission)) {
    return null;
  }
  
  return {
    field,
    headerName,
    width: 120,
    type: 'numericColumn',
    valueFormatter: (params) => formatCurrency(params.value),
    editable: editPermission 
      ? (params) => hasPermission(editPermission)
      : false,
    ...colOptions,
  };
};
```

### 7.2 Cost & Consumption Columns Configuration

| Column | View Permission | Edit Permission |
| :--- | :--- | :--- |
| `fabricCost` | `products:view:cost` | `products:edit:cost` |
| `laborCost` | `products:view:cost` | `products:edit:cost` |
| `trimsCost` | `products:view:cost` | `products:edit:cost` |
| `liningCost` | `products:view:cost` | `products:edit:cost` |
| `packagingCost` | `products:view:cost` | `products:edit:cost` |
| `totalCost` | `products:view:cost` | - (calculated) |
| `costMultiple` | `products:view:cost` | - (calculated) |
| `fabricConsumption` | `products:view:consumption` | `products:edit:consumption` |
| `targetStockQty` | `inventory:view` | `products:edit:inventory` |
| `totalAmount` | `orders:view:financial` | - |
| `unitPrice` | `orders:view:financial` | - |
| `refundAmount` | `returns:view:financial` | `returns:refund` |

### 7.3 Hook: usePermissionColumns

```typescript
// hooks/usePermissionColumns.ts
import { useMemo } from 'react';
import { usePermissions } from './usePermissions';

export function usePermissionColumns<T extends ColDef>(
  allColumns: (T | null)[],
  overrides?: Record<string, boolean>
): T[] {
  const { hasPermission } = usePermissions();
  
  return useMemo(() => {
    return allColumns
      .filter((col): col is T => col !== null)  // Remove permission-blocked columns
      .map(col => ({
        ...col,
        // Apply edit permission check to editable callback
        editable: col.editable 
          ? (params: any) => {
              const editPerm = (col as any).editPermission;
              if (editPerm && !hasPermission(editPerm)) return false;
              return typeof col.editable === 'function' 
                ? col.editable(params) 
                : col.editable;
            }
          : false,
      }));
  }, [allColumns, hasPermission, overrides]);
}
```

### 7.4 Usage in Grid Components

```typescript
// pages/Catalog.tsx
const baseColumns = useMemo(() => [
  createSkuColumn(),
  createProductColumn(),
  // Cost columns - only included if user has permission
  createAmountColumn('fabricCost', 'Fabric Cost', {
    viewPermission: 'products:view:cost',
    editPermission: 'products:edit:cost',
  }),
  createAmountColumn('laborCost', 'Labor Cost', {
    viewPermission: 'products:view:cost',
  }),
  createAmountColumn('totalCost', 'COGS', {
    viewPermission: 'products:view:cost',
  }),
], []);

const columns = usePermissionColumns(baseColumns);
```

### 7.5 ColumnVisibilityDropdown Enhancement
The existing `ColumnVisibilityDropdown` will be updated to:

- **Hide restricted columns** - Don't show toggle options for columns the user can't access
- **Persist separately** - Store visibility per user (not just localStorage)
- **Group by permission level** - Visual separation of "Standard" vs "Confidential" columns

```typescript
// Filtered column list based on permissions
const toggleableColumns = columnIds.filter(id => {
  const col = columnDefs.find(c => c.field === id);
  const viewPerm = (col as any)?.viewPermission;
  return !viewPerm || hasPermission(viewPerm);
});
```

### 7.6 Editable Cell Control
Current editable cells in the project:
- `Catalog.tsx`: `fabricConsumption`, `mrp`, `trimsCost`, `liningCost`, `packagingCost`
- `OrdersGrid.tsx`: Line allocation, refund amounts

Permission-based editable callback:

```typescript
// Before (current)
editable: true,

// After (with permissions)
editable: (params) => {
  if (!hasPermission('products:edit:cost')) return false;
  // Additional business logic (e.g., only editable for certain views)
  return viewLevel !== 'consumption';
},
```

### 7.7 Cell Editing Enforcement
Even if a cell shows as editable, the backend must validate permissions:

```javascript
// Backend: PUT /products/:id/costing
router.put('/:id/costing', 
  authenticateToken,
  requirePermission('products:edit:cost'),
  async (req, res) => {
    // Safe to update cost fields
  }
);
```
This creates defense in depth - both frontend and backend enforce permissions.

## 8. User Management UI

### 8.1 User List (Settings > Users)
![User Management Mockup]

Features:
- List all users with role, status, last login
- Quick role assignment dropdown
- Active/inactive toggle
- Link to detailed permission editor

### 8.2 Permission Editor
For each user:
- **Role Selection:** Dropdown with role templates
- **Permission Matrix:** Checkboxes grouped by domain
  - View permissions (columns by sensitivity level)
  - Edit permissions (columns by action type)
- **Override Indicator:** Visual marker for custom overrides
- **Preview Panel:** Shows effective permissions after overrides

### 8.3 Role Templates Management
- List predefined roles with permission counts
- Create custom role templates
- Duplicate and modify existing templates
- **Cannot delete built-in roles**

## 9. Implementation Phases

**Phase 1: Database & Core (Week 1) - COMPLETED**
- [x] Add new Prisma models (Role, UserPermissionOverride, PermissionAuditLog)
- [x] Create migration for User model changes
- [x] Seed default roles (Owner, Manager, Operations, Warehouse, Viewer)
- [x] Migrate existing admin users to Owner role, staff to Viewer role

**Phase 2: Backend Middleware (Week 1-2) - COMPLETED**
- [x] Create permission checking utilities
- [x] Create `requirePermission` middleware
- [x] Create field filtering utility for cost data
- [x] Update JWT to include permissions array (Implemented via `/login` and `/me` response)
- [x] Add audit logging for sensitive operations

**Phase 3: API Protection (Week 2) - COMPLETED**
- [x] Update all route files with appropriate permission checks
- [x] Implement response filtering for catalog/products endpoints (`filterConfidentialFields` applied)
- [x] Implement response filtering for orders endpoints (`filterConfidentialFields` applied)
- [ ] Add permission requirements to OpenAPI docs (deferred)

**Phase 4: Frontend Integration & AG-Grid (Week 2-3) - COMPLETED**
- [x] Create `usePermissions` hook
- [x] Create `PermissionGate` component
- [x] AG-Grid: Create `usePermissionColumns` hook
- [x] AG-Grid: Update column builders with `viewPermission`/`editPermission` options
- [x] Update navigation to filter restricted pages (permission-based nav filtering in Layout.tsx)
- [ ] AG-Grid: Update Catalog columns to use permission hooks (deferred - backend filtering handles security)
- [ ] Update `ColumnVisibilityDropdown` to respect permissions (deferred - backend filtering handles security)

**Phase 5: Admin UI (Week 3) - COMPLETED**
- [x] Create User Management page component (`client/src/pages/UserManagement.tsx`)
- [x] Create Permission Editor component (`client/src/components/admin/PermissionEditorModal.tsx`)
- [x] Create User Modal component (`client/src/components/admin/CreateUserModal.tsx`)
- [x] Add User Management navigation link with permission filtering
- [ ] Create Role Templates management (deferred - using role-based permissions)
- [ ] Add user invitation flow (deferred - direct user creation for now)
- [ ] Add password reset flow (admin-initiated) (deferred - admins can update password via user edit)

**Phase 6: Testing & Polish (Week 4) - NOT STARTED**
- [ ] Unit tests for permission utilities
- [ ] Integration tests for protected endpoints
- [ ] E2E tests for permission flows (including AG-Grid column visibility)
- [ ] Security audit for edge cases
- [ ] Documentation update

## 10. Verification Plan

### Automated Tests
**Permission Utility Tests**
```bash
npm test -- --grep "permissions"
```
- Test `hasPermission()` with various role/override combinations
- Test wildcard permissions (e.g., `products:*`)
- Test field filtering utility

**API Endpoint Tests**
- Test each protected endpoint with unauthorized user
- Test response filtering with/without cost permissions
- Test audit log creation

### Manual Verification
**Role Assignment Flow**
- Create test users with different roles
- Verify each role sees appropriate data
- Verify cost columns hidden for non-financial roles

**Permission Override Flow**
- Test granting specific permission to restricted role
- Test denying specific permission from privileged role
- Verify overrides take precedence over role

**Edge Cases**
- User with no role assigned
- Role with no permissions
- Simultaneous grant and deny override

## 11. Success Criteria

| Metric | Target |
| :--- | :--- |
| **Zero cost data leaks** | No cost/margin data visible to warehouse/production roles |
| **Permission check latency** | < 5ms added to request time |
| **Admin UI usability** | < 2 minutes to configure new user |
| **Audit log coverage** | 100% of edit operations logged |
| **Role coverage** | All existing users assigned appropriate role |

## 12. Security Considerations

- **Immediate Token Revocation:** When permissions change, revoke existing JWTs immediately using a token blacklist or version number in the user record
- **Permission Caching:** Cache user permissions in Redis but invalidate on role/override changes
- **Audit Log Retention:** Keep audit logs for at least 90 days (both edits and sensitive data views)
- **Failed Access Logging:** Log 403 responses for security monitoring
- **Rate Limiting:** Prevent brute-force permission discovery
- **Admin Password Reset:** Hash new passwords securely, force user to change on next login

## 13. Design Decisions (Resolved)

> [!NOTE]
> The following decisions have been confirmed by stakeholders:

| Question | Decision |
| :--- | :--- |
| **Role Hierarchy** | Independent - each role has its own permissions, no inheritance |
| **Permission Granularity** | Granular - separate permissions for inventory, cost, and consumption within products; delete permissions for inventory transactions |
| **Audit Log Depth** | Log both edits AND sensitive data views |
| **Password Reset** | Admin can directly reset user passwords |
| **Session Management** | Users logged out immediately when permissions change |

### User Review Required

> [!CAUTION]
> Before proceeding to implementation, please review:
>
> 1. The proposed role definitions and their default permissions
> 2. The data classification of fields (which fields are confidential)
> 3. The implementation timeline (4 weeks)
> 4. The open questions above
>
> Once approved, I will proceed with creating the detailed technical implementation plan and begin with Phase 1 (Database & Core changes).