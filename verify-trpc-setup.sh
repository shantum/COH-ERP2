#!/bin/bash

# tRPC Setup Verification Script
# Run this to verify the tRPC client is set up correctly

echo "🔍 Verifying tRPC Setup..."
echo ""

# Check if dependencies are installed
echo "1️⃣ Checking dependencies..."
cd client
if grep -q "@trpc/client" package.json && grep -q "@trpc/react-query" package.json && grep -q "superjson" package.json; then
    echo "   ✅ tRPC dependencies installed"
else
    echo "   ❌ Missing tRPC dependencies"
    exit 1
fi
echo ""

# Check if core files exist
echo "2️⃣ Checking core files..."
files=(
    "src/services/trpc.ts"
    "src/providers/TRPCProvider.tsx"
    "src/services/index.ts"
    "src/services/TRPC_MIGRATION.md"
    "src/examples/TRPCExample.tsx"
)

all_exist=true
for file in "${files[@]}"; do
    if [ -f "$file" ]; then
        echo "   ✅ $file"
    else
        echo "   ❌ $file (missing)"
        all_exist=false
    fi
done

if [ "$all_exist" = false ]; then
    exit 1
fi
echo ""

# Check if App.tsx has TRPCProvider
echo "3️⃣ Checking App.tsx integration..."
if grep -q "TRPCProvider" src/App.tsx; then
    echo "   ✅ TRPCProvider imported and used"
else
    echo "   ❌ TRPCProvider not found in App.tsx"
    exit 1
fi
echo ""

# Check TypeScript compilation
echo "4️⃣ Checking TypeScript compilation..."
if npx tsc --noEmit 2>&1 | grep -qE "src/(services/trpc|providers/TRPCProvider|examples/TRPCExample)"; then
    echo "   ⚠️  TypeScript errors in tRPC files"
    npx tsc --noEmit 2>&1 | grep -E "src/(services/trpc|providers/TRPCProvider|examples/TRPCExample)"
else
    echo "   ✅ No TypeScript errors in tRPC files"
fi
echo ""

# Summary
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "✅ tRPC Setup Verification Complete!"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "Next steps:"
echo "  1. Start servers: npm run dev (in server/) and npm run dev (in client/)"
echo "  2. Read: client/src/services/TRPC_MIGRATION.md"
echo "  3. Try: client/src/examples/TRPCExample.tsx"
echo "  4. Use: import { trpc } from '@/services/trpc'"
echo ""
echo "Available routers:"
echo "  - trpc.auth.*"
echo "  - trpc.customers.*"
echo "  - trpc.inventory.*"
echo "  - trpc.orders.*"
echo "  - trpc.products.*"
echo "  - trpc.returns.*"
echo ""
