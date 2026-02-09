#!/bin/bash

# Script to delete program and redeploy (WARNING: Changes Program ID!)
# Usage: ./scripts/delete-and-redeploy.sh [mainnet|devnet]

set -e

CLUSTER=${1:-mainnet}
PROGRAM_ID="C16J1ZLPVMZXZLWXvkR3rsEhsf9hU5f2GRfNzNqgk7W5"

echo "⚠️  DELETE AND REDEPLOY SCRIPT"
echo "=============================="
echo ""
echo "⚠️  WARNING: This will DELETE the program and create a NEW one!"
echo "   - You will get back ~2.27 SOL (rent)"
echo "   - But you will get a NEW Program ID"
echo "   - All existing PDAs will become INVALID"
echo ""
echo "Program ID to delete: $PROGRAM_ID"
echo "Cluster: $CLUSTER"
echo ""

# Verify we're on the right cluster
if [ "$CLUSTER" = "mainnet" ]; then
    solana config set --url https://api.mainnet-beta.solana.com
elif [ "$CLUSTER" = "devnet" ]; then
    solana config set --url https://api.devnet.solana.com
else
    echo "❌ Invalid cluster. Use 'mainnet' or 'devnet'"
    exit 1
fi

# Get current wallet
CURRENT_WALLET=$(solana address)
echo "💼 Current wallet: $CURRENT_WALLET"
echo ""

# Check program exists and verify upgrade authority
echo "🔍 Verifying program and upgrade authority..."
if ! solana program show "$PROGRAM_ID" &>/dev/null; then
    echo "❌ Program not found!"
    exit 1
fi

UPGRADE_AUTH=$(solana program show "$PROGRAM_ID" | grep "Authority" | awk '{print $2}')
echo "🔑 Upgrade Authority: $UPGRADE_AUTH"
echo "💼 Your wallet:       $CURRENT_WALLET"
echo ""

if [ "$UPGRADE_AUTH" != "$CURRENT_WALLET" ]; then
    echo "❌ ERROR: Your wallet is NOT the upgrade authority!"
    echo "   You cannot delete this program."
    exit 1
fi

# Get program balance
PROGRAM_BALANCE=$(solana program show "$PROGRAM_ID" | grep "Balance" | awk '{print $1}')
echo "💰 Program balance: $PROGRAM_BALANCE SOL (will be recovered)"
echo ""

# Final confirmation
echo "⚠️  FINAL WARNING:"
echo "   - This will DELETE the program"
echo "   - You will get a NEW Program ID"
echo "   - All existing accounts/PDAs will be INVALID"
echo ""
read -p "Type 'DELETE' to confirm: " CONFIRM

if [ "$CONFIRM" != "DELETE" ]; then
    echo "❌ Cancelled."
    exit 1
fi

# Delete the program
echo ""
echo "🗑️  Deleting program..."
solana program close "$PROGRAM_ID" --bypass-warning

echo ""
echo "✅ Program deleted!"
echo "💰 You should have recovered ~$PROGRAM_BALANCE SOL"
echo ""

# Generate new keypair
echo "🔑 Generating new keypair..."
rm -f target/deploy/lockfun-keypair.json
anchor keys list

# Get new Program ID
NEW_PROGRAM_ID=$(solana-keygen pubkey target/deploy/lockfun-keypair.json)
echo "🆕 New Program ID: $NEW_PROGRAM_ID"
echo ""

# Update declare_id in source
echo "📝 Updating declare_id in source code..."
sed -i "s/declare_id!(\"[^\"]*\");/declare_id!(\"$NEW_PROGRAM_ID\");/" programs/lockfun/src/lib.rs

# Update Anchor.toml
echo "📝 Updating Anchor.toml..."
if [ "$CLUSTER" = "mainnet" ]; then
    sed -i "s/\[programs.mainnet\]/\[programs.mainnet\]/" Anchor.toml
    sed -i "s/lockfun = \"[^\"]*\"/lockfun = \"$NEW_PROGRAM_ID\"/" Anchor.toml
fi

# Build
echo ""
echo "🔨 Building with new Program ID..."
anchor build

# Deploy
echo ""
echo "📤 Deploying new program..."
anchor deploy --provider.cluster "$CLUSTER"

echo ""
echo "✅ New program deployed!"
echo "   Old Program ID: $PROGRAM_ID (DELETED)"
echo "   New Program ID: $NEW_PROGRAM_ID"
echo ""
echo "⚠️  Remember: The Program ID has changed!"
echo "   Update all references in your frontend/client code."
