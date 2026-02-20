#!/bin/bash
# Push to GitHub and deploy to Hetzner
set -e
git push origin main
echo "🚀 Deploying to Hetzner..."
ssh root@128.140.98.253 'cd /app/COH-ERP2 && set -a && source server/.env && set +a && git pull origin main && pnpm install --frozen-lockfile && npx prisma generate && npx prisma migrate deploy --schema=prisma/schema.prisma && cd client && pnpm build && cd .. && pm2 restart coh-erp && echo "✅ Deployed: $(git log -1 --oneline)"'
