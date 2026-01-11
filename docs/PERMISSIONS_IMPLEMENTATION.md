# Permissions Quick Reference

> Concise guide for implementing permission checks. **Last updated: January 11, 2026**

See `PERMISSIONS_PLAN.md` for full architecture and design rationale.

---

## Permission String Format

```
<domain>:<action>
<domain>:<action>:<scope>
```

**Examples:** `orders:view`, `products:edit:cost`, `inventory:inward`

**Wildcards:** `products:*` matches all product permissions

---

## Backend: Adding Permission Checks

### Route-Level Protection

```javascript
import { requirePermission, requireAnyPermission } from '../middleware/permissions.js';

// Single permission
router.post('/inward',
  authenticateToken,
  requirePermission('inventory:inward'),
  asyncHandler(async (req, res) => { ... })
);

// Any of multiple permissions
router.get('/reports',
  authenticateToken,
  requireAnyPermission('analytics:view', 'orders:view:financial'),
  asyncHandler(async (req, res) => { ... })
);
```

### Response Filtering (Cost Data)

```javascript
import { filterConfidentialFields } from '../middleware/permissions.js';

router.get('/catalog', authenticateToken, asyncHandler(async (req, res) => {
  const items = await prisma.sku.findMany({ ... });
  const filtered = filterConfidentialFields(items, req.user.permissions);
  res.json({ items: filtered });
}));
```

### Check Permission in Handler

```javascript
import { hasPermission } from '../middleware/permissions.js';

if (hasPermission(req.user, 'products:view:cost')) {
  // Include cost fields
}
```

---

## Frontend: Permission-Aware Components

### Hook Usage

```typescript
import { usePermissions } from '../hooks/usePermissions';

function MyComponent() {
  const { hasPermission, canViewCosts, canEdit } = usePermissions();

  if (!hasPermission('inventory:view')) return null;

  return (
    <div>
      {canViewCosts() && <CostColumn />}
      {canEdit('orders', 'ship') && <ShipButton />}
    </div>
  );
}
```

### PermissionGate Component

```tsx
<PermissionGate permission="products:edit:cost">
  <EditCostButton />
</PermissionGate>
```

### AG-Grid Columns

```typescript
// Column hidden if user lacks permission
createAmountColumn('fabricCost', 'Fabric Cost', {
  viewPermission: 'products:view:cost',
  editPermission: 'products:edit:cost',
});
```

---

## Common Permission Patterns by Domain

| Domain | View | Edit |
|--------|------|------|
| Orders | `orders:view`, `orders:view:financial` | `orders:ship`, `orders:allocate`, `orders:cancel` |
| Products | `products:view`, `products:view:cost` | `products:edit`, `products:edit:cost` |
| Inventory | `inventory:view` | `inventory:inward`, `inventory:outward` |
| Returns | `returns:view`, `returns:view:financial` | `returns:process`, `returns:refund` |
| Users | `users:view` | `users:create`, `users:edit`, `users:delete` |

---

## Token Invalidation

When user permissions change:
1. Server increments `user.tokenVersion`
2. Existing JWT becomes invalid
3. User must re-login to get new permissions

**Handled by:** `authenticateToken` middleware checks `tokenVersion` against JWT claim.

---

## Audit Logging

All permission-protected actions are automatically logged to `PermissionAuditLog`:
- User ID, action, resource, timestamp
- IP address (if available)
- Additional context in `details` JSON field

---

## Gotchas

1. **Backend is source of truth** - Frontend filtering is UX only; always enforce server-side
2. **Wildcard matching** - `products:*` grants all `products:` permissions
3. **Override precedence** - User overrides > Role permissions
4. **Token caching** - After permission change, user must re-login
5. **Cost fields** - Use `filterConfidentialFields()` for any endpoint returning financial data
