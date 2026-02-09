use anchor_lang::prelude::*;
use anchor_spl::token_interface::{self, Mint, TokenAccount, TokenInterface, TransferChecked};

declare_id!("57MA23vJ2yS9FV2oL4bz5GcKoXWXGhc25R61PU8dgefD");

/// Seeds for PDA derivation
pub const GLOBAL_STATE_SEED: &[u8] = b"global_state";
pub const LOCK_SEED: &[u8] = b"lock";
pub const VAULT_SEED: &[u8] = b"vault";

/// Fee amount in lamports (0.03 SOL = 30,000,000 lamports)
pub const FEE_AMOUNT: u64 = 30_000_000;

/// Fee recipient address
pub const FEE_RECIPIENT: Pubkey = ::solana_program::pubkey!("CsJ1qQSA7hsxAH27cqENqhTy7vBUcdMdVQXAMubJniPo");

#[program]
pub mod lockfun {
    use super::*;

    /// Initialize the program with global state
    pub fn initialize(ctx: Context<Initialize>) -> Result<()> {
        let global_state = &mut ctx.accounts.global_state;
        global_state.authority = ctx.accounts.authority.key();
        global_state.lock_counter = 0;
        msg!("Lockfun initialized!");
        Ok(())
    }

    /// Lock tokens until a specific timestamp
    /// - Creates a Lock account with unique id
    /// - Transfers tokens to a vault PDA
    /// - Only the owner can unlock after the timestamp
    pub fn lock(ctx: Context<LockTokens>, amount: u64, unlock_timestamp: i64) -> Result<()> {
        require!(amount > 0, ErrorCode::AmountZero);

        let current_ts = Clock::get()?.unix_timestamp;
        require!(unlock_timestamp > current_ts, ErrorCode::TimestampInPast);

        let global_state = &mut ctx.accounts.global_state;
        // Assign sequential ID to this lock (represents which lock this is: 1st, 2nd, 3rd, etc.)
        let lock_id = global_state.lock_counter;

        // Populate lock account
        let lock = &mut ctx.accounts.lock;
        lock.id = lock_id; // Store the sequential number in the lock account
        lock.owner = ctx.accounts.owner.key();
        lock.mint = ctx.accounts.mint.key();
        lock.amount = amount;
        lock.unlock_timestamp = unlock_timestamp;
        lock.created_at = current_ts;
        lock.vault_bump = ctx.bumps.vault;
        lock.is_unlocked = false;

        // Get decimals for transfer
        let decimals = ctx.accounts.mint.decimals;

        // Transfer tokens from owner to vault
        token_interface::transfer_checked(
            CpiContext::new(
                ctx.accounts.token_program.to_account_info(),
                TransferChecked {
                    from: ctx.accounts.owner_token_account.to_account_info(),
                    mint: ctx.accounts.mint.to_account_info(),
                    to: ctx.accounts.vault.to_account_info(),
                    authority: ctx.accounts.owner.to_account_info(),
                },
            ),
            amount,
            decimals,
        )?;

        // Transfer fee (0.03 SOL) to fee recipient
        anchor_lang::system_program::transfer(
            CpiContext::new(
                ctx.accounts.system_program.to_account_info(),
                anchor_lang::system_program::Transfer {
                    from: ctx.accounts.owner.to_account_info(),
                    to: ctx.accounts.fee_recipient.to_account_info(),
                },
            ),
            FEE_AMOUNT,
        )?;

        // Increment the global counter for the next lock
        // This allows easy fetching of total lock count and recent locks
        global_state.lock_counter = global_state.lock_counter.checked_add(1).unwrap();

        msg!(
            "Locked {} tokens of mint {} until timestamp {} (lock #{})",
            amount,
            lock.mint,
            unlock_timestamp,
            lock_id
        );

        Ok(())
    }

    /// Unlock tokens after the timestamp has passed
    /// - Only the original owner can unlock
    /// - Transfers tokens from vault back to owner
    pub fn unlock(ctx: Context<UnlockTokens>) -> Result<()> {
        // Prevent duplicate mutable accounts attack
        require!(
            ctx.accounts.vault.key() != ctx.accounts.owner_token_account.key(),
            ErrorCode::DuplicateAccounts
        );

        let lock = &ctx.accounts.lock;

        require!(!lock.is_unlocked, ErrorCode::AlreadyUnlocked);

        let current_ts = Clock::get()?.unix_timestamp;
        require!(current_ts >= lock.unlock_timestamp, ErrorCode::TooEarly);

        let amount = lock.amount;
        let lock_id_bytes = lock.id.to_le_bytes();
        let decimals = ctx.accounts.mint.decimals;

        // Transfer tokens from vault back to owner using PDA signer
        let seeds = &[VAULT_SEED, lock_id_bytes.as_ref(), &[lock.vault_bump]];
        let signer_seeds = &[&seeds[..]];

        token_interface::transfer_checked(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                TransferChecked {
                    from: ctx.accounts.vault.to_account_info(),
                    mint: ctx.accounts.mint.to_account_info(),
                    to: ctx.accounts.owner_token_account.to_account_info(),
                    authority: ctx.accounts.vault.to_account_info(),
                },
                signer_seeds,
            ),
            amount,
            decimals,
        )?;

