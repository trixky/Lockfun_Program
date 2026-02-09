#!/bin/bash

# Script to upgrade the program when you have enough SOL
# Usage: ./scripts/upgrade-when-ready.sh

set -e

PROGRAM_ID="C16J1ZLPVMZXZLWXvkR3rsEhsf9hU5f2GRfNzNqgk7W5"
MIN_BALANCE=2.5  # Minimum SOL needed (2.3 for upgrade + buffer)

echo "🔄 Program Upgrade Script"
echo "========================"
echo "Program ID: $PROGRAM_ID"
echo ""

# Verify we're on mainnet
CURRENT_RPC=$(solana config get | grep "RPC URL" | awk '{print $3}')
if [[ "$CURRENT_RPC" != "https://api.mainnet-beta.solana.com" ]]; then
    echo "⚠️  Setting RPC to mainnet..."
    solana config set --url https://api.mainnet-beta.solana.com
fi

# Get current wallet and balance
CURRENT_WALLET=$(solana address)
BALANCE=$(solana balance | awk '{print $1}')

echo "💼 Wallet: $CURRENT_WALLET"
echo "💰 Balance: $BALANCE SOL"
echo ""

# Check balance
if (( $(echo "$BALANCE < $MIN_BALANCE" | bc -l) )); then
    echo "❌ Insufficient balance!"
    echo "   Current: $BALANCE SOL"
    echo "   Needed:  $MIN_BALANCE SOL"
    echo "   Missing: $(echo "$MIN_BALANCE - $BALANCE" | bc -l) SOL"
    echo ""
    echo "Please add more SOL to your wallet and try again."
    exit 1
fi

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
echo "⚠️  This will cost approximately 2.3 SOL!"
echo ""
read -p "Press Enter to continue, or Ctrl+C to cancel..."

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
echo "🎉 Program is now fully upgraded:"
echo "   Program ID: $PROGRAM_ID"
echo "   Upgrade Authority: $CURRENT_WALLET"
echo "   View on Solscan: https://solscan.io/account/$PROGRAM_ID"
echo ""
echo "✅ The declare_id!() in the deployed program now matches the real Program ID!"
