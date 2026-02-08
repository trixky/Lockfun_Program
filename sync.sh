#!/usr/bin/env bash
set -euo pipefail

# ============================================================================
# B3drok - Anchor <-> SvelteKit Sync Script
# ============================================================================
# Builds the Anchor program and syncs IDL/types to the frontend client
# Usage: ./sync.sh [--build] [--sync-only]
#   --build      Force rebuild even if files are up to date
#   --sync-only  Only sync files, don't build
# ============================================================================

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROGRAM_DIR="$SCRIPT_DIR/program"
CLIENT_DIR="$SCRIPT_DIR/client"

# Source and destination paths
IDL_SOURCE="$PROGRAM_DIR/target/idl/b3drok.json"
TYPES_SOURCE="$PROGRAM_DIR/target/types/b3drok.ts"
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
RUST_SOURCE="$PROGRAM_DIR/programs/b3drok/src/lib.rs"

# Extract MAX_CONTENT_CHARS from Rust source
MAX_CONTENT_CHARS=$(grep -E "^pub const MAX_CONTENT_CHARS: usize = " "$RUST_SOURCE" | grep -oE '[0-9]+' | head -1)
if [ -z "$MAX_CONTENT_CHARS" ]; then
    log_warning "Could not extract MAX_CONTENT_CHARS, defaulting to 2240"
    MAX_CONTENT_CHARS=2240
fi

# Extract ACTION_COST_LAMPORTS from Rust source
ACTION_COST_LAMPORTS=$(grep "pub const ACTION_COST_LAMPORTS" "$RUST_SOURCE" | sed 's/.*= *\([0-9_]*\).*/\1/' | tr -d '_')
if [ -z "$ACTION_COST_LAMPORTS" ]; then
    log_warning "Could not extract ACTION_COST_LAMPORTS, defaulting to 1000000"
    ACTION_COST_LAMPORTS=1000000
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

/** Program ID for b3drok */
export const PROGRAM_ID = address('$PROGRAM_ID');

/** Seed constants for PDA derivation */
export const SEEDS = {
	GLOBAL_STATE: 'global_state',
	MESSAGE: 'message'
} as const;

/** Cost for writing and liking: 0.001 SOL = ${ACTION_COST_LAMPORTS} lamports */
export const ACTION_COST_LAMPORTS = ${ACTION_COST_LAMPORTS}n;

/** Maximum content length in characters */
export const MAX_CONTENT_CHARS = ${MAX_CONTENT_CHARS};

/** RPC endpoints */
export const RPC_ENDPOINTS = {
	mainnet: 'https://api.mainnet-beta.solana.com',
	devnet: 'https://api.devnet.solana.com',
	localnet: 'http://localhost:8899'
} as const;

export type Cluster = keyof typeof RPC_ENDPOINTS;
EOF

log_success "Generated config.ts with program ID"

# ============================================================================
# Step 9: Generate main index file that exports the API
# ============================================================================
cat > "$CLIENT_PROGRAM_DIR/index.ts" << 'EOF'
// ============================================================================
// B3drok Program Client
// Auto-generated by sync.sh - Safe to extend, but core exports are regenerated
// ============================================================================

// Re-export everything
export * from './config';
export type { B3drok } from './types';

// Export IDL as a typed constant
import idlJson from './idl.json';
import type { B3drok } from './types';
export const IDL = idlJson as B3drok;

// Re-export the program client and types
export { b3drok } from './client';
export type { Message, GlobalState, WriteOptions } from './client';

// Re-export transaction builders (from manual transactions.ts file)
export { 
	createWriteTransaction, 
	createLikeTransaction, 
	sendSignedTransaction,
	type WriteTransactionResult 
} from './transactions';
EOF

log_success "Generated index.ts"

# ============================================================================
# Step 10: Generate the program client with API functions
# ============================================================================
cat > "$CLIENT_PROGRAM_DIR/client.ts" << 'EOF'
// ============================================================================
// B3drok Program Client
// Provides typed functions to interact with the b3drok Solana program
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

import { PROGRAM_ID, SEEDS, RPC_ENDPOINTS, type Cluster, ACTION_COST_LAMPORTS, MAX_CONTENT_CHARS } from './config';

// ============================================================================
// Types
// ============================================================================

/** Message account data */
export interface Message {
	id: bigint;
	parentId: bigint | null;
	timestamp: bigint;
	writer: Address;
	likes: bigint;
	comments: bigint;
	content: string;
}

/** Global state account data */
export interface GlobalState {
	counter: bigint;
	authority: Address;
}