        // Mark as unlocked
        let lock = &mut ctx.accounts.lock;
        lock.is_unlocked = true;

        msg!("Unlocked {} tokens from lock #{}", amount, lock.id);

        Ok(())
    }

    /// Add more tokens to an existing lock
    /// - Only the lock owner can add tokens
    /// - Lock must not be unlocked
    /// - Mint must match the existing lock
    pub fn top_up(ctx: Context<TopUpLock>, additional_amount: u64) -> Result<()> {
        // Prevent duplicate mutable accounts attack
        require!(
            ctx.accounts.vault.key() != ctx.accounts.owner_token_account.key(),
            ErrorCode::DuplicateAccounts
        );

        require!(additional_amount > 0, ErrorCode::AmountZero);

        let lock = &mut ctx.accounts.lock;

        require!(!lock.is_unlocked, ErrorCode::AlreadyUnlocked);

        let decimals = ctx.accounts.mint.decimals;

        // Transfer additional tokens from owner to vault
        token_interface::transfer_checked(
            CpiContext::new(
                ctx.accounts.token_program.to_account_info(),
                TransferChecked {
                    from: ctx.accounts.owner_token_account.to_account_info(),
                    mint: ctx.accounts.mint.to_account_info(),
                    to: ctx.accounts.vault.to_account_info(),
                    authority: ctx.accounts.owner.to_account_info(),
                },
            ),
            additional_amount,
            decimals,
        )?;

        // Update lock amount
        lock.amount = lock.amount.checked_add(additional_amount).unwrap();

        msg!(
            "Added {} tokens to lock #{} (new total: {})",
            additional_amount,
            lock.id,
            lock.amount
        );

        Ok(())
    }

    /// Extend the unlock timestamp of an existing lock
    /// - Only the lock owner can extend
    /// - Lock must not be unlocked
    /// - New timestamp must be greater than current timestamp (can only extend, not shorten)
    pub fn extend(ctx: Context<ExtendLock>, new_unlock_timestamp: i64) -> Result<()> {
        let lock = &mut ctx.accounts.lock;

        require!(!lock.is_unlocked, ErrorCode::AlreadyUnlocked);
        require!(
            new_unlock_timestamp > lock.unlock_timestamp,
            ErrorCode::CannotShortenTimestamp
        );

        let old_timestamp = lock.unlock_timestamp;
        lock.unlock_timestamp = new_unlock_timestamp;

        msg!(
            "Extended lock #{} unlock timestamp from {} to {}",
            lock.id,
            old_timestamp,
            new_unlock_timestamp
        );

        Ok(())
    }
}

// ============================================================================
// Accounts
// ============================================================================

#[account]
#[derive(InitSpace)]
pub struct GlobalState {
    /// Authority (admin)
    pub authority: Pubkey,
    /// Counter for unique lock IDs
    /// This represents the total number of locks created.
    /// When a new lock is created, this counter is incremented and
    /// the new lock's ID is set to the current counter value.
    /// To fetch the latest locks, query locks with IDs from (lock_counter - N) to (lock_counter - 1).
    pub lock_counter: u64,
}

#[account]
#[derive(InitSpace)]
pub struct Lock {
    /// Unique lock ID (for PDA derivation)
    /// This is a sequential number representing which lock this is (1st, 2nd, 3rd, etc.)
    /// The ID is assigned from GlobalState.lock_counter when the lock is created.
    /// Offset: 8 (discriminator)
    pub id: u64,
    /// Owner who locked the tokens
    /// Offset: 8 + 8 = 16
    pub owner: Pubkey,
    /// Token mint address
    /// Offset: 8 + 8 + 32 = 48
    pub mint: Pubkey,
    /// Amount of tokens locked
    /// Offset: 8 + 8 + 32 + 32 = 80
    pub amount: u64,
    /// Unix timestamp when tokens can be unlocked
    /// Offset: 8 + 8 + 32 + 32 + 8 = 88
    pub unlock_timestamp: i64,
    /// Unix timestamp when lock was created (for sorting/pagination)
    /// Offset: 8 + 8 + 32 + 32 + 8 + 8 = 96
    pub created_at: i64,
    /// Bump seed for the vault PDA
    /// Offset: 8 + 8 + 32 + 32 + 8 + 8 + 8 = 104
    pub vault_bump: u8,
    /// Whether tokens have been unlocked
    /// Offset: 8 + 8 + 32 + 32 + 8 + 8 + 8 + 1 = 105
    pub is_unlocked: bool,
}

// ============================================================================
// Instruction Contexts
// ============================================================================

