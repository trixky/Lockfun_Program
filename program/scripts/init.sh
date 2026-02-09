#!/usr/bin/env bash
set -euo pipefail

# ============================================================================
# Lockfun Initialization Script
# ============================================================================
# Initializes the GlobalState account for the lockfun program
# Usage: ./init.sh [devnet|mainnet|localnet]
# ============================================================================

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROGRAM_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

CLUSTER="${1:-devnet}"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

log_info() { echo -e "${BLUE}ℹ${NC} $1"; }
log_success() { echo -e "${GREEN}✓${NC} $1"; }
log_warning() { echo -e "${YELLOW}⚠${NC} $1"; }
log_error() { echo -e "${RED}✗${NC} $1"; }

# Validate cluster
if [[ ! "$CLUSTER" =~ ^(devnet|mainnet|localnet)$ ]]; then
    log_error "Invalid cluster: $CLUSTER"
    echo "Usage: $0 [devnet|mainnet|localnet]"
    exit 1
fi

log_info "Initializing Lockfun on $CLUSTER..."

cd "$PROGRAM_DIR"

# Check if anchor is installed
if ! command -v anchor &> /dev/null; then
    log_error "Anchor CLI not found. Install with: cargo install --git https://github.com/coral-xyz/anchor anchor-cli"
    exit 1
fi

# Check if types are built
if [ ! -f "target/types/lockfun.ts" ]; then
    log_warning "Types not found. Building program first..."
    anchor build
fi

# Run initialization script
log_info "Running initialization script..."
npx tsx scripts/init-lockfun.ts "$CLUSTER"

log_success "Initialization complete!"
