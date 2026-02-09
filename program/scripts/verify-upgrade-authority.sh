#!/bin/bash

# Script to verify the upgrade authority of a Solana program
# Usage: ./verify-upgrade-authority.sh [mainnet|devnet]

set -e

CLUSTER=${1:-mainnet}
PROGRAM_ID="GaVb9PQr9eTnFe6zVAKwUyfCCDbp7dR1KqdJrFnQRexQ"

echo "🔍 Verifying program upgrade authority..."
echo "Program ID: $PROGRAM_ID"
echo "Cluster: $CLUSTER"
echo ""

# Configure the cluster
if [ "$CLUSTER" = "mainnet" ]; then
    solana config set --url https://api.mainnet-beta.solana.com
elif [ "$CLUSTER" = "devnet" ]; then
    solana config set --url https://api.devnet.solana.com
else
    echo "❌ Invalid cluster. Use 'mainnet' or 'devnet'"
    exit 1
fi

echo "📋 Current Solana configuration:"
solana config get
echo ""

# Get the current wallet address
CURRENT_WALLET=$(solana address)
echo "💼 Current wallet: $CURRENT_WALLET"
echo ""

# Check program information
echo "📦 Program information:"
PROGRAM_INFO=$(solana program show "$PROGRAM_ID" --output json 2>/dev/null || echo "{}")

if [ "$PROGRAM_INFO" = "{}" ]; then
    echo "⚠️  Program does not exist yet on $CLUSTER"
    echo "   It will be deployed with your current wallet as upgrade authority"
    echo ""
    echo "✅ Your current wallet ($CURRENT_WALLET) will be the upgrade authority"
    exit 0
fi

# Extract upgrade authority from JSON information
UPGRADE_AUTHORITY=$(echo "$PROGRAM_INFO" | grep -o '"authority":"[^"]*"' | cut -d'"' -f4 || echo "")

if [ -z "$UPGRADE_AUTHORITY" ]; then
    # Try different parsing
    UPGRADE_AUTHORITY=$(echo "$PROGRAM_INFO" | grep -o '"authority":\s*"[^"]*"' | sed 's/.*"authority":\s*"\([^"]*\)".*/\1/' || echo "")
fi

# If still empty, display raw info
if [ -z "$UPGRADE_AUTHORITY" ]; then
    echo "📄 Full program information:"
    solana program show "$PROGRAM_ID"
    echo ""
    echo "⚠️  Unable to automatically extract upgrade authority"
    echo "   Please verify manually in the information above"
    exit 1
fi

echo "🔑 Program Upgrade Authority: $UPGRADE_AUTHORITY"
echo ""

# Compare with current wallet
if [ "$UPGRADE_AUTHORITY" = "$CURRENT_WALLET" ]; then
    echo "✅ SUCCESS: Your current wallet is the upgrade authority!"
    echo "   You can upgrade and delete the program."
else
    echo "❌ WARNING: Upgrade authority does not match your wallet!"
    echo "   Upgrade Authority: $UPGRADE_AUTHORITY"
    echo "   Your wallet:       $CURRENT_WALLET"
    echo ""
    echo "⚠️  You will NOT be able to upgrade or delete the program with this wallet."
    echo "   Make sure you're using the correct wallet for deployment."
    exit 1
fi
