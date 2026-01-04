# SQLite to Railway PostgreSQL Migration Plan

## Overview

Migrate COH-ERP2 database from SQLite (file-based) to Railway PostgreSQL (managed service).

| Aspect | Before | After |
|--------|--------|-------|
| Provider | SQLite (file) | PostgreSQL (Railway) |
| Concurrency | Single writer | Multi-writer (MVCC) |
| Data persistence | Ephemeral (container) | Persistent (managed) |
| Backups | Manual | Automatic |

---

## Railway PostgreSQL Connection

**Database URL Format**:
```
postgresql://postgres:<PASSWORD>@caboose.proxy.rlwy.net:20615/railway
```

> [!CAUTION]
> Never commit database passwords to git. Use environment variables or encrypted storage.

---

## Security: Handling Credentials

### Option 1: Environment Variable (Recommended for Production)

Set `DATABASE_URL` as Railway environment variable:
1. Railway Dashboard → Backend Service → Variables
2. Add: `DATABASE_URL` = `postgresql://postgres:<PASSWORD>@caboose.proxy.rlwy.net:20615/railway`

### Option 2: Settings UI (For Admin Configuration)

Add database password to Settings page, stored encrypted like Shopify credentials:

#### [MODIFY] server/prisma/schema.prisma

Already has `SystemSetting` model for encrypted storage.

#### [MODIFY] server/src/routes/admin.js

```javascript
// Get database config (masked)
router.get('/database-config', authenticateToken, requireAdmin, async (req, res) => {
    const setting = await req.prisma.systemSetting.findUnique({
        where: { key: 'database_password' }
    });
    res.json({
        host: 'caboose.proxy.rlwy.net',
        port: 20615,
        database: 'railway',
        user: 'postgres',
        hasPassword: !!setting?.value
    });
});

// Update database password (encrypted)
router.put('/database-config', authenticateToken, requireAdmin, async (req, res) => {
    const { password } = req.body;
    const encrypted = encrypt(password);
    await req.prisma.systemSetting.upsert({
        where: { key: 'database_password' },
        update: { value: encrypted },
        create: { key: 'database_password', value: encrypted }
    });
    res.json({ message: 'Database password updated' });
});
```

#### [MODIFY] client/src/pages/Settings.tsx

Add Database Configuration section in Settings UI.

---

## Pre-Migration Checklist

- [ ] Export current SQLite data as backup
- [x] Create PostgreSQL database on Railway ✅
- [ ] Update local development environment
- [ ] Test migration on staging before production

---

## Step 1: Update Schema Provider

### [MODIFY] server/prisma/schema.prisma

```diff
 datasource db {
-  provider = "sqlite"
+  provider = "postgresql"
   url      = env("DATABASE_URL")
 }
```

---

## Step 2: Update Environment Variables

### Local Development (server/.env)

```env
DATABASE_URL="postgresql://postgres:<PASSWORD>@caboose.proxy.rlwy.net:20615/railway"
```

> [!WARNING]
> Add `.env` to `.gitignore` to prevent accidental commits.

### Railway (Production)

Railway Variable:
```
DATABASE_URL=postgresql://postgres:<PASSWORD>@caboose.proxy.rlwy.net:20615/railway
```

---

## Step 3: Generate New Migration

```bash
cd server

# Reset Prisma migrations for PostgreSQL
rm -rf prisma/migrations

# Create initial PostgreSQL migration
npx prisma migrate dev --name init_postgres

# Generate Prisma client
npx prisma generate
```

---

## Step 4: Data Migration (If Needed)

### Option A: Start Fresh (Recommended for Dev)

Just deploy—new empty database will be created.

### Option B: Migrate Existing Data

1. **Export from SQLite**:
   ```bash
   sqlite3 prisma/dev.db .dump > backup.sql
   ```

2. **Convert to PostgreSQL format** (manual or use tool):
   - Fix datetime format (SQLite uses strings)
   - Fix boolean format (SQLite uses 0/1)
   - Remove SQLite-specific syntax

3. **Import to PostgreSQL**:
   ```bash
   psql $DATABASE_URL < backup_converted.sql
   ```

### Option C: Use Prisma Seed

If you have a seed file, just run:
```bash
npx prisma db seed
```

---

## Step 5: Deploy to Railway

```bash
git add .
git commit -m "chore: migrate to PostgreSQL"
git push
```

Railway will auto-deploy with the new PostgreSQL connection.

---

## Step 6: Verify Migration

1. Check Railway logs for successful startup
2. Test API endpoints:
   ```bash
   curl https://coh-erp2-production.up.railway.app/api/auth/me
   ```
3. Verify data in Railway PostgreSQL:
   - Railway → PostgreSQL → **Data** tab

---

## Code Changes Required

### None Expected

Prisma abstracts database differences. However, verify:

| SQLite | PostgreSQL | Status |
|--------|------------|--------|
| `String` for JSON | Works (can upgrade to `Json` later) | ✅ Compatible |
| `DateTime` | Native support | ✅ Compatible |
| `Boolean` | Native support | ✅ Compatible |
| `Float` | `Double precision` | ✅ Compatible |

---

## Rollback Plan

If migration fails:

1. Revert schema.prisma to `provider = "sqlite"`
2. Redeploy with SQLite
3. Data in Railway PostgreSQL remains untouched

---

## Post-Migration Improvements (Optional)

After successful migration, consider:

1. **Convert JSON strings to native JSONB**:
   ```prisma
   shippingAddress Json?  // Instead of String?
   ```

2. **Add PostgreSQL-specific indexes**:
   ```prisma
   @@index([status, orderDate])
   ```

3. **Use enums for type safety**:
   ```prisma
   enum OrderStatus {
     open
     shipped
     delivered
     cancelled
   }
   ```

---

## Implementation Checklist

### Migration
- [ ] Update schema.prisma provider to `postgresql`
- [ ] Set DATABASE_URL in Railway environment
- [ ] Generate Prisma migrations
- [ ] Deploy and verify

### Settings UI (Optional)
- [ ] Add database config API endpoints
- [ ] Add Settings UI section for database password
- [ ] Encrypt password using existing encryption utility

---

## Timeline

| Step | Time |
|------|------|
| Update schema.prisma | 1 min |
| Set environment variable | 2 min |
| Generate migrations | 2 min |
| Deploy | 5 min |
| Verify | 5 min |
| **Total** | **~15 min** |
