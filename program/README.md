# lock.fun

**lock.fun – On-Chain Token Locking Protocol**

Lock.fun is a fully on-chain token locking protocol on Solana mainnet. It provides a minimal mechanism for time-based token locks, primarily used by Pump.fun token launches.

Locks are enforced entirely by the smart contract. All lock events are publicly accessible on-chain.

A thin frontend is provided for data visualization and interacts directly with Solana RPCs. The protocol has no backend, no off-chain enforcement, and a deliberately small on-chain footprint, resulting in negligible fees.

Lock.fun is infrastructure. Verification is on-chain. Interpretation is left to the observer.

## Lock account: minimal layout

The lock account is intentionally minimal. It has only **four core fields** (plus a few internal fields for the program):

| Field   | Type   | Description                    |
|--------|--------|--------------------------------|
| **token**   | `Pubkey` | Token mint address             |
| **owner**   | `Pubkey` | Account that locked the tokens |
| **amount**  | `u64`    | Quantity of tokens locked      |
| **unlock_timestamp** | `i64` | Unix timestamp when tokens can be unlocked |

This is verified in the program: see `Lock` in `programs/timelock_supply/src/lib.rs` (fields `mint`, `owner`, `amount`, `unlock_timestamp`).

## Prerequisites

- [Rust](https://rustup.rs/)
- [Solana CLI](https://docs.solana.com/cli/install-solana-cli-tools) (v1.18+)
- [Anchor](https://www.anchor-lang.com/docs/installation) (v0.30+)
- Node.js (v18+)

## Installation

```bash
cd program
npm install
```

## Build

```bash
anchor build
```

## Test

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

## Deploy

### Localnet

```bash
anchor deploy
```

### Devnet

```bash
anchor deploy --provider.cluster devnet
```

## Program structure

### Accounts

- **GlobalState** (PDA: `["global_state"]`)
  - `authority`: Admin wallet
  - `lock_counter`: Incremental lock ID counter

- **Lock** (PDA: `["lock", lock_id]`)
  - `id`: Unique lock ID
  - `owner`: Account that locked the tokens
  - `mint`: Token mint address
  - `amount`: Quantity of tokens locked
  - `unlock_timestamp`: Unix timestamp when tokens can be unlocked
  - `created_at`: Lock creation timestamp
  - `vault_bump`: Vault PDA bump
  - `is_unlocked`: Whether the lock has been unlocked

- **Vault**: PDA-owned token account holding locked tokens (seeds: `["vault", lock_id]`)

### Instructions

1. **initialize**
   - Creates GlobalState. Authority only.

2. **lock(amount, unlock_timestamp)**
   - Creates a Lock account and transfers tokens from the owner to the vault PDA.
   - Only the owner can unlock after `unlock_timestamp`.

3. **unlock**
   - Owner only, after `unlock_timestamp`.
   - Transfers tokens from the vault back to the owner and marks the lock as unlocked.

## License

MIT
