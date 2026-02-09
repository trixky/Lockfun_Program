#!/bin/bash

# Script to upgrade the program on mainnet with correct Program ID
# Usage: ./scripts/upgrade-mainnet.sh

set -e

PROGRAM_ID="C16J1ZLPVMZXZLWXvkR3rsEhsf9hU5f2GRfNzNqgk7W5"

echo "🔄 Upgrading program on MAINNET..."
echo "Program ID: $PROGRAM_ID"
echo ""

# Verify we're on mainnet
CURRENT_RPC=$(solana config get | grep "RPC URL" | awk '{print $3}')
if [[ "$CURRENT_RPC" != "https://api.mainnet-beta.solana.com" ]]; then
    echo "⚠️  Setting RPC to mainnet..."
    solana config set --url https://api.mainnet-beta.solana.com
fi

# Get current wallet
CURRENT_WALLET=$(solana address)
echo "💼 Current wallet: $CURRENT_WALLET"
echo ""

# Check program exists and verify upgrade authority
echo "🔍 Verifying program and upgrade authority..."
if ! solana program show "$PROGRAM_ID" &>/dev/null; then
    echo "❌ Program not found! Please deploy first."
    exit 1
fi

UPGRADE_AUTH=$(solana program show "$PROGRAM_ID" | grep "Authority" | awk '{print $2}')
echo "🔑 Current Upgrade Authority: $UPGRADE_AUTH"
echo "💼 Your wallet:                $CURRENT_WALLET"
echo ""

if [ "$UPGRADE_AUTH" != "$CURRENT_WALLET" ]; then
    echo "❌ ERROR: Your wallet is NOT the upgrade authority!"
    echo "   You cannot upgrade this program with the current wallet."
    exit 1
fi

echo "✅ You have upgrade authority. Proceeding..."
echo ""

# Rebuild with correct Program ID
echo "🔨 Rebuilding with correct Program ID..."
anchor build

# Upgrade the program
echo ""
echo "📤 Upgrading program on MAINNET..."
echo "⚠️  This will cost real SOL!"
echo ""

solana program deploy --program-id "$PROGRAM_ID" target/deploy/lockfun.so

echo ""
echo "✅ Program upgraded successfully!"
echo ""

# Now deploy IDL
echo "📤 Deploying IDL..."
anchor idl init --filepath target/idl/lockfun.json "$PROGRAM_ID" --provider.cluster mainnet

echo ""
echo "✅ IDL deployed successfully!"
echo ""
echo "🎉 Program is now fully deployed and upgraded:"
echo "   Program ID: $PROGRAM_ID"
echo "   Upgrade Authority: $CURRENT_WALLET"
echo "   View on Solscan: https://solscan.io/account/$PROGRAM_ID"
