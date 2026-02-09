#!/bin/bash

# Script to check for recoverable SOL in buffer accounts and other addresses
# Usage: ./scripts/check-recoverable-sol.sh

set -e

WALLET="CUmTFLxqFkMEUFtH5Wo5cF9MMPFiPS49WRWEUTFGLFxp"
BUFFER_ACCOUNT="9XBZ6coUC8YmxiERqCVttKcDV3A9NmDHvcdRrnv7RSTb"
BUFFER_ACCOUNT_2="QeeXoYtZbWjT9yjLwRB1KFPQ57gyKPwW8oGqs5y3W7i"

echo "🔍 Checking for recoverable SOL..."
echo ""

# Current wallet balance
WALLET_BALANCE=$(solana balance "$WALLET" 2>/dev/null | awk '{print $1}' || echo "0")
echo "💼 Current wallet balance: $WALLET_BALANCE SOL"
echo ""

# Check buffer account from transaction 4LDBNq...
echo "📦 Checking Buffer Account 1 ($BUFFER_ACCOUNT):"
if solana account "$BUFFER_ACCOUNT" --output json &>/dev/null; then
    BUFFER_BALANCE=$(solana account "$BUFFER_ACCOUNT" --output json 2>/dev/null | grep -o '"lamports":[0-9]*' | cut -d':' -f2 || echo "0")
    BUFFER_SOL=$(echo "scale=9; $BUFFER_BALANCE / 1000000000" | bc)
    OWNER=$(solana account "$BUFFER_ACCOUNT" --output json 2>/dev/null | grep -o '"owner":"[^"]*"' | cut -d'"' -f4 || echo "N/A")
    
    echo "   ✅ EXISTS!"
    echo "   Balance: $BUFFER_SOL SOL"
    echo "   Owner: $OWNER"
    
    if [ "$OWNER" = "BPFLoaderUpgradeab1e11111111111111111111111" ]; then
        echo "   ⚠️  This is a program buffer account"
        echo "   💡 Try to recover with: solana program close $BUFFER_ACCOUNT --bypass-warning"
    elif [ "$OWNER" = "11111111111111111111111111111111" ]; then
        echo "   ⚠️  This is a system account"
        echo "   💡 Try to recover with: solana program close $BUFFER_ACCOUNT --bypass-warning"
    fi
else
    echo "   ❌ Account not found (already closed or doesn't exist)"
fi
echo ""

# Check buffer account 2 from upgrade attempt
echo "📦 Checking Buffer Account 2 ($BUFFER_ACCOUNT_2):"
if solana account "$BUFFER_ACCOUNT_2" --output json &>/dev/null; then
    BUFFER_BALANCE=$(solana account "$BUFFER_ACCOUNT_2" --output json 2>/dev/null | grep -o '"lamports":[0-9]*' | cut -d':' -f2 || echo "0")
    BUFFER_SOL=$(echo "scale=9; $BUFFER_BALANCE / 1000000000" | bc)
    OWNER=$(solana account "$BUFFER_ACCOUNT_2" --output json 2>/dev/null | grep -o '"owner":"[^"]*"' | cut -d'"' -f4 || echo "N/A")
    
    echo "   ✅ EXISTS!"
    echo "   Balance: $BUFFER_SOL SOL"
    echo "   Owner: $OWNER"
    
    if [ "$OWNER" = "BPFLoaderUpgradeab1e11111111111111111111111" ]; then
        echo "   ⚠️  This is a program buffer account"
        echo "   💡 Try to recover with: solana program close $BUFFER_ACCOUNT_2 --bypass-warning"
    fi
else
    echo "   ❌ Account not found (already closed or doesn't exist)"
fi
echo ""

# Check all programs owned by the wallet
echo "📦 Checking all programs you own:"
PROGRAMS=$(solana program show --programs 2>/dev/null | grep -E "^Program Id:" | awk '{print $3}' || echo "")

if [ -n "$PROGRAMS" ]; then
    for PROGRAM_ID in $PROGRAMS; do
        PROG_INFO=$(solana program show "$PROGRAM_ID" 2>/dev/null || echo "")
        if echo "$PROG_INFO" | grep -q "Authority: $WALLET"; then
            PROG_BALANCE=$(echo "$PROG_INFO" | grep "Balance" | awk '{print $1}' || echo "0")
            echo "   Program: $PROGRAM_ID"
            echo "   Balance: $PROG_BALANCE SOL"
            echo "   💡 Recoverable with: solana program close $PROGRAM_ID --bypass-warning"
            echo ""
        fi
    done
else
    echo "   No programs found"
fi

# Summary
echo "═══════════════════════════════════════"
echo "💰 Summary:"
echo "   Wallet balance: $WALLET_BALANCE SOL"
echo ""
echo "💡 To recover SOL from buffer accounts, try:"
echo "   solana program close <ACCOUNT_ADDRESS> --bypass-warning"
echo ""
echo "⚠️  Note: Only accounts owned by BPFLoaderUpgradeab1e11111111111111111111111"
echo "   or where you are the authority can be closed."
