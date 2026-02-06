use anchor_lang::prelude::*;
use anchor_spl::token_interface::{self, Mint, TokenAccount, TokenInterface, TransferChecked};

declare_id!("GaVb9PQr9eTnFe6zVAKwUyfCCDbp7dR1KqdJrFnQRexQ");

/// Seeds for PDA derivation
pub const GLOBAL_STATE_SEED: &[u8] = b"global_state";
pub const LOCK_SEED: &[u8] = b"lock";
pub const VAULT_SEED: &[u8] = b"vault";

#[program]
pub mod timelock_supply {
    use super::*;

    /// Initialize the program with global state
    pub fn initialize(ctx: Context<Initialize>) -> Result<()> {
        let global_state = &mut ctx.accounts.global_state;
        global_state.authority = ctx.accounts.authority.key();
        global_state.lock_counter = 0;
        msg!("Timelock initialized!");
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
        let lock_id = global_state.lock_counter;

        // Populate lock account
        let lock = &mut ctx.accounts.lock;
        lock.id = lock_id;
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

        // Increment counter
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
    pub lock_counter: u64,
}

#[account]
#[derive(InitSpace)]
pub struct Lock {
    /// Unique lock ID (for PDA derivation)
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
}
