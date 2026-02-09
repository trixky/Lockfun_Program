# Guide: Correct Deployment of a Solana Program with Anchor

## ⚠️ Problem Encountered

During initial deployment, Anchor generated a new keypair with a Program ID different from the one declared in the code (`declare_id!()`), creating a mismatch.

## 🔍 Why does this happen?

Anchor automatically generates a keypair in `target/deploy/` if it doesn't exist. If the `declare_id!()` in the code doesn't match the keypair, Anchor doesn't always detect it automatically and may deploy with a different Program ID.

## ✅ Solution: Correct Deployment Workflow

### Method 1: Synchronize keys BEFORE building (Recommended)

```bash
cd program

# 1. Check/create keypair if necessary
anchor keys list

# 2. Synchronize declare_id with keypair
anchor keys sync

# 3. Verify everything matches
anchor keys list

# 4. Build
anchor build

# 5. Verify Program ID in IDL matches
grep '"address"' target/idl/lockfun.json

# 6. Deploy
anchor deploy --provider.cluster mainnet
```

### Method 2: Use a specific Program ID from the start

If you want to use a specific Program ID:

```bash
# 1. Generate a new keypair with a specific Program ID
solana-keygen new -o target/deploy/lockfun-keypair.json

# 2. Get the Program ID
solana-keygen pubkey target/deploy/lockfun-keypair.json

# 3. Update declare_id in lib.rs
# declare_id!("YOUR_PROGRAM_ID_HERE");

# 4. Update Anchor.toml
# [programs.mainnet]
# lockfun = "YOUR_PROGRAM_ID_HERE"

# 5. Build
anchor build

# 6. Verify everything matches
anchor keys list

# 7. Deploy
anchor deploy --provider.cluster mainnet
```

## 🛡️ Pre-Deployment Checklist

Before deploying to mainnet, ALWAYS verify:

```bash
# 1. Verify Program ID in source code
grep "declare_id" programs/lockfun/src/lib.rs

# 2. Verify Program ID of keypair
solana-keygen pubkey target/deploy/lockfun-keypair.json

# 3. Verify Program ID in Anchor.toml
grep "lockfun" Anchor.toml

# 4. Verify Program ID in generated IDL
grep '"address"' target/idl/lockfun.json

# 5. ALL must match!
```

## 💰 Costs: Upgrade vs Delete + Redeploy

### Upgrade
- Cost: ~2.3 SOL (buffer account + transaction)
- Advantages: 
  - Keeps the same Program ID
  - Preserves history
  - Faster
- Disadvantages:
  - More expensive than initial deployment

### Delete + Redeploy
- Cost: ~1 SOL (initial deployment)
- Recovery: ~2.27 SOL (program account rent)
- Net: **You recover ~1.27 SOL**
- Advantages:
  - Cheaper overall
  - Fresh start
- Disadvantages:
  - **New Program ID** (breaks compatibility)
  - Loses history
  - All PDA accounts become invalid

## ⚠️ WARNING: Delete + Redeploy

**DO NOT DELETE if:**
- The program is already used in production
- PDA accounts already exist
- Other contracts depend on this Program ID
- You want to keep the same Program ID

**OK to DELETE if:**
- It's a new deployment
- No accounts exist yet
- You can change the Program ID

## 🔧 Automatic Verification Script

Use the `verify-before-deploy.sh` script to automatically verify before each deployment.