/** Options for write instruction */
export interface WriteOptions {
	content: string;
	parentId?: bigint;
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

/** Get a Message PDA by id */
export async function getMessagePda(id: bigint): Promise<readonly [Address, number]> {
	const encoder = new TextEncoder();
	const idBytes = new Uint8Array(8);
	const view = new DataView(idBytes.buffer);
	view.setBigUint64(0, id, true); // little-endian
	
	return getProgramDerivedAddress({
		programAddress: PROGRAM_ID,
		seeds: [encoder.encode(SEEDS.MESSAGE), idBytes]
	});
}

// ============================================================================
// Program Client
// ============================================================================

function createB3drokClient() {
	let rpc: Rpc<SolanaRpcApi> | null = null;
	let currentCluster: Cluster = 'devnet';

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
		if (data.length < 8 + 8 + 32) return null;
		
		const counter = readBigUInt64LE(data, 8);
		const authorityBytes = data.slice(16, 48);
		const authority = addressDecoder.decode(authorityBytes);
		
		return { counter, authority };
	}

	/** Fetch a message by ID */
	async function fetchMessage(id: bigint): Promise<Message | null> {
		const [pda] = await getMessagePda(id);
		const rpcClient = getRpc();
		
		const response = await rpcClient.getAccountInfo(pda, { encoding: 'base64' }).send();
		if (!response.value) return null;
		
		const dataArray = response.value.data;
		if (!Array.isArray(dataArray)) return null;
		
		return decodeMessage(base64ToBuffer(dataArray[0]));
	}

	/** Fetch all messages (with optional filters) */
	async function fetchMessages(options?: {
		writer?: Address;
		parentId?: bigint | null;
		limit?: number;
	}): Promise<Message[]> {
		const rpcClient = getRpc();
		
		// Message discriminator in base64: [110, 151, 23, 110, 198, 6, 125, 181]
		const discriminatorBase64 = 'bpcXbsYGfbU=' as Base64EncodedBytes;
		
		const accounts = await rpcClient.getProgramAccounts(PROGRAM_ID, {
			encoding: 'base64',
			filters: [
				// Filter for Message accounts by discriminator
				{ memcmp: { offset: 0n, bytes: discriminatorBase64, encoding: 'base64' } }
			]
		}).send();
		
		const messages = accounts
			.map((item) => {
				const dataArray = item.account.data;
				if (!Array.isArray(dataArray)) return null;
				return decodeMessage(base64ToBuffer(dataArray[0]));
			})
			.filter((m): m is Message => m !== null)
			.sort((a: Message, b: Message) => Number(b.id - a.id)); // Newest first
		
		return options?.limit ? messages.slice(0, options.limit) : messages;
	}

	/** Fetch messages by writer */
	async function fetchMessagesByWriter(writer: Address): Promise<Message[]> {
		const allMessages = await fetchMessages();
		return allMessages.filter(m => m.writer === writer);
	}

	/** Fetch replies to a message */
	async function fetchReplies(parentId: bigint): Promise<Message[]> {
		const allMessages = await fetchMessages();
		return allMessages.filter(m => m.parentId === parentId);
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

	function decodeMessage(data: Uint8Array): Message | null {
		if (data.length < 81) return null; // 8 discriminator + 8 id + 9 parent_id + 8 timestamp + 32 writer + 8 likes + 8 comments = 81 min
		
		try {
			// Skip 8-byte discriminator
			let offset = 8;
			
			// id: u64
			const id = readBigUInt64LE(data, offset);
			offset += 8;
			
			// parent_id: Option<u64>
			const hasParent = data[offset] === 1;
			offset += 1;
			const parentId = hasParent ? readBigUInt64LE(data, offset) : null;
			offset += 8;
			
			// timestamp: i64
			const timestamp = readBigInt64LE(data, offset);
			offset += 8;
			
			// writer: Pubkey (32 bytes)
			const writerBytes = data.slice(offset, offset + 32);
			const writer = addressDecoder.decode(writerBytes);
			offset += 32;
			
			// likes: u64
			const likes = readBigUInt64LE(data, offset);
			offset += 8;
			
			// comments: u64
			const comments = readBigUInt64LE(data, offset);
			offset += 8;
			
			// content: String (4-byte len + data)
			const contentLen = readUInt32LE(data, offset);
			offset += 4;
			const contentBytes = data.slice(offset, offset + contentLen);
			const content = new TextDecoder().decode(contentBytes);
			
			return { id, parentId, timestamp, writer, likes, comments, content };
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
		ACTION_COST_LAMPORTS,
		MAX_CONTENT_CHARS,
		
		// PDA derivation
		getGlobalStatePda,
		getMessagePda,
		
		// Read functions
		fetchGlobalState,
		fetchMessage,
		fetchMessages,
		fetchMessagesByWriter,
		fetchReplies,
	};
}

/** Singleton program client */
export const b3drok = createB3drokClient();
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
echo "    import { b3drok, PROGRAM_ID, type Message } from '\$lib/program';"
echo ""

