#!/bin/bash

# Script to verify Program ID consistency before deployment
# Usage: ./scripts/verify-before-deploy.sh

set -e

PROGRAM_NAME="lockfun"
PROGRAM_SOURCE="programs/${PROGRAM_NAME}/src/lib.rs"
KEYPAIR_PATH="target/deploy/${PROGRAM_NAME}-keypair.json"
IDL_PATH="target/idl/${PROGRAM_NAME}.json"

echo "🔍 Verifying Program ID consistency before deployment..."
echo ""

# Check if keypair exists
if [ ! -f "$KEYPAIR_PATH" ]; then
    echo "⚠️  Keypair not found: $KEYPAIR_PATH"
    echo "   Run 'anchor build' first to generate it."
    exit 1
fi

# Extract Program IDs
KEYPAIR_ID=$(solana-keygen pubkey "$KEYPAIR_PATH" 2>/dev/null || echo "")
DECLARE_ID=$(grep -o 'declare_id!("[^"]*")' "$PROGRAM_SOURCE" 2>/dev/null | cut -d'"' -f2 || echo "")

# Check IDL if it exists
if [ -f "$IDL_PATH" ]; then
    IDL_ID=$(grep -o '"address": "[^"]*"' "$IDL_PATH" 2>/dev/null | head -1 | cut -d'"' -f4 || echo "")
else
    IDL_ID="(IDL not found - run 'anchor build' first)"
fi

# Check Anchor.toml
ANCHOR_MAINNET=$(grep -A1 "\[programs.mainnet\]" Anchor.toml 2>/dev/null | grep "$PROGRAM_NAME" | cut -d'"' -f2 || echo "")
ANCHOR_DEVNET=$(grep -A1 "\[programs.devnet\]" Anchor.toml 2>/dev/null | grep "$PROGRAM_NAME" | cut -d'"' -f2 || echo "")

echo "📋 Program ID Sources:"
echo "   Keypair:        $KEYPAIR_ID"
echo "   declare_id!():  $DECLARE_ID"
echo "   IDL:            $IDL_ID"
echo "   Anchor.toml (mainnet): $ANCHOR_MAINNET"
echo "   Anchor.toml (devnet):  $ANCHOR_DEVNET"
echo ""

# Verify consistency
ERRORS=0

if [ -z "$KEYPAIR_ID" ]; then
    echo "❌ Keypair ID is empty!"
    ERRORS=$((ERRORS + 1))
fi

if [ -z "$DECLARE_ID" ]; then
    echo "❌ declare_id!() not found in source code!"
    ERRORS=$((ERRORS + 1))
fi

if [ "$KEYPAIR_ID" != "$DECLARE_ID" ]; then
    echo "❌ MISMATCH: Keypair ID ($KEYPAIR_ID) != declare_id!() ($DECLARE_ID)"
    echo ""
    echo "   Solution: Run 'anchor keys sync' to synchronize"
    ERRORS=$((ERRORS + 1))
fi

if [ -f "$IDL_PATH" ] && [ "$IDL_ID" != "$KEYPAIR_ID" ]; then
    echo "❌ MISMATCH: IDL ID ($IDL_ID) != Keypair ID ($KEYPAIR_ID)"
    echo ""
    echo "   Solution: Run 'anchor build' to regenerate IDL"
    ERRORS=$((ERRORS + 1))
fi

if [ -n "$ANCHOR_MAINNET" ] && [ "$ANCHOR_MAINNET" != "$KEYPAIR_ID" ]; then
    echo "⚠️  WARNING: Anchor.toml mainnet ($ANCHOR_MAINNET) != Keypair ID ($KEYPAIR_ID)"
    echo "   This is OK if you're deploying to a different cluster"
fi

if [ $ERRORS -eq 0 ]; then
    echo "✅ All Program IDs match! Safe to deploy."
    exit 0
else
    echo ""
    echo "❌ Found $ERRORS error(s). Please fix before deploying!"
    exit 1
fi
