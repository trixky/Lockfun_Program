#!/usr/bin/env bash
set -euo pipefail

# ============================================================================
# Lockfun - Anchor <-> SvelteKit Sync Script
# ============================================================================
# Builds the Anchor program and syncs IDL/types to the frontend client
# Usage: ./sync.sh [--build] [--sync-only]
#   --build      Force rebuild even if files are up to date
#   --sync-only  Only sync files, don't build
# ============================================================================

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROGRAM_DIR="$SCRIPT_DIR/program"
CLIENT_DIR="$SCRIPT_DIR/../timelock/client"

# Source and destination paths
IDL_SOURCE="$PROGRAM_DIR/target/idl/lockfun.json"
TYPES_SOURCE="$PROGRAM_DIR/target/types/lockfun.ts"
CLIENT_PROGRAM_DIR="$CLIENT_DIR/src/lib/program"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

log_info() { echo -e "${BLUE}ℹ${NC} $1"; }
log_success() { echo -e "${GREEN}✓${NC} $1"; }
log_warning() { echo -e "${YELLOW}⚠${NC} $1"; }
log_error() { echo -e "${RED}✗${NC} $1"; }

# Parse arguments
BUILD_ONLY=false
SYNC_ONLY=false
for arg in "$@"; do
    case $arg in
        --build) BUILD_ONLY=true ;;
        --sync-only) SYNC_ONLY=true ;;
        -h|--help)
            echo "Usage: ./sync.sh [--build] [--sync-only]"
            echo "  --build      Force rebuild even if files are up to date"
            echo "  --sync-only  Only sync files, don't build"
            exit 0
            ;;
    esac
done

# ============================================================================
# Step 1: Build the Anchor program
# ============================================================================
if [ "$SYNC_ONLY" = false ]; then
    log_info "Building Anchor program..."
    cd "$PROGRAM_DIR"
    
    if ! command -v anchor &> /dev/null; then
        log_error "Anchor CLI not found. Install with: cargo install --git https://github.com/coral-xyz/anchor anchor-cli"
        exit 1
    fi
    
    anchor build
    log_success "Anchor build complete"
    cd "$SCRIPT_DIR"
fi

# ============================================================================
# Step 2: Validate source files exist
# ============================================================================
if [ ! -f "$IDL_SOURCE" ]; then
    log_error "IDL file not found: $IDL_SOURCE"
    log_info "Run 'anchor build' in the program directory first"
    exit 1
fi

if [ ! -f "$TYPES_SOURCE" ]; then
    log_error "Types file not found: $TYPES_SOURCE"
    log_info "Run 'anchor build' in the program directory first"
    exit 1
fi

# ============================================================================
# Step 3: Extract program ID from IDL
# ============================================================================
PROGRAM_ID=$(grep -o '"address": "[^"]*"' "$IDL_SOURCE" | head -1 | cut -d'"' -f4)

if [ -z "$PROGRAM_ID" ]; then
    log_error "Could not extract program ID from IDL"
    exit 1
fi

log_info "Program ID: $PROGRAM_ID"

# ============================================================================
# Step 4: Create client program directory
# ============================================================================
mkdir -p "$CLIENT_PROGRAM_DIR"

# ============================================================================
# Step 5: Copy IDL
# ============================================================================
cp "$IDL_SOURCE" "$CLIENT_PROGRAM_DIR/idl.json"
log_success "Copied IDL to client"

# ============================================================================
# Step 6: Copy and adapt types
# ============================================================================
cp "$TYPES_SOURCE" "$CLIENT_PROGRAM_DIR/types.ts"
log_success "Copied types to client"

# ============================================================================
# Step 7: Extract constants from Rust source
# ============================================================================
RUST_SOURCE="$PROGRAM_DIR/programs/lockfun/src/lib.rs"

