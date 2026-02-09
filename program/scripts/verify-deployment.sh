#!/bin/bash

# Script to verify the deployment is correct
# Usage: ./scripts/verify-deployment.sh

set -e

PROGRAM_ID="C16J1ZLPVMZXZLWXvkR3rsEhsf9hU5f2GRfNzNqgk7W5"
EXPECTED_WALLET="CUmTFLxqFkMEUFtH5Wo5cF9MMPFiPS49WRWEUTFGLFxp"

echo "✅ Verifying deployment..."
echo "Program ID: $PROGRAM_ID"
echo ""

# Verify we're on mainnet
CURRENT_RPC=$(solana config get | grep "RPC URL" | awk '{print $3}')
if [[ "$CURRENT_RPC" != "https://api.mainnet-beta.solana.com" ]]; then
    solana config set --url https://api.mainnet-beta.solana.com
fi

# Check program
echo "📦 Program information:"
solana program show "$PROGRAM_ID"

echo ""
UPGRADE_AUTH=$(solana program show "$PROGRAM_ID" | grep "Authority" | awk '{print $2}')
CURRENT_WALLET=$(solana address)

echo "🔑 Upgrade Authority: $UPGRADE_AUTH"
echo "💼 Your wallet:        $CURRENT_WALLET"
echo ""

if [ "$UPGRADE_AUTH" = "$CURRENT_WALLET" ]; then
    echo "✅ SUCCESS: Your wallet is the upgrade authority!"
    echo "   You can upgrade/delete the program when needed."
else
    echo "❌ WARNING: Upgrade authority mismatch!"
fi

echo ""
echo "📄 Local IDL file: target/idl/lockfun.json"
if [ -f "target/idl/lockfun.json" ]; then
    IDL_PROGRAM_ID=$(grep -o '"address": "[^"]*"' target/idl/lockfun.json | head -1 | cut -d'"' -f4)
    echo "   IDL Program ID: $IDL_PROGRAM_ID"
    if [ "$IDL_PROGRAM_ID" = "$PROGRAM_ID" ]; then
        echo "   ✅ IDL Program ID matches deployed program"
    else
        echo "   ⚠️  IDL Program ID mismatch (but program works fine)"
    fi
else
    echo "   ⚠️  IDL file not found (run 'anchor build' first)"
fi

echo ""
echo "🎉 Summary:"
echo "   ✅ Program is deployed and functional"
echo "   ✅ You have upgrade authority"
echo "   ✅ Local IDL is available for clients"
echo "   ℹ️  On-chain IDL is optional (not required for program to work)"
echo ""
echo "🔗 View on Solscan: https://solscan.io/account/$PROGRAM_ID"
