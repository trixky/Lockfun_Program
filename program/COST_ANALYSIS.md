# Cost Analysis - Solana Program Deployment

## Current Situation
- **Wallet balance**: 0.959430925 SOL
- **Deployed program**: `57MA23vJ2yS9FV2oL4bz5GcKoXWXGhc25R61PU8dgefD`
- **Program balance**: 2.2748412 SOL (rent)
- **Total available**: 3.234272125 SOL

## Identified Transactions

### 1. First Deployment (2pRb2h...)
- **Program ID**: `C16J1ZLPVMZXZLWXvkR3rsEhsf9hU5f2GRfNzNqgk7W5`
- **Cost**: ~2.27 SOL (program account creation)
- **Result**: Program deployed but with Program ID mismatch

### 2. First Program Deletion
- **Action**: `solana program close C16J1ZLPVMZXZLWXvkR3rsEhsf9hU5f2GRfNzNqgk7W5`
- **Recovery**: 2.2748412 SOL (rent recovered)
- **Net**: +2.27 SOL

### 3. Upgrade Attempt (FAILED)
- **Buffer account created**: `QeeXoYtZbWjT9yjLwRB1KFPQ57gyKPwW8oGqs5y3W7i`
- **Cost**: ~2.27 SOL (buffer account created but never used)
- **Result**: Failed due to insufficient balance
- **⚠️ PROBLEM**: This buffer account still contains ~2.27 SOL that are locked!

### 4. Second Deployment (73Mbgg...)
- **Program ID**: `57MA23vJ2yS9FV2oL4bz5GcKoXWXGhc25R61PU8dgefD`
- **Cost**: ~2.27 SOL (new program account creation)
- **Result**: Program deployed successfully ✅

## Loss Calculation

### SOL Spent
1. First deployment: 2.27 SOL
2. Buffer account (failed upgrade): 2.27 SOL ⚠️ **LOCKED**
3. Second deployment: 2.27 SOL
**Total spent**: 6.81 SOL

### SOL Recovered
1. First program deletion: 2.27 SOL
**Total recovered**: 2.27 SOL

### Net
- **Net loss**: 6.81 - 2.27 = **4.54 SOL**
- **SOL locked in buffer**: **2.27 SOL** (recoverable!)

## ⚠️ SOL LOCKED IN BUFFER ACCOUNT

The buffer account `QeeXoYtZbWjT9yjLwRB1KFPQ57gyKPwW8oGqs5y3W7i` contains ~2.27 SOL that can be recovered!

### How to recover SOL from buffer:

```bash
solana program close QeeXoYtZbWjT9yjLwRB1KFPQ57gyKPwW8oGqs5y3W7i
```

**Note**: You will need the buffer account's keypair or seed phrase to recover these funds. If you don't have access to the keypair, these funds cannot be recovered.

## Summary

- **SOL actually lost**: 2.27 SOL (first deployment + second deployment - recovery)
- **Recoverable SOL**: 2.27 SOL (in buffer account, if you have the keypair)
- **SOL in current program**: 2.27 SOL (rent, recoverable if you delete the program)

**Total if you recover the buffer**: 0.96 + 2.27 = **3.23 SOL**