# Extract FEE_AMOUNT from Rust source
FEE_AMOUNT=$(grep "pub const FEE_AMOUNT: u64 = " "$RUST_SOURCE" | sed 's/.*= *\([0-9_]*\).*/\1/' | tr -d '_')
if [ -z "$FEE_AMOUNT" ]; then
    log_warning "Could not extract FEE_AMOUNT, defaulting to 30000000"
    FEE_AMOUNT=30000000
fi

# Extract FEE_RECIPIENT from Rust source (handles both pubkey!() macro and direct string)
FEE_RECIPIENT=$(grep "pub const FEE_RECIPIENT: Pubkey = " "$RUST_SOURCE" | grep -oE '"[A-Za-z0-9]{32,44}"' | head -1 | tr -d '"')
if [ -z "$FEE_RECIPIENT" ]; then
    # Try alternative pattern for pubkey!() macro format
    FEE_RECIPIENT=$(grep "pub const FEE_RECIPIENT" "$RUST_SOURCE" | grep -oE '[A-Za-z0-9]{32,44}' | head -1)
fi
if [ -z "$FEE_RECIPIENT" ]; then
    log_warning "Could not extract FEE_RECIPIENT, defaulting to CsJ1qQSA7hsxAH27cqENqhTy7vBUcdMdVQXAMubJniPo"
    FEE_RECIPIENT="CsJ1qQSA7hsxAH27cqENqhTy7vBUcdMdVQXAMubJniPo"
fi

# ============================================================================
# Step 8: Generate config file with program ID and constants
# ============================================================================
cat > "$CLIENT_PROGRAM_DIR/config.ts" << EOF
// ============================================================================
// Auto-generated by sync.sh - DO NOT EDIT MANUALLY
// Run ./sync.sh to regenerate after Anchor build
// ============================================================================

import { address } from '@solana/addresses';
import { PUBLIC_SOLANA_NETWORK } from '\$env/static/public';

/** Program ID for lockfun */
export const PROGRAM_ID = address('$PROGRAM_ID');

/** Seed constants for PDA derivation */
export const SEEDS = {
	GLOBAL_STATE: 'global_state',
	LOCK: 'lock',
	VAULT: 'vault'
} as const;

/** Fee amount for locking tokens: 0.03 SOL = ${FEE_AMOUNT} lamports */
export const FEE_AMOUNT = ${FEE_AMOUNT}n;

/** Fee recipient address */
export const FEE_RECIPIENT = address('$FEE_RECIPIENT');

/** Solana network types */
export type SolanaNetwork = 'LOCAL' | 'DEVNET' | 'TESTNET' | 'MAINNET';

/** Default RPC endpoints by network (fallback if no custom RPC) */
const DEFAULT_RPC_ENDPOINTS = {
	LOCAL: 'http://localhost:8899',
	DEVNET: 'https://api.devnet.solana.com',
	TESTNET: 'https://api.testnet.solana.com',
	MAINNET: 'https://api.mainnet.solana.com'
	// MAINNET: 'https://mainnet.helius-rpc.com/?api-key=YOUR_API_KEY_HERE' // Use custom RPC if needed
} as const;

