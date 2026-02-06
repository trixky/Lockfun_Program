# B3drok Solana Program

Permissionless writing on Solana with flat fees.

## Overview

This Anchor program allows anyone to write messages on-chain with:
- Unique incremental message IDs
- Timestamps
- Optional parent references (for comments/replies)
- Configurable flat fees (default: 0)

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

## Program Structure

### Accounts

- **GlobalState** (PDA: `["global_state"]`)
  - `counter`: Incremental message ID counter
  - `fee_lamports`: Flat fee per write (0 = free)
  - `authority`: Admin wallet

- **FeeVault** (PDA: `["fee_vault"]`)
  - System account holding collected fees

- **Message** (PDA: `["message", id]`)
  - `id`: Unique message ID
  - `parent_id`: Optional parent message (for replies)
  - `timestamp`: Unix timestamp
  - `writer`: Author's public key
  - `content`: Message text (max 280 chars)

### Instructions

1. **initialize(initial_fee_lamports)**
   - Creates GlobalState and FeeVault
   - Sets authority and initial fee

2. **write(content, parent_id)**
   - Permissionless
   - Creates new Message account
   - Pays fee if > 0

3. **set_fee(new_fee_lamports)**
   - Authority only
   - Updates write fee (can be 0)

4. **withdraw_fees(amount)**
   - Authority only
   - Withdraw from fee vault
   - Amount = 0 withdraws all

## Frontend Integration

### Fetch messages by user
```typescript
const messages = await program.account.message.all([
  {
    memcmp: {
      offset: 8 + 8 + 9 + 8, // discriminator + id + parent_id + timestamp
      bytes: userPublicKey.toBase58(),
    },
  },
]);
```

### Fetch replies to a message
```typescript
const parentIdBuffer = Buffer.alloc(9);
parentIdBuffer[0] = 1; // Some(...)
new anchor.BN(parentMessageId).toArrayLike(Buffer, "le", 8).copy(parentIdBuffer, 1);

const replies = await program.account.message.all([
  {
    memcmp: {
      offset: 8 + 8, // discriminator + id
      bytes: bs58.encode(parentIdBuffer),
    },
  },
]);
```

## License

MIT


























