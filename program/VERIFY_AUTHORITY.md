# Guide: Verify Solana Program Upgrade Authority

Before deploying to mainnet, it is **crucial** to verify that your wallet has the authority to upgrade and delete the program.

## Method 1: Automatic Script (Recommended)

```bash
cd program
./scripts/verify-upgrade-authority.sh mainnet
```

## Method 2: Manual Commands with solana-cli

### 1. Configure mainnet cluster

```bash
solana config set --url https://api.mainnet-beta.solana.com
```

### 2. Verify your current wallet

```bash
solana address
```

Note this address - this is the one that should be the upgrade authority.

### 3. Check the program's upgrade authority

```bash
solana program show GaVb9PQr9eTnFe6zVAKwUyfCCDbp7dR1KqdJrFnQRexQ
```

This command will display:
- **ProgramId**: The program ID
- **Authority**: The address that has authority to upgrade/delete (this is what we're looking for!)
- **Data**: Program information

### 4. Compare the addresses

Compare the displayed **Authority** with your wallet address (step 2).

- ✅ **If they match**: You have the authority, you can upgrade/delete
- ❌ **If they differ**: You do NOT have the authority with this wallet

## Expected Output Example

```bash
$ solana program show GaVb9PQr9eTnFe6zVAKwUyfCCDbp7dR1KqdJrFnQRexQ

Program Id: GaVb9PQr9eTnFe6zVAKwUyfCCDbp7dR1KqdJrFnQRexQ
Owner: BPFLoaderUpgradeab1e11111111111111111111111
ProgramData Address: <ADDRESS>
Authority: <YOUR_WALLET_ADDRESS>  ← This is what we verify!
```

## Verification Before First Deployment

If the program doesn't exist yet on mainnet, the `solana program show` command will return an error. In this case:

1. The program will be deployed with your current wallet as the upgrade authority
2. Verify you're using the correct wallet with `solana address`
3. Make sure this wallet is the one configured in `Anchor.toml` (line `wallet = "~/.config/solana/id.json"`)

## Verification After Deployment

After deploying the program, immediately run:

```bash
solana program show GaVb9PQr9eTnFe6zVAKwUyfCCDbp7dR1KqdJrFnQRexQ
```

Verify that the **Authority** matches your wallet.

## Additional Useful Commands

### View complete Solana configuration

```bash
solana config get
```

### Change wallet (if necessary)

```bash
solana config set --keypair ~/.config/solana/id.json
```

### Check wallet balance

```bash
solana balance
```

## ⚠️ Important

- **NEVER** deploy a program without verifying the upgrade authority
- If you lose access to the wallet that is the upgrade authority, you will **never** be able to upgrade or delete the program
- Consider using a dedicated wallet (multisig or hardware wallet) for the upgrade authority in production

## Transfer Authority (if necessary)

If you need to transfer authority to another wallet:

```bash
solana program set-upgrade-authority GaVb9PQr9eTnFe6zVAKwUyfCCDbp7dR1KqdJrFnQRexQ \
  --new-upgrade-authority <NEW_ADDRESS>
```

Or to make the program immutable (remove authority):

```bash
solana program set-upgrade-authority GaVb9PQr9eTnFe6zVAKwUyfCCDbp7dR1KqdJrFnQRexQ \
  --finalize
```

⚠️ **Warning**: `--finalize` makes the program **permanent** and **non-upgradeable**. Use with caution!
