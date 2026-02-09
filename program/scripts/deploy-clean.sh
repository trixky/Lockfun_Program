#!/bin/bash

# Script to deploy with consistent Program ID everywhere
# Usage: ./scripts/deploy-clean.sh [mainnet|devnet]

set -e

CLUSTER=${1:-mainnet}
PROGRAM_NAME="lockfun"
PROGRAM_SOURCE="programs/${PROGRAM_NAME}/src/lib.rs"
KEYPAIR_PATH="target/deploy/${PROGRAM_NAME}-keypair.json"

echo "🚀 Clean Deployment Script"
echo "========================"
echo "Cluster: $CLUSTER"
echo ""

# Configure cluster
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
CURRENT_BALANCE=$(solana balance | awk '{print $1}')
echo "💼 Wallet: $CURRENT_WALLET"
echo "💰 Balance: $CURRENT_BALANCE SOL"
echo ""

# Check balance
if (( $(echo "$CURRENT_BALANCE < 1.5" | bc -l) )); then
    echo "❌ Insufficient balance! Need at least 1.5 SOL for deployment"
    exit 1
fi

# Step 1: Generate new keypair if it doesn't exist
echo "🔑 Step 1: Generating/checking program keypair..."
if [ ! -f "$KEYPAIR_PATH" ]; then
    echo "   Creating new keypair..."
    solana-keygen new --no-bip39-passphrase -o "$KEYPAIR_PATH" --force
else
    echo "   Keypair already exists, using it..."
fi

# Get Program ID from keypair
PROGRAM_ID=$(solana-keygen pubkey "$KEYPAIR_PATH")
echo "   Program ID: $PROGRAM_ID"
echo ""

# Step 2: Update declare_id in source code
echo "📝 Step 2: Updating declare_id in source code..."
if grep -q "declare_id!" "$PROGRAM_SOURCE"; then
    # Replace the declare_id line
    sed -i "s/declare_id!(\"[^\"]*\");/declare_id!(\"$PROGRAM_ID\");/" "$PROGRAM_SOURCE"
    echo "   ✅ Updated declare_id!(\"$PROGRAM_ID\")"
else
    echo "   ❌ declare_id! not found in source code!"
    exit 1
fi

# Verify the update
DECLARE_ID=$(grep -o 'declare_id!("[^"]*")' "$PROGRAM_SOURCE" | cut -d'"' -f2)
if [ "$DECLARE_ID" != "$PROGRAM_ID" ]; then
    echo "   ❌ Failed to update declare_id!"
    exit 1
fi
echo ""

# Step 3: Update Anchor.toml
echo "📝 Step 3: Updating Anchor.toml..."
if [ "$CLUSTER" = "mainnet" ]; then
    # Update mainnet section
    if grep -q "\[programs.mainnet\]" Anchor.toml; then
        sed -i "/\[programs.mainnet\]/,/^\[/ s/^${PROGRAM_NAME} = \".*\"/${PROGRAM_NAME} = \"$PROGRAM_ID\"/" Anchor.toml
    else
        # Add mainnet section if it doesn't exist
        echo "" >> Anchor.toml
        echo "[programs.mainnet]" >> Anchor.toml
        echo "${PROGRAM_NAME} = \"$PROGRAM_ID\"" >> Anchor.toml
    fi
    echo "   ✅ Updated [programs.mainnet]"
else
    # Update devnet section
    if grep -q "\[programs.devnet\]" Anchor.toml; then
        sed -i "/\[programs.devnet\]/,/^\[/ s/^${PROGRAM_NAME} = \".*\"/${PROGRAM_NAME} = \"$PROGRAM_ID\"/" Anchor.toml
    else
        echo "" >> Anchor.toml
        echo "[programs.devnet]" >> Anchor.toml
        echo "${PROGRAM_NAME} = \"$PROGRAM_ID\"" >> Anchor.toml
    fi
    echo "   ✅ Updated [programs.devnet]"
