#!/bin/bash

# Script to fix IDL after deployment with mismatched Program ID
# Usage: ./scripts/fix-idl-mainnet.sh

set -e

PROGRAM_ID="C16J1ZLPVMZXZLWXvkR3rsEhsf9hU5f2GRfNzNqgk7W5"

echo "🔧 Fixing IDL for deployed program..."
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
solana program show "$PROGRAM_ID"
echo ""

# Rebuild with correct Program ID
echo "🔨 Rebuilding with correct Program ID..."
anchor build

# Deploy IDL only (program is already deployed)
echo ""
echo "📤 Deploying IDL to mainnet..."
anchor idl init --filepath target/idl/lockfun.json "$PROGRAM_ID" --provider.cluster mainnet

echo ""
echo "✅ IDL deployed successfully!"
echo ""
echo "🎉 Program is now fully deployed:"
echo "   Program ID: $PROGRAM_ID"
echo "   View on Solscan: https://solscan.io/account/$PROGRAM_ID"
