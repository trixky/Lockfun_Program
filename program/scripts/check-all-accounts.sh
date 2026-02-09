#!/bin/bash

# Script to check all accounts that might contain SOL
# Usage: ./scripts/check-all-accounts.sh

set -e

WALLET="CUmTFLxqFkMEUFtH5Wo5cF9MMPFiPS49WRWEUTFGLFxp"
PROGRAM_1="C16J1ZLPVMZXZLWXvkR3rsEhsf9hU5f2GRfNzNqgk7W5"
PROGRAM_2="57MA23vJ2yS9FV2oL4bz5GcKoXWXGhc25R61PU8dgefD"
BUFFER="QeeXoYtZbWjT9yjLwRB1KFPQ57gyKPwW8oGqs5y3W7i"

echo "💰 Checking all accounts for SOL..."
echo ""

# Wallet balance
WALLET_BALANCE=$(solana balance "$WALLET" 2>/dev/null | awk '{print $1}' || echo "0")
echo "💼 Wallet ($WALLET): $WALLET_BALANCE SOL"

# Program 1 (deleted)
echo ""
echo "📦 Program 1 ($PROGRAM_1):"
if solana program show "$PROGRAM_1" &>/dev/null 2>&1; then
    PROG1_BALANCE=$(solana program show "$PROGRAM_1" | grep "Balance" | awk '{print $1}' || echo "0")
    echo "   Status: EXISTS - Balance: $PROG1_BALANCE SOL"
else
    echo "   Status: DELETED/CLOSED"
fi

# Program 2 (current)
echo ""
echo "📦 Program 2 ($PROGRAM_2):"
if solana program show "$PROGRAM_2" &>/dev/null 2>&1; then
    PROG2_BALANCE=$(solana program show "$PROGRAM_2" | grep "Balance" | awk '{print $1}' || echo "0")
    PROG2_AUTH=$(solana program show "$PROGRAM_2" | grep "Authority" | awk '{print $2}' || echo "N/A")
    echo "   Status: EXISTS - Balance: $PROG2_BALANCE SOL"
    echo "   Authority: $PROG2_AUTH"
else
    echo "   Status: NOT FOUND"
fi

# Buffer account
echo ""
echo "📦 Buffer Account ($BUFFER):"
if solana account "$BUFFER" &>/dev/null 2>&1; then
    BUFFER_BALANCE=$(solana account "$BUFFER" --output json 2>/dev/null | grep -o '"lamports":[0-9]*' | cut -d':' -f2 || echo "0")
    BUFFER_SOL=$(echo "scale=9; $BUFFER_BALANCE / 1000000000" | bc)
    echo "   Status: EXISTS - Balance: $BUFFER_SOL SOL"
    echo "   ⚠️  This SOL can be recovered!"
else
    echo "   Status: NOT FOUND (already closed or never created)"
fi

# Total
echo ""
echo "═══════════════════════════════════════"
TOTAL=$(echo "$WALLET_BALANCE + $PROG2_BALANCE" | bc 2>/dev/null || echo "$WALLET_BALANCE")
echo "💰 Total Available: ~$TOTAL SOL"
echo ""
echo "💡 To recover buffer account SOL (if it exists):"
echo "   solana program close $BUFFER --bypass-warning"