/** Get the configured network from environment */
function getNetworkFromEnv(): SolanaNetwork {
	const network = PUBLIC_SOLANA_NETWORK as string;
	if (network === 'LOCAL' || network === 'DEVNET' || network === 'TESTNET' || network === 'MAINNET') {
		return network;
	}
	console.warn(\`Invalid PUBLIC_SOLANA_NETWORK: "\${network}", defaulting to LOCAL\`);
	return 'LOCAL';
}

/** Current configured Solana network */
export const SOLANA_NETWORK: SolanaNetwork = getNetworkFromEnv();

/** 
 * RPC endpoints - uses custom RPC URL if provided, otherwise falls back to defaults
 * Set PUBLIC_SOLANA_RPC_URL in .env for custom RPC (recommended for mainnet)
 */
export const RPC_ENDPOINTS: Record<SolanaNetwork, string> = {
	LOCAL: DEFAULT_RPC_ENDPOINTS.LOCAL,
	DEVNET: DEFAULT_RPC_ENDPOINTS.DEVNET,
	TESTNET: DEFAULT_RPC_ENDPOINTS.TESTNET,
	MAINNET: DEFAULT_RPC_ENDPOINTS.MAINNET
};

/** Current RPC endpoint based on configured network */
export const RPC_ENDPOINT: string = RPC_ENDPOINTS[SOLANA_NETWORK];

/** Cluster type for backwards compatibility */
export type Cluster = SolanaNetwork;
EOF

log_success "Generated config.ts with program ID"

# ============================================================================
# Step 9: Generate main index file that exports the API
# ============================================================================
cat > "$CLIENT_PROGRAM_DIR/index.ts" << 'EOF'
// ============================================================================
// Lockfun Program Client
// Auto-generated by sync.sh - Safe to extend, but core exports are regenerated
// ============================================================================

// Re-export everything
export * from './config';
export type { Lockfun } from './types';

// Export IDL as a typed constant
import idlJson from './idl.json';
import type { Lockfun } from './types';
export const IDL = idlJson as Lockfun;

// Re-export the program client and types
export { lockfun, getLockPda, getVaultPda } from './client';
export type { Lock, GlobalState } from './client';

// Re-export transaction builders (from manual transactions.ts file if it exists)
// Note: transactions.ts is NOT auto-generated - update it manually for new instructions
EOF

log_success "Generated index.ts"

# ============================================================================
# Step 10: Generate the program client with API functions
# ============================================================================
cat > "$CLIENT_PROGRAM_DIR/client.ts" << 'EOF'
// ============================================================================
// Lockfun Program Client
// Provides typed functions to interact with the lockfun Solana program
// ============================================================================

import { 
	getAddressDecoder,
	getProgramDerivedAddress,
	type Address
} from '@solana/addresses';
import { 
	createSolanaRpc,
	type Rpc,
	type SolanaRpcApi
} from '@solana/rpc';
import type { Base64EncodedBytes } from '@solana/rpc-types';

import { PROGRAM_ID, SEEDS, RPC_ENDPOINTS, SOLANA_NETWORK, type Cluster, FEE_AMOUNT, FEE_RECIPIENT } from './config';

// ============================================================================
// Types
// ============================================================================

/** Lock account data */
export interface Lock {
	id: bigint;
	owner: Address;
	mint: Address;
	amount: bigint;
	unlockTimestamp: bigint;
	createdAt: bigint;
	vaultBump: number;
	isUnlocked: boolean;
}

/** Global state account data */
export interface GlobalState {
	authority: Address;
	lockCounter: bigint;
}

// ============================================================================
// PDA Derivation
// ============================================================================

const addressDecoder = getAddressDecoder();

/** Get the GlobalState PDA */
export async function getGlobalStatePda(): Promise<readonly [Address, number]> {
	const encoder = new TextEncoder();
	return getProgramDerivedAddress({
		programAddress: PROGRAM_ID,
		seeds: [encoder.encode(SEEDS.GLOBAL_STATE)]
	});
}

/** Get a Lock PDA by id */
export async function getLockPda(id: bigint): Promise<readonly [Address, number]> {
	const encoder = new TextEncoder();
	const idBytes = new Uint8Array(8);
	const view = new DataView(idBytes.buffer);
	view.setBigUint64(0, id, true); // little-endian
	
	return getProgramDerivedAddress({
		programAddress: PROGRAM_ID,
		seeds: [encoder.encode(SEEDS.LOCK), idBytes]
	});
}

/** Get a Vault PDA by lock id */
export async function getVaultPda(id: bigint): Promise<readonly [Address, number]> {
	const encoder = new TextEncoder();
	const idBytes = new Uint8Array(8);
	const view = new DataView(idBytes.buffer);
	view.setBigUint64(0, id, true); // little-endian
	
	return getProgramDerivedAddress({
		programAddress: PROGRAM_ID,
		seeds: [encoder.encode(SEEDS.VAULT), idBytes]
	});
}

// ============================================================================
// Program Client
// ============================================================================

function createLockfunClient() {
	let rpc: Rpc<SolanaRpcApi> | null = null;
	let currentCluster: Cluster = SOLANA_NETWORK;

	/** Initialize or switch RPC connection */
	function setCluster(cluster: Cluster) {
		currentCluster = cluster;
		rpc = createSolanaRpc(RPC_ENDPOINTS[cluster]);
	}

	/** Get current RPC, initializing if needed */
	function getRpc(): Rpc<SolanaRpcApi> {
		if (!rpc) {
			setCluster(currentCluster);
		}
		return rpc!;
	}

	/** Get current cluster */
	function getCluster(): Cluster {
		return currentCluster;
	}

	// ========================================================================
	// Read Functions
	// ========================================================================

	/** Fetch global state */
	async function fetchGlobalState(): Promise<GlobalState | null> {
		const [pda] = await getGlobalStatePda();
		const rpcClient = getRpc();
		
		const response = await rpcClient.getAccountInfo(pda, { encoding: 'base64' }).send();
		if (!response.value) return null;
		
		// Decode account data (8 byte discriminator + data)
		const dataArray = response.value.data;
		if (!Array.isArray(dataArray)) return null;
		
		const data = base64ToBuffer(dataArray[0]);
		if (data.length < 8 + 32 + 8) return null;
		
		// Skip 8-byte discriminator
		let offset = 8;
		
		// authority: Pubkey (32 bytes)
		const authorityBytes = data.slice(offset, offset + 32);
		const authority = addressDecoder.decode(authorityBytes);
		offset += 32;
		
		// lock_counter: u64
		const lockCounter = readBigUInt64LE(data, offset);
		
		return { authority, lockCounter };
	}

	/** Fetch a lock by ID */
	async function fetchLock(id: bigint): Promise<Lock | null> {
		const [pda] = await getLockPda(id);
		const rpcClient = getRpc();
		
		const response = await rpcClient.getAccountInfo(pda, { encoding: 'base64' }).send();
		if (!response.value) return null;
		
		const dataArray = response.value.data;
		if (!Array.isArray(dataArray)) return null;
		
		return decodeLock(base64ToBuffer(dataArray[0]));
	}

	/** Fetch all locks (with optional filters) */
	async function fetchLocks(options?: {
		owner?: Address;
		mint?: Address;
		isUnlocked?: boolean;
		limit?: number;
	}): Promise<Lock[]> {
		const rpcClient = getRpc();
		
		// Lock discriminator needs to be extracted from IDL or calculated
		// For now, we'll fetch all program accounts and filter by structure
		const accounts = await rpcClient.getProgramAccounts(PROGRAM_ID, {
			encoding: 'base64'
		}).send();
		
		const locks = accounts
			.map((item) => {
				const dataArray = item.account.data;
				if (!Array.isArray(dataArray)) return null;
				const decoded = decodeLock(base64ToBuffer(dataArray[0]));
				return decoded;
			})
			.filter((l): l is Lock => l !== null)
			.sort((a: Lock, b: Lock) => Number(b.id - a.id)); // Newest first
		
		// Apply filters
		let filtered = locks;
		if (options?.owner) {
			filtered = filtered.filter(l => l.owner === options.owner);
		}
		if (options?.mint) {
			filtered = filtered.filter(l => l.mint === options.mint);
		}
		if (options?.isUnlocked !== undefined) {
			filtered = filtered.filter(l => l.isUnlocked === options.isUnlocked);
		}
		
		return options?.limit ? filtered.slice(0, options.limit) : filtered;
	}

	/** Fetch locks by owner */
	async function fetchLocksByOwner(owner: Address): Promise<Lock[]> {
		return fetchLocks({ owner });
	}

	/** Fetch locks by mint */
	async function fetchLocksByMint(mint: Address): Promise<Lock[]> {
		return fetchLocks({ mint });
	}

	// ========================================================================
	// Decode Helpers
	// ========================================================================

	function base64ToBuffer(base64: string): Uint8Array {
		const binaryString = atob(base64);
		const bytes = new Uint8Array(binaryString.length);
		for (let i = 0; i < binaryString.length; i++) {
			bytes[i] = binaryString.charCodeAt(i);
		}
		return bytes;
	}

	function readBigUInt64LE(data: Uint8Array, offset: number): bigint {
		const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
		return view.getBigUint64(offset, true);
	}

	function readBigInt64LE(data: Uint8Array, offset: number): bigint {
		const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
		return view.getBigInt64(offset, true);
	}

	function readUInt32LE(data: Uint8Array, offset: number): number {
		const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
		return view.getUint32(offset, true);
	}

	function decodeLock(data: Uint8Array): Lock | null {
		// Lock structure: 8 discriminator + 8 id + 32 owner + 32 mint + 8 amount + 8 unlock_timestamp + 8 created_at + 1 vault_bump + 1 is_unlocked = 106 bytes
		if (data.length < 106) return null;
		
		try {
			// Skip 8-byte discriminator
			let offset = 8;
			
			// id: u64
			const id = readBigUInt64LE(data, offset);
			offset += 8;
			
			// owner: Pubkey (32 bytes)
			const ownerBytes = data.slice(offset, offset + 32);
			const owner = addressDecoder.decode(ownerBytes);
			offset += 32;
			
			// mint: Pubkey (32 bytes)
			const mintBytes = data.slice(offset, offset + 32);
			const mint = addressDecoder.decode(mintBytes);
			offset += 32;
			
			// amount: u64
			const amount = readBigUInt64LE(data, offset);
			offset += 8;
			
			// unlock_timestamp: i64
			const unlockTimestamp = readBigInt64LE(data, offset);
			offset += 8;
			
			// created_at: i64
			const createdAt = readBigInt64LE(data, offset);
			offset += 8;
			
			// vault_bump: u8
			const vaultBump = data[offset];
			offset += 1;
			
			// is_unlocked: bool (u8, 0 or 1)
			const isUnlocked = data[offset] === 1;
			
			return { id, owner, mint, amount, unlockTimestamp, createdAt, vaultBump, isUnlocked };
		} catch {
			return null;
		}
	}

	// ========================================================================
	// Constants & Helpers
	// ========================================================================

	return {
		// Configuration
		setCluster,
		getCluster,
		getRpc,
		
		// Constants
		PROGRAM_ID,
		FEE_AMOUNT,
		FEE_RECIPIENT,
		
		// PDA derivation
		getGlobalStatePda,
		getLockPda,
		getVaultPda,
		
		// Read functions
		fetchGlobalState,
		fetchLock,
		fetchLocks,
		fetchLocksByOwner,
		fetchLocksByMint,
	};
}

/** Singleton program client */
export const lockfun = createLockfunClient();
EOF

log_success "Generated client.ts with API functions"

# ============================================================================
# Done!
# ============================================================================

echo ""
log_success "Sync complete!"
echo ""
echo "  Program ID:  $PROGRAM_ID"
echo "  Client dir:  $CLIENT_PROGRAM_DIR"
echo ""
echo "  Files synced:"
echo "    - idl.json     (Anchor IDL)"
echo "    - types.ts     (TypeScript types)"
echo "    - config.ts    (Program ID & constants)"
echo "    - client.ts    (API client)"
echo "    - index.ts     (Re-exports)"
echo ""
echo "  Usage in SvelteKit:"
echo "    import { lockfun, PROGRAM_ID, type Lock } from '\$lib/program';"
echo ""
echo "  Note: transactions.ts is NOT auto-generated - update it manually for new instructions"
echo ""

