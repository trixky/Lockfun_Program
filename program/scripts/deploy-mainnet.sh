#!/bin/bash

# Script to deploy the lockfun program to mainnet
# Usage: ./scripts/deploy-mainnet.sh

set -e

PROGRAM_ID="GaVb9PQr9eTnFe6zVAKwUyfCCDbp7dR1KqdJrFnQRexQ"

echo "🚀 Deploying lockfun program to MAINNET"
echo "========================================"
echo ""

# Verify we're on mainnet
echo "📋 Checking Solana configuration..."
CURRENT_RPC=$(solana config get | grep "RPC URL" | awk '{print $3}')
if [[ "$CURRENT_RPC" != "https://api.mainnet-beta.solana.com" ]]; then
    echo "⚠️  Setting RPC to mainnet..."
    solana config set --url https://api.mainnet-beta.solana.com
fi

# Get current wallet
CURRENT_WALLET=$(solana address)
CURRENT_BALANCE=$(solana balance | awk '{print $1}')
echo "💼 Current wallet: $CURRENT_WALLET"
echo "💰 Balance: $CURRENT_BALANCE SOL"
echo ""

# Check if program already exists
echo "🔍 Checking if program already exists..."
if solana program show "$PROGRAM_ID" &>/dev/null; then
    echo "⚠️  Program already exists on mainnet!"
    echo ""
    echo "📦 Program information:"
    solana program show "$PROGRAM_ID"
    echo ""
    
    # Extract upgrade authority
    UPGRADE_AUTH=$(solana program show "$PROGRAM_ID" | grep "Authority" | awk '{print $2}')
    echo "🔑 Current Upgrade Authority: $UPGRADE_AUTH"
    echo "💼 Your wallet:                $CURRENT_WALLET"
    echo ""
    
    if [ "$UPGRADE_AUTH" = "$CURRENT_WALLET" ]; then
        echo "✅ Your wallet is the upgrade authority. Proceeding with upgrade..."
        echo ""
        read -p "Press Enter to continue with upgrade, or Ctrl+C to cancel..."
    else
        echo "❌ ERROR: Your wallet is NOT the upgrade authority!"
        echo "   You cannot deploy/upgrade this program with the current wallet."
        exit 1
    fi
else
    echo "✅ Program does not exist yet. This will be a fresh deployment."
    echo "   Your wallet ($CURRENT_WALLET) will become the upgrade authority."
    echo ""
    read -p "Press Enter to continue with deployment, or Ctrl+C to cancel..."
fi

# Build the program
echo ""
echo "🔨 Building program..."
anchor build

# Check if build was successful
if [ ! -f "target/deploy/lockfun.so" ]; then
    echo "❌ Build failed! lockfun.so not found."
    exit 1
fi

# Deploy to mainnet
echo ""
echo "📤 Deploying to MAINNET..."
echo "⚠️  This will cost real SOL!"
echo ""

anchor deploy --provider.cluster mainnet

echo ""
echo "✅ Deployment complete!"
echo ""
echo "🔍 Verifying deployment..."
solana program show "$PROGRAM_ID"

echo ""
echo "🎉 Success! Program deployed to mainnet:"
echo "   Program ID: $PROGRAM_ID"
echo "   Upgrade Authority: $CURRENT_WALLET"
echo ""
echo "🔗 View on Solscan: https://solscan.io/account/$PROGRAM_ID"
