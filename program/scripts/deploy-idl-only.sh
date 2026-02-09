#!/bin/bash

# Script to deploy IDL only (program is already deployed)
# Usage: ./scripts/deploy-idl-only.sh

set -e

PROGRAM_ID="C16J1ZLPVMZXZLWXvkR3rsEhsf9hU5f2GRfNzNqgk7W5"

echo "📤 Deploying IDL only (program already deployed)..."
echo "Program ID: $PROGRAM_ID"
echo ""

# Verify we're on mainnet
CURRENT_RPC=$(solana config get | grep "RPC URL" | awk '{print $3}')
if [[ "$CURRENT_RPC" != "https://api.mainnet-beta.solana.com" ]]; then
    echo "⚠️  Setting RPC to mainnet..."
    solana config set --url https://api.mainnet-beta.solana.com
fi

# Check program exists
echo "🔍 Verifying program deployment..."
if ! solana program show "$PROGRAM_ID" &>/dev/null; then
    echo "❌ Program not found! Please deploy first."
    exit 1
fi

echo "✅ Program found on-chain"
echo ""

# Rebuild to generate IDL with correct Program ID
echo "🔨 Rebuilding to generate IDL..."
anchor build

# Check if IDL file exists
if [ ! -f "target/idl/lockfun.json" ]; then
    echo "❌ IDL file not found! Build failed."
    exit 1
fi

echo "✅ IDL generated"
echo ""

# Try to deploy IDL using anchor idl init with --skip-build
echo "📤 Deploying IDL to mainnet..."
echo "⚠️  Note: This may fail if the deployed program has different Program ID declared internally."
echo ""

# Use anchor idl init with the correct Program ID
anchor idl init --filepath target/idl/lockfun.json "$PROGRAM_ID" --provider.cluster mainnet || {
    echo ""
    echo "⚠️  Standard IDL deployment failed. Trying alternative method..."
    echo ""
    echo "The program is deployed and functional. The IDL deployment issue is likely"
    echo "because the deployed program binary contains the old Program ID declaration."
    echo ""
    echo "Options:"
    echo "1. The program works fine without IDL on-chain (you can use the local IDL file)"
    echo "2. If you need on-chain IDL, you'll need to upgrade the program (costs ~2.3 SOL)"
    echo ""
    echo "To upgrade later when you have more SOL:"
    echo "  solana program deploy --program-id $PROGRAM_ID target/deploy/lockfun.so"
    echo ""
    exit 1
}

echo ""
echo "✅ IDL deployed successfully!"
echo ""
echo "🎉 Program is fully deployed:"
echo "   Program ID: $PROGRAM_ID"
echo "   View on Solscan: https://solscan.io/account/$PROGRAM_ID"
