# Admin Domain

> User management, authentication, permissions, system settings, and operational tools.

## Quick Reference

| Aspect | Value |
|--------|-------|
| Routes | `server/src/routes/admin.ts`, `auth.ts` |
| Key Files | `middleware/auth.ts`, `middleware/permissions.ts` |
| Frontend | `hooks/usePermissions.ts` |
| Related | All domains (permission-gated) |

## Authentication Flow

```
POST /auth/login
    → Validate credentials
    → Check user.isActive
    → Generate JWT { id, email, role, roleId, tokenVersion }
    → Return { user, permissions[], token }

GET /auth/me (with Bearer token)
    → Verify JWT
    → Validate tokenVersion matches DB
    → Calculate effective permissions
    → Return user + permissions[]
```

**Token invalidation**: Permission/role changes increment `tokenVersion`, invalidating all existing tokens.

## Permission System

**Roles are database-driven** - permissions stored as JSON array in `Role.permissions` field. No hardcoded hierarchy.

**Permission format**: `domain:action` or `domain:action:scope`

```
orders:ship           # Exact permission
products:*            # Domain wildcard
*                     # Global wildcard (owner only)
```

**Permission resolution** (from `middleware/permissions.ts`):
1. Load user's `userRole.permissions` array from database
2. Fallback: Legacy `role='admin'` users get `*` wildcard if no `roleId`
3. Apply overrides: `rolePermissions + grantedOverrides - deniedOverrides`

**Checking permissions**:
```typescript
// Server: middleware/permissions.ts
hasPermission(userPermissions, 'orders:ship')  // Single check
hasAnyPermission(userPermissions, 'orders:ship', 'orders:*')  // Any match
requirePermission('orders:ship')  // Express middleware

// Client: hooks/usePermissions.ts
const { hasPermission, isManager, isOwner } = usePermissions();
// isManager = roleName === 'Owner' || roleName === 'Manager'
```

## System Settings

| Key | Purpose |
|-----|---------|
| `tier_thresholds` | Customer LTV tiers |
| `grid_preferences_{gridId}` | Column preferences |
| `shopify_config` | Shopify credentials (encrypted) |
| `ithink_config` | iThink credentials |

## Background Jobs

| Job ID | Schedule |
|--------|----------|
| `shopify_sync` | Configurable interval |
| `tracking_sync` | Every 30 min |
| `cache_cleanup` | Daily 2 AM |
| `auto_archive` | Server startup |

**Trigger manually**: `POST /admin/background-jobs/:jobId/trigger`

## Key Endpoints

| Path | Purpose |
|------|---------|
| `POST /auth/login` | Authenticate, return JWT |
| `GET /auth/me` | Current user + permissions |
| `PUT /admin/users/:id/role` | Assign role (forces re-login) |
| `PUT /admin/users/:id/permissions` | Set permission overrides |
| `GET /admin/logs` | View server logs |
| `POST /admin/background-jobs/:jobId/trigger` | Run job immediately |

## Cross-Domain

- **→ All domains**: Permission middleware gates all routes
- **← All domains**: Settings stored for domain-specific configs

## Gotchas

1. **Cannot delete last admin**: Both `role=admin` and `roleId=owner` protected
2. **Cannot delete self**: Users cannot delete their own account
3. **Role changes force re-login**: tokenVersion increment invalidates sessions
4. **Override auto-cleanup**: Overrides matching role defaults are deleted
5. **Legacy admin fallback**: Users with `role='admin'` but no `roleId` get `*` wildcard
6. **requireAdmin deprecated**: Use `requirePermission('users:*')` instead
7. **Grid prefs precedence**: Server preferences override localStorage on page load
8. **Logs persistent**: `server/logs/server.jsonl`, 24-hour retention
9. **PermissionAuditLog silently fails**: Table may not exist; errors caught in `logAuditEvent()`
10. **isManager check (frontend)**: Based on `roleName` string match, not permission check
