#!/bin/bash
# Push to GitHub and deploy to Hetzner
set -e
git push origin main
COMMIT=$(git log -1 --oneline)
echo "🚀 Deploying to Hetzner..."
ssh root@128.140.98.253 "cd /app/COH-ERP2 && set -a && source server/.env && set +a && git pull origin main && pnpm install --frozen-lockfile && npx prisma generate && npx prisma migrate deploy --schema=prisma/schema.prisma && cd client && pnpm build && cd .. && (pm2 delete coh-erp || true) && pm2 start ecosystem.config.cjs && bash scripts/slack-alert.sh success 'Deploy Successful' 'Deployed: \`$COMMIT\`' && echo '✅ Deployed: $COMMIT'" \
  || ssh root@128.140.98.253 "cd /app/COH-ERP2 && bash scripts/slack-alert.sh error 'Deploy Failed' 'Failed deploying: \`$COMMIT\`\nCheck server logs.'"