#[derive(Accounts)]
pub struct Initialize<'info> {
    #[account(
        init,
        payer = authority,
        space = 8 + GlobalState::INIT_SPACE,
        seeds = [GLOBAL_STATE_SEED],
        bump
    )]
    pub global_state: Account<'info, GlobalState>,

    #[account(mut)]
    pub authority: Signer<'info>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct LockTokens<'info> {
    #[account(
        mut,
        seeds = [GLOBAL_STATE_SEED],
        bump
    )]
    pub global_state: Account<'info, GlobalState>,

    #[account(
        init,
        payer = owner,
        space = 8 + Lock::INIT_SPACE,
        seeds = [LOCK_SEED, &global_state.lock_counter.to_le_bytes()],
        bump
    )]
    pub lock: Account<'info, Lock>,

    /// Vault to hold the locked tokens (PDA-owned token account)
    #[account(
        init,
        payer = owner,
        token::mint = mint,
        token::authority = vault,
        seeds = [VAULT_SEED, &global_state.lock_counter.to_le_bytes()],
        bump
    )]
    pub vault: InterfaceAccount<'info, TokenAccount>,

    /// The token mint
    pub mint: InterfaceAccount<'info, Mint>,

    /// Owner's token account (source of tokens)
    #[account(
        mut,
        token::mint = mint,
        token::authority = owner
    )]
    pub owner_token_account: InterfaceAccount<'info, TokenAccount>,

    #[account(mut)]
    pub owner: Signer<'info>,

    /// Fee recipient account (receives 0.03 SOL per lock creation)
    /// CHECK: Address is validated to match the hardcoded fee recipient
    #[account(
        mut,
        address = FEE_RECIPIENT @ ErrorCode::InvalidFeeRecipient
    )]
    pub fee_recipient: AccountInfo<'info>,

    pub token_program: Interface<'info, TokenInterface>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct UnlockTokens<'info> {
    #[account(
        mut,
        seeds = [LOCK_SEED, &lock.id.to_le_bytes()],
        bump,
        has_one = owner @ ErrorCode::Unauthorized,
        has_one = mint @ ErrorCode::InvalidMint
    )]
    pub lock: Account<'info, Lock>,

    /// Vault holding the locked tokens
    #[account(
        mut,
        seeds = [VAULT_SEED, &lock.id.to_le_bytes()],
        bump = lock.vault_bump
    )]
    pub vault: InterfaceAccount<'info, TokenAccount>,

    /// The token mint
    pub mint: InterfaceAccount<'info, Mint>,

    /// Owner's token account (destination for tokens)
    #[account(
        mut,
        token::mint = mint,
        token::authority = owner
    )]
    pub owner_token_account: InterfaceAccount<'info, TokenAccount>,

    /// Original owner who locked the tokens
    pub owner: Signer<'info>,

    pub token_program: Interface<'info, TokenInterface>,
}

#[derive(Accounts)]
pub struct TopUpLock<'info> {
    #[account(
        mut,
        seeds = [LOCK_SEED, &lock.id.to_le_bytes()],
        bump,
        has_one = owner @ ErrorCode::Unauthorized,
        has_one = mint @ ErrorCode::InvalidMint
    )]
    pub lock: Account<'info, Lock>,

    /// Vault holding the locked tokens
    #[account(
        mut,
        seeds = [VAULT_SEED, &lock.id.to_le_bytes()],
        bump = lock.vault_bump
    )]
    pub vault: InterfaceAccount<'info, TokenAccount>,

    /// The token mint (must match lock.mint)
    pub mint: InterfaceAccount<'info, Mint>,

    /// Owner's token account (source of additional tokens)
    #[account(
        mut,
        token::mint = mint,
        token::authority = owner
    )]
    pub owner_token_account: InterfaceAccount<'info, TokenAccount>,

    /// Lock owner who wants to add tokens
    #[account(mut)]
    pub owner: Signer<'info>,

    pub token_program: Interface<'info, TokenInterface>,
}

#[derive(Accounts)]
pub struct ExtendLock<'info> {
    #[account(
        mut,
        seeds = [LOCK_SEED, &lock.id.to_le_bytes()],
        bump,
        has_one = owner @ ErrorCode::Unauthorized
    )]
    pub lock: Account<'info, Lock>,

    /// Lock owner who wants to extend the duration
    pub owner: Signer<'info>,
}

// ============================================================================
// Errors
// ============================================================================

#[error_code]
pub enum ErrorCode {
    #[msg("Unauthorized - only the lock owner can unlock")]
    Unauthorized,
    #[msg("Amount must be greater than zero")]
    AmountZero,
    #[msg("Unlock timestamp must be in the future")]
    TimestampInPast,
    #[msg("Cannot unlock yet - timestamp not reached")]
    TooEarly,
    #[msg("Tokens have already been unlocked")]
    AlreadyUnlocked,
    #[msg("Invalid mint")]
    InvalidMint,
    #[msg("Cannot shorten unlock timestamp - can only extend")]
    CannotShortenTimestamp,
    #[msg("Duplicate accounts detected - vault and owner token account must be different")]
    DuplicateAccounts,
    #[msg("Invalid fee recipient address")]
    InvalidFeeRecipient,
}