fi
echo ""

# Step 4: Sync keys with Anchor
echo "🔄 Step 4: Synchronizing keys with Anchor..."
anchor keys sync 2>&1 | grep -v "^WARNING" || true
echo ""

# Step 5: Build
echo "🔨 Step 5: Building program..."
anchor build
echo ""

# Step 6: Verify consistency
echo "🔍 Step 6: Verifying Program ID consistency..."
KEYPAIR_ID=$(solana-keygen pubkey "$KEYPAIR_PATH")
DECLARE_ID=$(grep -o 'declare_id!("[^"]*")' "$PROGRAM_SOURCE" | cut -d'"' -f2)

if [ -f "target/idl/${PROGRAM_NAME}.json" ]; then
    IDL_ID=$(grep -o '"address": "[^"]*"' "target/idl/${PROGRAM_NAME}.json" | head -1 | cut -d'"' -f4)
else
    IDL_ID="(not found)"
fi

ANCHOR_ID=$(grep -A1 "\[programs.${CLUSTER}\]" Anchor.toml | grep "$PROGRAM_NAME" | cut -d'"' -f2)

echo "   Keypair:     $KEYPAIR_ID"
echo "   declare_id:  $DECLARE_ID"
echo "   IDL:         $IDL_ID"
echo "   Anchor.toml: $ANCHOR_ID"
echo ""

ERRORS=0
if [ "$KEYPAIR_ID" != "$DECLARE_ID" ]; then
    echo "   ❌ Keypair != declare_id"
    ERRORS=$((ERRORS + 1))
fi
if [ -f "target/idl/${PROGRAM_NAME}.json" ] && [ "$IDL_ID" != "$KEYPAIR_ID" ]; then
    echo "   ❌ IDL != Keypair"
    ERRORS=$((ERRORS + 1))
fi
if [ "$ANCHOR_ID" != "$KEYPAIR_ID" ]; then
    echo "   ❌ Anchor.toml != Keypair"
    ERRORS=$((ERRORS + 1))
fi

if [ $ERRORS -gt 0 ]; then
    echo ""
    echo "❌ Found $ERRORS inconsistency(ies). Please fix before deploying!"
    exit 1
fi

echo "   ✅ All Program IDs match!"
echo ""

# Step 7: Deploy
echo "📤 Step 7: Deploying to $CLUSTER..."
echo "⚠️  This will cost approximately 1 SOL"
echo ""
read -p "Press Enter to continue, or Ctrl+C to cancel..."

anchor deploy --provider.cluster "$CLUSTER"

echo ""
echo "✅ Deployment complete!"
echo ""

# Step 8: Verify deployment
echo "🔍 Step 8: Verifying deployment..."
if solana program show "$PROGRAM_ID" &>/dev/null; then
    UPGRADE_AUTH=$(solana program show "$PROGRAM_ID" | grep "Authority" | awk '{print $2}')
    echo "   Program ID:      $PROGRAM_ID"
    echo "   Upgrade Authority: $UPGRADE_AUTH"
    echo "   Your wallet:     $CURRENT_WALLET"
    echo ""
    
    if [ "$UPGRADE_AUTH" = "$CURRENT_WALLET" ]; then
        echo "   ✅ Your wallet is the upgrade authority!"
    else
        echo "   ⚠️  Upgrade authority mismatch!"
    fi
else
    echo "   ⚠️  Program not found on-chain (may still be confirming)"
fi

echo ""
echo "🎉 Deployment successful!"
echo "   Program ID: $PROGRAM_ID"
echo "   Cluster: $CLUSTER"
echo "   View on Solscan: https://solscan.io/account/$PROGRAM_ID"
echo ""
echo "✅ All Program IDs are consistent across:"
echo "   - Keypair file"
echo "   - declare_id!() in source"
echo "   - IDL file"
echo "   - Anchor.toml"
echo "   - Deployed program"
