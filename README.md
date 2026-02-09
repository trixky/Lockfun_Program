# Lock.fun - On-Chain Token Locking Protocol

**Lock.fun** is a fully on-chain token locking protocol on Solana mainnet. It provides a minimal mechanism for time-based token locks, primarily used by Pump.fun token launches.

Locks are enforced entirely by the smart contract. All lock events are publicly accessible on-chain.

## Overview

Lock.fun is infrastructure. Verification is on-chain. Interpretation is left to the observer.

The protocol has:
- ✅ No backend
- ✅ No off-chain enforcement
- ✅ Deliberately small on-chain footprint
- ✅ Negligible fees (0.03 SOL per lock creation)

## Smart Contract Features

### Core Instructions

1. **`initialize`** - Initialize the program with global state
2. **`lock(amount, unlock_timestamp)`** - Lock tokens until a specific timestamp
3. **`unlock`** - Unlock tokens after the timestamp has passed (owner only)
4. **`top_up(additional_amount)`** - Add more tokens to an existing lock
5. **`extend(new_unlock_timestamp)`** - Extend the unlock timestamp of an existing lock

### Lock Account Structure

The lock account is intentionally minimal with only **four core fields**:

| Field   | Type   | Description                    |
|---------|--------|--------------------------------|
| **token**   | `Pubkey` | Token mint address             |
| **owner**   | `Pubkey` | Account that locked the tokens |
| **amount**  | `u64`    | Quantity of tokens locked      |
| **unlock_timestamp** | `i64` | Unix timestamp when tokens can be unlocked |

## Program ID

**Mainnet**: `57MA23vJ2yS9FV2oL4bz5GcKoXWXGhc25R61PU8dgefD`

## Repository Structure

```
lockfun_contract/
├── program/              # Anchor program (smart contract)
│   ├── programs/
│   │   └── lockfun/      # Main program source
│   ├── tests/            # Integration tests
│   ├── scripts/          # Deployment and utility scripts
│   └── README.md         # Detailed program documentation
├── script/               # Utility scripts
└── sync.sh              # Build and sync script for frontend
```

## Prerequisites

- [Rust](https://rustup.rs/)
- [Solana CLI](https://docs.solana.com/cli/install-solana-cli-tools) (v1.18+)
- [Anchor](https://www.anchor-lang.com/docs/installation) (v0.30+)
- Node.js (v18+)

## Quick Start

### Installation

```bash
cd program
npm install
```

### Build

```bash
anchor build
```

### Test

Start a local validator:

```bash
solana-test-validator
```

In another terminal, run tests:

```bash
anchor test
```

Or run tests with a fresh validator:

```bash
anchor test --skip-local-validator
```

### Deploy

#### Localnet

```bash
anchor deploy
```

#### Devnet

```bash
anchor deploy --provider.cluster devnet
```

#### Mainnet

```bash
anchor deploy --provider.cluster mainnet
```

**⚠️ Important**: Always verify the upgrade authority before deploying to mainnet. See `program/VERIFY_AUTHORITY.md` for details.

## Documentation

- **[Program README](program/README.md)** - Detailed program documentation
- **[Deployment Guide](program/DEPLOYMENT_GUIDE.md)** - Step-by-step deployment instructions
- **[Verify Authority](program/VERIFY_AUTHORITY.md)** - How to verify upgrade authority
- **[Cost Analysis](program/COST_ANALYSIS.md)** - Deployment cost breakdown

## Security

- All locks are enforced on-chain
- Only the lock owner can unlock tokens
- Timestamps are verified using Solana's Clock sysvar
- PDA-based vault accounts ensure secure token custody
- Duplicate account checks prevent attacks

## License

MIT

## Disclaimer

This software is provided "as is" without warranty of any kind. Use at your own risk. Always verify the smart contract code before interacting with it.
