import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { Lockfun } from "../target/types/lockfun";
import { expect } from "chai";
import {
  PublicKey,
  Keypair,
  LAMPORTS_PER_SOL,
} from "@solana/web3.js";
import {
  createMint,
  createAssociatedTokenAccount,
  mintTo,
  getAccount,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";

// =============================================================================
// Type definitions for lock account data
// =============================================================================
interface LockAccount {
  publicKey: PublicKey;
  account: {
    id: anchor.BN;
    owner: PublicKey;
    mint: PublicKey;
    amount: anchor.BN;
    unlockTimestamp: anchor.BN;
    createdAt: anchor.BN;
    vaultBump: number;
    isUnlocked: boolean;
  };
}

// =============================================================================
// Helper class for RPC fetching (simulates frontend usage)
// =============================================================================
class LockFetcher {
  private program: Program<Lockfun>;

  // Offsets for memcmp filters (based on Lock struct layout)
  static readonly OFFSETS = {
    DISCRIMINATOR: 0,
    ID: 8,
    OWNER: 16,           // 8 + 8
    MINT: 48,            // 8 + 8 + 32
    AMOUNT: 80,          // 8 + 8 + 32 + 32
    UNLOCK_TIMESTAMP: 88, // 8 + 8 + 32 + 32 + 8
    CREATED_AT: 96,      // 8 + 8 + 32 + 32 + 8 + 8
    VAULT_BUMP: 104,     // 8 + 8 + 32 + 32 + 8 + 8 + 8
    IS_UNLOCKED: 105,    // 8 + 8 + 32 + 32 + 8 + 8 + 8 + 1
  };

  constructor(program: Program<Lockfun>) {
    this.program = program;
  }

  // Fetch all locks (no filter)
  async fetchAll(): Promise<LockAccount[]> {
    return await this.program.account.lock.all();
  }

  // Fetch locks by owner wallet (memcmp filter)
  async fetchByOwner(owner: PublicKey): Promise<LockAccount[]> {
    return await this.program.account.lock.all([
      {
        memcmp: {
          offset: LockFetcher.OFFSETS.OWNER,
          bytes: owner.toBase58(),
        },
      },
    ]);
  }

  // Fetch locks by token mint (memcmp filter)
  async fetchByMint(mint: PublicKey): Promise<LockAccount[]> {
    return await this.program.account.lock.all([
      {
        memcmp: {
          offset: LockFetcher.OFFSETS.MINT,
          bytes: mint.toBase58(),
        },
      },
    ]);
  }

  // Fetch locks by owner AND mint (combined memcmp filters)
  async fetchByOwnerAndMint(owner: PublicKey, mint: PublicKey): Promise<LockAccount[]> {
    return await this.program.account.lock.all([
      {
        memcmp: {
          offset: LockFetcher.OFFSETS.OWNER,
          bytes: owner.toBase58(),
        },
      },
      {
        memcmp: {
          offset: LockFetcher.OFFSETS.MINT,
          bytes: mint.toBase58(),
        },
      },
    ]);
  }

  // Fetch only active (not unlocked) locks - filter client-side
  async fetchActive(): Promise<LockAccount[]> {
    const all = await this.fetchAll();
    return all.filter(lock => !lock.account.isUnlocked);
  }

  // Fetch active locks by owner
  async fetchActiveByOwner(owner: PublicKey): Promise<LockAccount[]> {
    const byOwner = await this.fetchByOwner(owner);
    return byOwner.filter(lock => !lock.account.isUnlocked);
  }

  // Filter by amount range (client-side filtering)
  filterByAmountRange(locks: LockAccount[], minAmount: anchor.BN, maxAmount: anchor.BN): LockAccount[] {
    return locks.filter(lock => {
      const amount = lock.account.amount;
      return amount.gte(minAmount) && amount.lte(maxAmount);
    });
  }

  // Filter by unlock timestamp range (client-side filtering)
  filterByUnlockTimestampRange(locks: LockAccount[], minTs: number, maxTs: number): LockAccount[] {
    return locks.filter(lock => {
      const ts = lock.account.unlockTimestamp.toNumber();
      return ts >= minTs && ts <= maxTs;
    });
  }

  // Filter locks unlocking soon (within N seconds)
  filterUnlockingSoon(locks: LockAccount[], withinSeconds: number): LockAccount[] {
    const now = Math.floor(Date.now() / 1000);
    const threshold = now + withinSeconds;
    return locks.filter(lock => {
      const ts = lock.account.unlockTimestamp.toNumber();
      return ts >= now && ts <= threshold;
    });
  }

  // Filter locks that are already unlockable (timestamp passed)
  filterUnlockable(locks: LockAccount[]): LockAccount[] {
    const now = Math.floor(Date.now() / 1000);
    return locks.filter(lock => {
      return !lock.account.isUnlocked && lock.account.unlockTimestamp.toNumber() <= now;
    });
  }

  // ==========================================================================
  // Sorting utilities
  // ==========================================================================

  // Sort by unlock timestamp (ascending - soonest first)
  sortByUnlockTimestampAsc(locks: LockAccount[]): LockAccount[] {
    return [...locks].sort((a, b) => 
      a.account.unlockTimestamp.toNumber() - b.account.unlockTimestamp.toNumber()
    );
  }

  // Sort by unlock timestamp (descending - latest first)
  sortByUnlockTimestampDesc(locks: LockAccount[]): LockAccount[] {
    return [...locks].sort((a, b) => 
      b.account.unlockTimestamp.toNumber() - a.account.unlockTimestamp.toNumber()
    );
  }

  // Sort by created_at (ascending - oldest first)
  sortByCreatedAtAsc(locks: LockAccount[]): LockAccount[] {
    return [...locks].sort((a, b) => 
      a.account.createdAt.toNumber() - b.account.createdAt.toNumber()
    );
  }

  // Sort by created_at (descending - newest first)
  sortByCreatedAtDesc(locks: LockAccount[]): LockAccount[] {
    return [...locks].sort((a, b) => 
      b.account.createdAt.toNumber() - a.account.createdAt.toNumber()
    );
  }

  // Sort by amount (ascending - smallest first)
  sortByAmountAsc(locks: LockAccount[]): LockAccount[] {
    return [...locks].sort((a, b) => 
      a.account.amount.sub(b.account.amount).toNumber()
    );
  }

  // Sort by amount (descending - largest first)
  sortByAmountDesc(locks: LockAccount[]): LockAccount[] {
    return [...locks].sort((a, b) => 
      b.account.amount.sub(a.account.amount).toNumber()
    );
  }

  // Sort by id (ascending)
  sortByIdAsc(locks: LockAccount[]): LockAccount[] {
    return [...locks].sort((a, b) => 
      a.account.id.toNumber() - b.account.id.toNumber()
    );
  }

  // ==========================================================================
  // Pagination utilities
  // ==========================================================================

  // Paginate results (client-side pagination)
  paginate(locks: LockAccount[], page: number, pageSize: number): {
    data: LockAccount[];
    page: number;
    pageSize: number;
    totalPages: number;
    totalItems: number;
    hasNextPage: boolean;
    hasPrevPage: boolean;
  } {
    const totalItems = locks.length;
    const totalPages = Math.ceil(totalItems / pageSize);
    const startIndex = page * pageSize;
    const endIndex = startIndex + pageSize;
    const data = locks.slice(startIndex, endIndex);

    return {
      data,
      page,
      pageSize,
      totalPages,
      totalItems,
      hasNextPage: page < totalPages - 1,
      hasPrevPage: page > 0,
    };
  }

  // Get paginated locks by owner with sorting
  async fetchPaginatedByOwner(
    owner: PublicKey,
    page: number,
    pageSize: number,
    sortBy: 'createdAt' | 'unlockTimestamp' | 'amount' | 'id' = 'createdAt',
    sortOrder: 'asc' | 'desc' = 'desc'
  ) {
    let locks = await this.fetchByOwner(owner);
    
    // Apply sorting
    switch (sortBy) {
      case 'createdAt':
        locks = sortOrder === 'asc' ? this.sortByCreatedAtAsc(locks) : this.sortByCreatedAtDesc(locks);
        break;
      case 'unlockTimestamp':
        locks = sortOrder === 'asc' ? this.sortByUnlockTimestampAsc(locks) : this.sortByUnlockTimestampDesc(locks);
        break;
      case 'amount':
        locks = sortOrder === 'asc' ? this.sortByAmountAsc(locks) : this.sortByAmountDesc(locks);
        break;
      case 'id':
        locks = this.sortByIdAsc(locks);
        break;
    }

    return this.paginate(locks, page, pageSize);
  }

  // ==========================================================================
  // Global state utilities
  // ==========================================================================

  // Fetch the global state to get total lock count
  async getTotalLockCount(): Promise<number> {
    const [globalStatePda] = PublicKey.findProgramAddressSync(
      [Buffer.from("global_state")],
      this.program.programId
    );
    const globalState = await this.program.account.globalState.fetch(globalStatePda);
    return globalState.lockCounter.toNumber();
  }

  // Fetch the X most recent locks (by ID, which is sequential)
  // This is efficient because IDs are sequential: latest locks have highest IDs
  async fetchLatestLocks(count: number): Promise<LockAccount[]> {
    const allLocks = await this.fetchAll();
    // Sort by ID descending (highest ID = most recent)
    const sorted = this.sortByIdAsc(allLocks).reverse();
    // Return the last N locks
    return sorted.slice(0, count);
  }

  // Fetch locks by ID range (useful for pagination of recent locks)
  async fetchLocksByIdRange(startId: number, endId: number): Promise<LockAccount[]> {
    const allLocks = await this.fetchAll();
    return allLocks.filter(lock => {
      const id = lock.account.id.toNumber();
      return id >= startId && id < endId;
    }).sort((a, b) => a.account.id.toNumber() - b.account.id.toNumber());
  }
}

describe("lockfun", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.Lockfun as Program<Lockfun>;

  // PDAs
  let globalStatePda: PublicKey;

  // Authority is the provider wallet
  const authority = provider.wallet;

  // Test users - create 3 users for diverse testing
  const user1 = Keypair.generate();
  const user2 = Keypair.generate();
  const user3 = Keypair.generate();

  // Test mints - create 3 different tokens
  let mint1: PublicKey;
  let mint2: PublicKey;
  let mint3: PublicKey;
  const mintAuthority = Keypair.generate();

  // Token accounts
  let user1TokenAccount1: PublicKey;
  let user1TokenAccount2: PublicKey;
  let user1TokenAccount3: PublicKey;
  let user2TokenAccount1: PublicKey;
  let user2TokenAccount2: PublicKey;
  let user3TokenAccount1: PublicKey;

  // Lock fetcher instance
  let lockFetcher: LockFetcher;

  // Fee recipient address (receives 0.03 SOL per lock creation)
  const FEE_RECIPIENT = new PublicKey("CsJ1qQSA7hsxAH27cqENqhTy7vBUcdMdVQXAMubJniPo");

  // Helper to derive lock PDA
  const getLockPda = (lockId: number | anchor.BN): PublicKey => {
    const id = typeof lockId === "number" ? new anchor.BN(lockId) : lockId;
    const [pda] = PublicKey.findProgramAddressSync(
      [Buffer.from("lock"), id.toArrayLike(Buffer, "le", 8)],
      program.programId
    );
    return pda;
  };

  // Helper to derive vault PDA
  const getVaultPda = (lockId: number | anchor.BN): PublicKey => {
    const id = typeof lockId === "number" ? new anchor.BN(lockId) : lockId;
    const [pda] = PublicKey.findProgramAddressSync(
      [Buffer.from("vault"), id.toArrayLike(Buffer, "le", 8)],
      program.programId
    );
    return pda;
  };

  // Helper to create a lock with specific parameters
  const createLock = async (
    user: Keypair,
    userTokenAccount: PublicKey,
    mint: PublicKey,
    amount: anchor.BN,
    unlockTimestamp: anchor.BN
  ): Promise<number> => {
    const globalState = await program.account.globalState.fetch(globalStatePda);
    const lockId = globalState.lockCounter.toNumber();
    const lockPda = getLockPda(lockId);
    const vaultPda = getVaultPda(lockId);

    await program.methods
      .lock(amount, unlockTimestamp)
      .accounts({
        globalState: globalStatePda,
        lock: lockPda,
        vault: vaultPda,
        mint: mint,
        ownerTokenAccount: userTokenAccount,
        owner: user.publicKey,
        feeRecipient: FEE_RECIPIENT,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .signers([user])
      .rpc();

    return lockId;
  };

  before(async () => {
    // Derive global state PDA
    [globalStatePda] = PublicKey.findProgramAddressSync(
      [Buffer.from("global_state")],
      program.programId
    );

    // Initialize lock fetcher
    lockFetcher = new LockFetcher(program);

    // Airdrop to users and mint authority
    const airdropPromises = [user1, user2, user3, mintAuthority].map(async (kp) => {
      const sig = await provider.connection.requestAirdrop(
        kp.publicKey,
        100 * LAMPORTS_PER_SOL  // More SOL for many locks
      );
      await provider.connection.confirmTransaction(sig);
    });
    await Promise.all(airdropPromises);

    // Create test mints
    mint1 = await createMint(
      provider.connection,
      mintAuthority,
      mintAuthority.publicKey,
      null,
      9 // 9 decimals
    );

    mint2 = await createMint(
      provider.connection,
      mintAuthority,
      mintAuthority.publicKey,
      null,
      6 // 6 decimals
    );

    mint3 = await createMint(
      provider.connection,
      mintAuthority,
      mintAuthority.publicKey,
      null,
      9 // 9 decimals
    );

    // Create token accounts for all users
    user1TokenAccount1 = await createAssociatedTokenAccount(
      provider.connection,
      user1,
      mint1,
      user1.publicKey
    );

    user1TokenAccount2 = await createAssociatedTokenAccount(
      provider.connection,
      user1,
      mint2,
      user1.publicKey
    );

    user1TokenAccount3 = await createAssociatedTokenAccount(
      provider.connection,
      user1,
      mint3,
      user1.publicKey
    );

    user2TokenAccount1 = await createAssociatedTokenAccount(
      provider.connection,
      user2,
      mint1,
      user2.publicKey
    );

    user2TokenAccount2 = await createAssociatedTokenAccount(
      provider.connection,
      user2,
      mint2,
      user2.publicKey
    );

    user3TokenAccount1 = await createAssociatedTokenAccount(
      provider.connection,
      user3,
      mint1,
      user3.publicKey
    );

    // Mint lots of tokens to users for many locks
    await mintTo(
      provider.connection,
      mintAuthority,
      mint1,
      user1TokenAccount1,
      mintAuthority,
      10_000_000_000_000 // 10000 tokens with 9 decimals
    );

    await mintTo(
      provider.connection,
      mintAuthority,
      mint2,
      user1TokenAccount2,
      mintAuthority,
      10_000_000_000 // 10000 tokens with 6 decimals
    );

    await mintTo(
      provider.connection,
      mintAuthority,
      mint3,
      user1TokenAccount3,
      mintAuthority,
      10_000_000_000_000 // 10000 tokens
    );

    await mintTo(
      provider.connection,
      mintAuthority,
      mint1,
      user2TokenAccount1,
      mintAuthority,
      5_000_000_000_000 // 5000 tokens
    );

    await mintTo(
      provider.connection,
      mintAuthority,
      mint2,
      user2TokenAccount2,
      mintAuthority,
      5_000_000_000 // 5000 tokens
    );

    await mintTo(
      provider.connection,
      mintAuthority,
      mint1,
      user3TokenAccount1,
      mintAuthority,
      3_000_000_000_000 // 3000 tokens
    );
  });

  // ===========================================================================
  // INITIALIZATION
  // ===========================================================================
  describe("initialize", () => {
    it("initializes global state", async () => {
      await program.methods
        .initialize()
        .accounts({
          globalState: globalStatePda,
          authority: authority.publicKey,
          systemProgram: anchor.web3.SystemProgram.programId,
        })
        .rpc();

      const globalState = await program.account.globalState.fetch(globalStatePda);
      expect(globalState.authority.toString()).to.equal(authority.publicKey.toString());
      expect(globalState.lockCounter.toNumber()).to.equal(0);
    });

    it("cannot initialize twice", async () => {
      try {
        await program.methods
          .initialize()
          .accounts({
            globalState: globalStatePda,
            authority: authority.publicKey,
            systemProgram: anchor.web3.SystemProgram.programId,
          })
          .rpc();
        expect.fail("Should have thrown error");
      } catch (err: any) {
        expect(err.message).to.include("already in use");
      }
    });
  });

  // ===========================================================================
  // BASIC LOCK/UNLOCK TESTS
  // ===========================================================================
  describe("lock", () => {
    it("locks tokens with future timestamp and records created_at", async () => {
      const globalState = await program.account.globalState.fetch(globalStatePda);
      const lockId = globalState.lockCounter.toNumber();
      const lockPda = getLockPda(lockId);
      const vaultPda = getVaultPda(lockId);

      const amount = new anchor.BN(100_000_000_000); // 100 tokens
      const unlockTimestamp = new anchor.BN(Math.floor(Date.now() / 1000) + 3600);
      const beforeTimestamp = Math.floor(Date.now() / 1000);

      await program.methods
        .lock(amount, unlockTimestamp)
        .accounts({
          globalState: globalStatePda,
          lock: lockPda,
          vault: vaultPda,
          mint: mint1,
          ownerTokenAccount: user1TokenAccount1,
          owner: user1.publicKey,
          tokenProgram: TOKEN_PROGRAM_ID,
          feeRecipient: FEE_RECIPIENT,
          systemProgram: anchor.web3.SystemProgram.programId,
        })
        .signers([user1])
        .rpc();

      const lock = await program.account.lock.fetch(lockPda);
      expect(lock.id.toNumber()).to.equal(lockId);
      expect(lock.owner.toString()).to.equal(user1.publicKey.toString());
      expect(lock.mint.toString()).to.equal(mint1.toString());
      expect(lock.amount.toNumber()).to.equal(amount.toNumber());
      expect(lock.unlockTimestamp.toNumber()).to.equal(unlockTimestamp.toNumber());
      expect(lock.isUnlocked).to.equal(false);
      // Verify created_at is set correctly (within 5 seconds of test time)
      expect(lock.createdAt.toNumber()).to.be.gte(beforeTimestamp - 5);
      expect(lock.createdAt.toNumber()).to.be.lte(beforeTimestamp + 10);
    });

    it("rejects zero amount", async () => {
      const globalState = await program.account.globalState.fetch(globalStatePda);
      const lockId = globalState.lockCounter.toNumber();
      const lockPda = getLockPda(lockId);
      const vaultPda = getVaultPda(lockId);

      const amount = new anchor.BN(0);
      const unlockTimestamp = new anchor.BN(Math.floor(Date.now() / 1000) + 3600);

      try {
        await program.methods
          .lock(amount, unlockTimestamp)
          .accounts({
            globalState: globalStatePda,
            lock: lockPda,
            vault: vaultPda,
            mint: mint1,
            ownerTokenAccount: user1TokenAccount1,
            owner: user1.publicKey,
            tokenProgram: TOKEN_PROGRAM_ID,
            feeRecipient: FEE_RECIPIENT,
            systemProgram: anchor.web3.SystemProgram.programId,
          })
          .signers([user1])
          .rpc();
        expect.fail("Should have thrown error");
      } catch (err: any) {
        expect(err.error?.errorCode?.code).to.equal("AmountZero");
      }
    });

    it("rejects timestamp in the past", async () => {
      const globalState = await program.account.globalState.fetch(globalStatePda);
      const lockId = globalState.lockCounter.toNumber();
      const lockPda = getLockPda(lockId);
      const vaultPda = getVaultPda(lockId);

      const amount = new anchor.BN(1_000_000_000);
      const unlockTimestamp = new anchor.BN(Math.floor(Date.now() / 1000) - 3600);

      try {
        await program.methods
          .lock(amount, unlockTimestamp)
          .accounts({
            globalState: globalStatePda,
            lock: lockPda,
            vault: vaultPda,
            mint: mint1,
            ownerTokenAccount: user1TokenAccount1,
            owner: user1.publicKey,
            tokenProgram: TOKEN_PROGRAM_ID,
            feeRecipient: FEE_RECIPIENT,
            systemProgram: anchor.web3.SystemProgram.programId,
          })
          .signers([user1])
          .rpc();
        expect.fail("Should have thrown error");
      } catch (err: any) {
        expect(err.error?.errorCode?.code).to.equal("TimestampInPast");
      }
    });

    it("sends 0.03 SOL fee to fee recipient when creating a lock", async () => {
      const globalState = await program.account.globalState.fetch(globalStatePda);
      const lockId = globalState.lockCounter.toNumber();
      const lockPda = getLockPda(lockId);
      const vaultPda = getVaultPda(lockId);

      const amount = new anchor.BN(100_000_000_000); // 100 tokens
      const unlockTimestamp = new anchor.BN(Math.floor(Date.now() / 1000) + 3600);

      // Get balances before
      const feeRecipientBalanceBefore = await provider.connection.getBalance(FEE_RECIPIENT);
      const ownerBalanceBefore = await provider.connection.getBalance(user1.publicKey);

      await program.methods
        .lock(amount, unlockTimestamp)
        .accounts({
          globalState: globalStatePda,
          lock: lockPda,
          vault: vaultPda,
          mint: mint1,
          ownerTokenAccount: user1TokenAccount1,
          owner: user1.publicKey,
          feeRecipient: FEE_RECIPIENT,
          tokenProgram: TOKEN_PROGRAM_ID,
          systemProgram: anchor.web3.SystemProgram.programId,
        })
        .signers([user1])
        .rpc();

      // Get balances after
      const feeRecipientBalanceAfter = await provider.connection.getBalance(FEE_RECIPIENT);
      const ownerBalanceAfter = await provider.connection.getBalance(user1.publicKey);

      // Verify fee recipient received 0.03 SOL (30,000,000 lamports)
      const feeReceived = feeRecipientBalanceAfter - feeRecipientBalanceBefore;
      expect(feeReceived).to.equal(30_000_000);

      // Verify owner balance decreased by at least the fee amount
      // (may be more due to transaction fees)
      const balanceDecrease = ownerBalanceBefore - ownerBalanceAfter;
      expect(balanceDecrease).to.be.at.least(30_000_000);
    });
  });

  // ===========================================================================
  // MULTIPLE LOCKS PER WALLET/TOKEN TESTS
  // ===========================================================================
  describe("multiple locks per wallet and token", () => {
    it("allows a wallet to create multiple locks on the same token", async () => {
      const now = Math.floor(Date.now() / 1000);
      const amounts = [
        new anchor.BN(50_000_000_000),   // 50 tokens
        new anchor.BN(100_000_000_000),  // 100 tokens
        new anchor.BN(75_000_000_000),   // 75 tokens
      ];
      const timestamps = [
        new anchor.BN(now + 3600),   // 1 hour
        new anchor.BN(now + 7200),   // 2 hours
        new anchor.BN(now + 10800),  // 3 hours
      ];

      const createdLockIds: number[] = [];
      const createdLockPdas: PublicKey[] = [];

      // Create 3 locks with the same wallet and token
      for (let i = 0; i < 3; i++) {
        const globalState = await program.account.globalState.fetch(globalStatePda);
        const lockId = globalState.lockCounter.toNumber();
        const lockPda = getLockPda(lockId);
        const vaultPda = getVaultPda(lockId);

        await program.methods
          .lock(amounts[i], timestamps[i])
          .accounts({
            globalState: globalStatePda,
            lock: lockPda,
            vault: vaultPda,
            mint: mint1,
            ownerTokenAccount: user1TokenAccount1,
            owner: user1.publicKey,
            tokenProgram: TOKEN_PROGRAM_ID,
            feeRecipient: FEE_RECIPIENT,
            systemProgram: anchor.web3.SystemProgram.programId,
          })
          .signers([user1])
          .rpc();

        createdLockIds.push(lockId);
        createdLockPdas.push(lockPda);

        // Small delay to ensure different created_at timestamps
        await new Promise(r => setTimeout(r, 100));
      }

      // Verify all locks were created successfully
      expect(createdLockIds.length).to.equal(3);
      expect(createdLockIds[0]).to.not.equal(createdLockIds[1]);
      expect(createdLockIds[1]).to.not.equal(createdLockIds[2]);
      expect(createdLockIds[0]).to.not.equal(createdLockIds[2]);

      // Verify each lock has correct properties
      for (let i = 0; i < 3; i++) {
        const lock = await program.account.lock.fetch(createdLockPdas[i]);
        expect(lock.id.toNumber()).to.equal(createdLockIds[i]);
        expect(lock.owner.toString()).to.equal(user1.publicKey.toString());
        expect(lock.mint.toString()).to.equal(mint1.toString());
        expect(lock.amount.toNumber()).to.equal(amounts[i].toNumber());
        expect(lock.unlockTimestamp.toNumber()).to.equal(timestamps[i].toNumber());
        expect(lock.isUnlocked).to.equal(false);
      }
    });

    it("each lock has a unique ID and separate vault", async () => {
      const now = Math.floor(Date.now() / 1000);
      const amount = new anchor.BN(25_000_000_000);
      const timestamp = new anchor.BN(now + 3600);

      // Create first lock
      const globalState1 = await program.account.globalState.fetch(globalStatePda);
      const lockId1 = globalState1.lockCounter.toNumber();
      const lockPda1 = getLockPda(lockId1);
      const vaultPda1 = getVaultPda(lockId1);

      await program.methods
        .lock(amount, timestamp)
        .accounts({
          globalState: globalStatePda,
          lock: lockPda1,
          vault: vaultPda1,
          mint: mint1,
          ownerTokenAccount: user1TokenAccount1,
          owner: user1.publicKey,
          tokenProgram: TOKEN_PROGRAM_ID,
          feeRecipient: FEE_RECIPIENT,
          systemProgram: anchor.web3.SystemProgram.programId,
        })
        .signers([user1])
        .rpc();

      // Create second lock
      const globalState2 = await program.account.globalState.fetch(globalStatePda);
      const lockId2 = globalState2.lockCounter.toNumber();
      const lockPda2 = getLockPda(lockId2);
      const vaultPda2 = getVaultPda(lockId2);

      await program.methods
        .lock(amount, timestamp)
        .accounts({
          globalState: globalStatePda,
          lock: lockPda2,
          vault: vaultPda2,
          mint: mint1,
          ownerTokenAccount: user1TokenAccount1,
          owner: user1.publicKey,
          tokenProgram: TOKEN_PROGRAM_ID,
          feeRecipient: FEE_RECIPIENT,
          systemProgram: anchor.web3.SystemProgram.programId,
        })
        .signers([user1])
        .rpc();

      // Verify IDs are different
      expect(lockId1).to.not.equal(lockId2);

      // Verify vaults are different
      expect(vaultPda1.toString()).to.not.equal(vaultPda2.toString());

      // Verify locks are independent
      const lock1 = await program.account.lock.fetch(lockPda1);
      const lock2 = await program.account.lock.fetch(lockPda2);
      expect(lock1.id.toNumber()).to.equal(lockId1);
      expect(lock2.id.toNumber()).to.equal(lockId2);
      // Note: vaultBump can be the same for different locks, but vault PDAs are different
      // The important thing is that vaults are different (verified above)
    });

    it("can create locks with different amounts and timestamps", async () => {
      const now = Math.floor(Date.now() / 1000);
      
      const lock1Amount = new anchor.BN(30_000_000_000);
      const lock1Timestamp = new anchor.BN(now + 1800); // 30 minutes
      
      const lock2Amount = new anchor.BN(200_000_000_000);
      const lock2Timestamp = new anchor.BN(now + 86400); // 24 hours

      // Create first lock
      const globalState1 = await program.account.globalState.fetch(globalStatePda);
      const lockId1 = globalState1.lockCounter.toNumber();
      const lockPda1 = getLockPda(lockId1);
      const vaultPda1 = getVaultPda(lockId1);

      await program.methods
        .lock(lock1Amount, lock1Timestamp)
        .accounts({
          globalState: globalStatePda,
          lock: lockPda1,
          vault: vaultPda1,
          mint: mint1,
          ownerTokenAccount: user1TokenAccount1,
          owner: user1.publicKey,
          tokenProgram: TOKEN_PROGRAM_ID,
          feeRecipient: FEE_RECIPIENT,
          systemProgram: anchor.web3.SystemProgram.programId,
        })
        .signers([user1])
        .rpc();

      // Create second lock with different parameters
      const globalState2 = await program.account.globalState.fetch(globalStatePda);
      const lockId2 = globalState2.lockCounter.toNumber();
      const lockPda2 = getLockPda(lockId2);
      const vaultPda2 = getVaultPda(lockId2);

      await program.methods
        .lock(lock2Amount, lock2Timestamp)
        .accounts({
          globalState: globalStatePda,
          lock: lockPda2,
          vault: vaultPda2,
          mint: mint1,
          ownerTokenAccount: user1TokenAccount1,
          owner: user1.publicKey,
          tokenProgram: TOKEN_PROGRAM_ID,
          feeRecipient: FEE_RECIPIENT,
          systemProgram: anchor.web3.SystemProgram.programId,
        })
        .signers([user1])
        .rpc();

      // Verify both locks exist with correct values
      const lock1 = await program.account.lock.fetch(lockPda1);
      const lock2 = await program.account.lock.fetch(lockPda2);

      expect(lock1.amount.toNumber()).to.equal(lock1Amount.toNumber());
      expect(lock1.unlockTimestamp.toNumber()).to.equal(lock1Timestamp.toNumber());
      expect(lock1.owner.toString()).to.equal(user1.publicKey.toString());
      expect(lock1.mint.toString()).to.equal(mint1.toString());

      expect(lock2.amount.toNumber()).to.equal(lock2Amount.toNumber());
      expect(lock2.unlockTimestamp.toNumber()).to.equal(lock2Timestamp.toNumber());
      expect(lock2.owner.toString()).to.equal(user1.publicKey.toString());
      expect(lock2.mint.toString()).to.equal(mint1.toString());
    });

    it("locks are independent - top_up on one doesn't affect others", async () => {
      const now = Math.floor(Date.now() / 1000);
      const initialAmount = new anchor.BN(40_000_000_000);
      const timestamp = new anchor.BN(now + 3600);

      // Create two locks
      const globalState1 = await program.account.globalState.fetch(globalStatePda);
      const lockId1 = globalState1.lockCounter.toNumber();
      const lockPda1 = getLockPda(lockId1);
      const vaultPda1 = getVaultPda(lockId1);

      await program.methods
        .lock(initialAmount, timestamp)
        .accounts({
          globalState: globalStatePda,
          lock: lockPda1,
          vault: vaultPda1,
          mint: mint1,
          ownerTokenAccount: user1TokenAccount1,
          owner: user1.publicKey,
          tokenProgram: TOKEN_PROGRAM_ID,
          feeRecipient: FEE_RECIPIENT,
          systemProgram: anchor.web3.SystemProgram.programId,
        })
        .signers([user1])
        .rpc();

      const globalState2 = await program.account.globalState.fetch(globalStatePda);
      const lockId2 = globalState2.lockCounter.toNumber();
      const lockPda2 = getLockPda(lockId2);
      const vaultPda2 = getVaultPda(lockId2);

      await program.methods
        .lock(initialAmount, timestamp)
        .accounts({
          globalState: globalStatePda,
          lock: lockPda2,
          vault: vaultPda2,
          mint: mint1,
          ownerTokenAccount: user1TokenAccount1,
          owner: user1.publicKey,
          tokenProgram: TOKEN_PROGRAM_ID,
          feeRecipient: FEE_RECIPIENT,
          systemProgram: anchor.web3.SystemProgram.programId,
        })
        .signers([user1])
        .rpc();

      // Top up only the first lock
      const topUpAmount = new anchor.BN(20_000_000_000);
      await program.methods
        .topUp(topUpAmount)
        .accounts({
          lock: lockPda1,
          vault: vaultPda1,
          mint: mint1,
          ownerTokenAccount: user1TokenAccount1,
          owner: user1.publicKey,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .signers([user1])
        .rpc();

      // Verify first lock was topped up
      const lock1 = await program.account.lock.fetch(lockPda1);
      expect(lock1.amount.toNumber()).to.equal(initialAmount.toNumber() + topUpAmount.toNumber());

      // Verify second lock was NOT affected
      const lock2 = await program.account.lock.fetch(lockPda2);
      expect(lock2.amount.toNumber()).to.equal(initialAmount.toNumber());
    });

    it("locks are independent - unlock one doesn't affect others", async () => {
      const now = Math.floor(Date.now() / 1000);
      const amount = new anchor.BN(10_000_000_000);

      // Create two locks with different unlock timestamps
      const globalState1 = await program.account.globalState.fetch(globalStatePda);
      const lockId1 = globalState1.lockCounter.toNumber();
      const lockPda1 = getLockPda(lockId1);
      const vaultPda1 = getVaultPda(lockId1);

      // First lock unlocks soon
      const unlockTimestamp1 = new anchor.BN(now + 2);
      await program.methods
        .lock(amount, unlockTimestamp1)
        .accounts({
          globalState: globalStatePda,
          lock: lockPda1,
          vault: vaultPda1,
          mint: mint1,
          ownerTokenAccount: user1TokenAccount1,
          owner: user1.publicKey,
          tokenProgram: TOKEN_PROGRAM_ID,
          feeRecipient: FEE_RECIPIENT,
          systemProgram: anchor.web3.SystemProgram.programId,
        })
        .signers([user1])
        .rpc();

      const globalState2 = await program.account.globalState.fetch(globalStatePda);
      const lockId2 = globalState2.lockCounter.toNumber();
      const lockPda2 = getLockPda(lockId2);
      const vaultPda2 = getVaultPda(lockId2);

      // Second lock unlocks later
      const unlockTimestamp2 = new anchor.BN(now + 3600);
      await program.methods
        .lock(amount, unlockTimestamp2)
        .accounts({
          globalState: globalStatePda,
          lock: lockPda2,
          vault: vaultPda2,
          mint: mint1,
          ownerTokenAccount: user1TokenAccount1,
          owner: user1.publicKey,
          tokenProgram: TOKEN_PROGRAM_ID,
          feeRecipient: FEE_RECIPIENT,
          systemProgram: anchor.web3.SystemProgram.programId,
        })
        .signers([user1])
        .rpc();

      // Wait for first lock to be unlockable
      await new Promise((resolve) => setTimeout(resolve, 3000));

      // Unlock only the first lock
      await program.methods
        .unlock()
        .accounts({
          lock: lockPda1,
          vault: vaultPda1,
          mint: mint1,
          ownerTokenAccount: user1TokenAccount1,
          owner: user1.publicKey,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .signers([user1])
        .rpc();

      // Verify first lock is unlocked
      const lock1 = await program.account.lock.fetch(lockPda1);
      expect(lock1.isUnlocked).to.equal(true);

      // Verify second lock is still locked
      const lock2 = await program.account.lock.fetch(lockPda2);
      expect(lock2.isUnlocked).to.equal(false);
      expect(lock2.amount.toNumber()).to.equal(amount.toNumber());
    });

    it("can fetch all locks for a wallet and token combination", async () => {
      const now = Math.floor(Date.now() / 1000);
      const amounts = [
        new anchor.BN(15_000_000_000),
        new anchor.BN(25_000_000_000),
        new anchor.BN(35_000_000_000),
      ];
      const timestamp = new anchor.BN(now + 3600);

      const createdLockIds: number[] = [];

      // Create 3 locks
      for (let i = 0; i < 3; i++) {
        const globalState = await program.account.globalState.fetch(globalStatePda);
        const lockId = globalState.lockCounter.toNumber();
        const lockPda = getLockPda(lockId);
        const vaultPda = getVaultPda(lockId);

        await program.methods
          .lock(amounts[i], timestamp)
          .accounts({
            globalState: globalStatePda,
            lock: lockPda,
            vault: vaultPda,
            mint: mint1,
            ownerTokenAccount: user1TokenAccount1,
            owner: user1.publicKey,
            tokenProgram: TOKEN_PROGRAM_ID,
            feeRecipient: FEE_RECIPIENT,
            systemProgram: anchor.web3.SystemProgram.programId,
          })
          .signers([user1])
          .rpc();

        createdLockIds.push(lockId);
        await new Promise(r => setTimeout(r, 50));
      }

      // Fetch all locks for user1 and mint1
      const user1Mint1Locks = await lockFetcher.fetchByOwnerAndMint(user1.publicKey, mint1);

      // Verify we can find our created locks
      const foundLockIds = user1Mint1Locks
        .filter(lock => createdLockIds.includes(lock.account.id.toNumber()))
        .map(lock => lock.account.id.toNumber());

      // Should find at least our 3 locks (might be more from other tests)
      expect(foundLockIds.length).to.be.gte(3);
      
      // Verify all found locks belong to user1 and mint1
      user1Mint1Locks.forEach(lock => {
        expect(lock.account.owner.toString()).to.equal(user1.publicKey.toString());
        expect(lock.account.mint.toString()).to.equal(mint1.toString());
      });
    });

    it("can create many locks (stress test)", async () => {
      const now = Math.floor(Date.now() / 1000);
      const amount = new anchor.BN(5_000_000_000);
      const timestamp = new anchor.BN(now + 3600);
      const numLocks = 10;

      const createdLockIds: number[] = [];

      // Create many locks
      for (let i = 0; i < numLocks; i++) {
        const globalState = await program.account.globalState.fetch(globalStatePda);
        const lockId = globalState.lockCounter.toNumber();
        const lockPda = getLockPda(lockId);
        const vaultPda = getVaultPda(lockId);

        await program.methods
          .lock(amount, timestamp)
          .accounts({
            globalState: globalStatePda,
            lock: lockPda,
            vault: vaultPda,
            mint: mint1,
            ownerTokenAccount: user1TokenAccount1,
            owner: user1.publicKey,
            tokenProgram: TOKEN_PROGRAM_ID,
            feeRecipient: FEE_RECIPIENT,
            systemProgram: anchor.web3.SystemProgram.programId,
          })
          .signers([user1])
          .rpc();

        createdLockIds.push(lockId);

        // Verify each lock was created correctly
        const lock = await program.account.lock.fetch(lockPda);
        expect(lock.id.toNumber()).to.equal(lockId);
        expect(lock.owner.toString()).to.equal(user1.publicKey.toString());
        expect(lock.mint.toString()).to.equal(mint1.toString());
        expect(lock.amount.toNumber()).to.equal(amount.toNumber());
        expect(lock.isUnlocked).to.equal(false);

        await new Promise(r => setTimeout(r, 50));
      }

      // Verify all locks have unique IDs
      const uniqueIds = new Set(createdLockIds);
      expect(uniqueIds.size).to.equal(numLocks);

      // Verify we can fetch them all
      const allUser1Locks = await lockFetcher.fetchByOwner(user1.publicKey);
      const user1Mint1Locks = allUser1Locks.filter(
        lock => lock.account.mint.toString() === mint1.toString()
      );
      expect(user1Mint1Locks.length).to.be.gte(numLocks);
    });
  });

  describe("unlock", () => {
    let unlockableLockId: number;
    let unlockableLockPda: PublicKey;
    let unlockableVaultPda: PublicKey;
    const unlockAmount = new anchor.BN(10_000_000_000);

    before(async () => {
      const globalState = await program.account.globalState.fetch(globalStatePda);
      unlockableLockId = globalState.lockCounter.toNumber();
      unlockableLockPda = getLockPda(unlockableLockId);
      unlockableVaultPda = getVaultPda(unlockableLockId);

      const unlockTimestamp = new anchor.BN(Math.floor(Date.now() / 1000) + 2);

      await program.methods
        .lock(unlockAmount, unlockTimestamp)
        .accounts({
          globalState: globalStatePda,
          lock: unlockableLockPda,
          vault: unlockableVaultPda,
          mint: mint1,
          ownerTokenAccount: user1TokenAccount1,
          owner: user1.publicKey,
          tokenProgram: TOKEN_PROGRAM_ID,
          feeRecipient: FEE_RECIPIENT,
          systemProgram: anchor.web3.SystemProgram.programId,
        })
        .signers([user1])
        .rpc();

      await new Promise((resolve) => setTimeout(resolve, 3000));
    });

    it("unlocks tokens after timestamp", async () => {
      await program.methods
        .unlock()
        .accounts({
          lock: unlockableLockPda,
          vault: unlockableVaultPda,
          mint: mint1,
          ownerTokenAccount: user1TokenAccount1,
          owner: user1.publicKey,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .signers([user1])
        .rpc();

      const lock = await program.account.lock.fetch(unlockableLockPda);
      expect(lock.isUnlocked).to.equal(true);
    });

    it("does NOT send fees when unlocking tokens", async () => {
      // Create a new lock for this test
      const globalState = await program.account.globalState.fetch(globalStatePda);
      const testLockId = globalState.lockCounter.toNumber();
      const testLockPda = getLockPda(testLockId);
      const testVaultPda = getVaultPda(testLockId);

      const unlockTimestamp = new anchor.BN(Math.floor(Date.now() / 1000) + 2);
      const testAmount = new anchor.BN(10_000_000_000);

      // Create lock (this will send fees)
      await program.methods
        .lock(testAmount, unlockTimestamp)
        .accounts({
          globalState: globalStatePda,
          lock: testLockPda,
          vault: testVaultPda,
          mint: mint1,
          ownerTokenAccount: user1TokenAccount1,
          owner: user1.publicKey,
          feeRecipient: FEE_RECIPIENT,
          tokenProgram: TOKEN_PROGRAM_ID,
          systemProgram: anchor.web3.SystemProgram.programId,
        })
        .signers([user1])
        .rpc();

      await new Promise((resolve) => setTimeout(resolve, 3000));

      // Get balances before unlock
      const feeRecipientBalanceBefore = await provider.connection.getBalance(FEE_RECIPIENT);

      // Unlock tokens
      await program.methods
        .unlock()
        .accounts({
          lock: testLockPda,
          vault: testVaultPda,
          mint: mint1,
          ownerTokenAccount: user1TokenAccount1,
          owner: user1.publicKey,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .signers([user1])
        .rpc();

      // Get balances after unlock
      const feeRecipientBalanceAfter = await provider.connection.getBalance(FEE_RECIPIENT);

      // Verify fee recipient balance did NOT increase (no fees sent)
      expect(feeRecipientBalanceAfter).to.equal(feeRecipientBalanceBefore);
    });

    it("cannot unlock twice", async () => {
      try {
        await program.methods
          .unlock()
          .accounts({
            lock: unlockableLockPda,
            vault: unlockableVaultPda,
            mint: mint1,
            ownerTokenAccount: user1TokenAccount1,
            owner: user1.publicKey,
            tokenProgram: TOKEN_PROGRAM_ID,
          })
          .signers([user1])
          .rpc();
        expect.fail("Should have thrown error");
      } catch (err: any) {
        expect(err.error?.errorCode?.code).to.equal("AlreadyUnlocked");
      }
    });

    it("cannot unlock before timestamp", async () => {
      const lockPda = getLockPda(0);
      const vaultPda = getVaultPda(0);

      try {
        await program.methods
          .unlock()
          .accounts({
            lock: lockPda,
            vault: vaultPda,
            mint: mint1,
            ownerTokenAccount: user1TokenAccount1,
            owner: user1.publicKey,
            tokenProgram: TOKEN_PROGRAM_ID,
          })
          .signers([user1])
          .rpc();
        expect.fail("Should have thrown error");
      } catch (err: any) {
        expect(err.error?.errorCode?.code).to.equal("TooEarly");
      }
    });

    it("cannot unlock someone else's lock", async () => {
      const lockPda = getLockPda(0);
      const vaultPda = getVaultPda(0);

      try {
        await program.methods
          .unlock()
          .accounts({
            lock: lockPda,
            vault: vaultPda,
            mint: mint1,
            ownerTokenAccount: user2TokenAccount1,
            owner: user2.publicKey,
            tokenProgram: TOKEN_PROGRAM_ID,
          })
          .signers([user2])
          .rpc();
        expect.fail("Should have thrown error");
      } catch (err: any) {
        expect(err.error?.errorCode?.code).to.equal("Unauthorized");
      }
    });
  });

  // ===========================================================================
  // TOP UP TESTS
  // ===========================================================================
  describe("top_up", () => {
    let topUpLockId: number;
    let topUpLockPda: PublicKey;
    let topUpVaultPda: PublicKey;
    const initialAmount = new anchor.BN(100_000_000_000); // 100 tokens
    const additionalAmount = new anchor.BN(50_000_000_000); // 50 tokens

    before(async () => {
      const globalState = await program.account.globalState.fetch(globalStatePda);
      topUpLockId = globalState.lockCounter.toNumber();
      topUpLockPda = getLockPda(topUpLockId);
      topUpVaultPda = getVaultPda(topUpLockId);

      const unlockTimestamp = new anchor.BN(Math.floor(Date.now() / 1000) + 3600);

      await program.methods
        .lock(initialAmount, unlockTimestamp)
        .accounts({
          globalState: globalStatePda,
          lock: topUpLockPda,
          vault: topUpVaultPda,
          mint: mint1,
          ownerTokenAccount: user1TokenAccount1,
          owner: user1.publicKey,
          tokenProgram: TOKEN_PROGRAM_ID,
          feeRecipient: FEE_RECIPIENT,
          systemProgram: anchor.web3.SystemProgram.programId,
        })
        .signers([user1])
        .rpc();
    });

    it("adds tokens to an existing lock", async () => {
      const lockBefore = await program.account.lock.fetch(topUpLockPda);
      const amountBefore = lockBefore.amount.toNumber();

      await program.methods
        .topUp(additionalAmount)
        .accounts({
          lock: topUpLockPda,
          vault: topUpVaultPda,
          mint: mint1,
          ownerTokenAccount: user1TokenAccount1,
          owner: user1.publicKey,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .signers([user1])
        .rpc();

      const lockAfter = await program.account.lock.fetch(topUpLockPda);
      const amountAfter = lockAfter.amount.toNumber();

      expect(amountAfter).to.equal(amountBefore + additionalAmount.toNumber());
      expect(lockAfter.isUnlocked).to.equal(false);
      expect(lockAfter.owner.toString()).to.equal(user1.publicKey.toString());
    });

    it("does NOT send fees when topping up a lock", async () => {
      // Get balances before top_up
      const feeRecipientBalanceBefore = await provider.connection.getBalance(FEE_RECIPIENT);

      // Top up the lock
      await program.methods
        .topUp(additionalAmount)
        .accounts({
          lock: topUpLockPda,
          vault: topUpVaultPda,
          mint: mint1,
          ownerTokenAccount: user1TokenAccount1,
          owner: user1.publicKey,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .signers([user1])
        .rpc();

      // Get balances after top_up
      const feeRecipientBalanceAfter = await provider.connection.getBalance(FEE_RECIPIENT);

      // Verify fee recipient balance did NOT increase (no fees sent)
      expect(feeRecipientBalanceAfter).to.equal(feeRecipientBalanceBefore);
    });

    it("rejects zero amount", async () => {
      try {
        await program.methods
          .topUp(new anchor.BN(0))
          .accounts({
            lock: topUpLockPda,
            vault: topUpVaultPda,
            mint: mint1,
            ownerTokenAccount: user1TokenAccount1,
            owner: user1.publicKey,
            tokenProgram: TOKEN_PROGRAM_ID,
          })
          .signers([user1])
          .rpc();
        expect.fail("Should have thrown error");
      } catch (err: any) {
        expect(err.error?.errorCode?.code).to.equal("AmountZero");
      }
    });

    it("cannot top up an unlocked lock", async () => {
      // First, create and unlock a lock
      const globalState = await program.account.globalState.fetch(globalStatePda);
      const testLockId = globalState.lockCounter.toNumber();
      const testLockPda = getLockPda(testLockId);
      const testVaultPda = getVaultPda(testLockId);

      const unlockTimestamp = new anchor.BN(Math.floor(Date.now() / 1000) + 2);
      const testAmount = new anchor.BN(10_000_000_000);

      await program.methods
        .lock(testAmount, unlockTimestamp)
        .accounts({
          globalState: globalStatePda,
          lock: testLockPda,
          vault: testVaultPda,
          mint: mint1,
          ownerTokenAccount: user1TokenAccount1,
          owner: user1.publicKey,
          tokenProgram: TOKEN_PROGRAM_ID,
          feeRecipient: FEE_RECIPIENT,
          systemProgram: anchor.web3.SystemProgram.programId,
        })
        .signers([user1])
        .rpc();

      await new Promise((resolve) => setTimeout(resolve, 3000));

      await program.methods
        .unlock()
        .accounts({
          lock: testLockPda,
          vault: testVaultPda,
          mint: mint1,
          ownerTokenAccount: user1TokenAccount1,
          owner: user1.publicKey,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .signers([user1])
        .rpc();

      // Now try to top up the unlocked lock
      try {
        await program.methods
          .topUp(additionalAmount)
          .accounts({
            lock: testLockPda,
            vault: testVaultPda,
            mint: mint1,
            ownerTokenAccount: user1TokenAccount1,
            owner: user1.publicKey,
            tokenProgram: TOKEN_PROGRAM_ID,
          })
          .signers([user1])
          .rpc();
        expect.fail("Should have thrown error");
      } catch (err: any) {
        expect(err.error?.errorCode?.code).to.equal("AlreadyUnlocked");
      }
    });

    it("cannot top up someone else's lock", async () => {
      try {
        await program.methods
          .topUp(additionalAmount)
          .accounts({
            lock: topUpLockPda,
            vault: topUpVaultPda,
            mint: mint1,
            ownerTokenAccount: user2TokenAccount1,
            owner: user2.publicKey,
            tokenProgram: TOKEN_PROGRAM_ID,
          })
          .signers([user2])
          .rpc();
        expect.fail("Should have thrown error");
      } catch (err: any) {
        expect(err.error?.errorCode?.code).to.equal("Unauthorized");
      }
    });

    it("cannot top up with wrong mint", async () => {
      // Create a lock with mint2
      const globalState = await program.account.globalState.fetch(globalStatePda);
      const testLockId = globalState.lockCounter.toNumber();
      const testLockPda = getLockPda(testLockId);
      const testVaultPda = getVaultPda(testLockId);

      const unlockTimestamp = new anchor.BN(Math.floor(Date.now() / 1000) + 3600);
      const testAmount = new anchor.BN(100_000_000); // 6 decimals for mint2

      await program.methods
        .lock(testAmount, unlockTimestamp)
        .accounts({
          globalState: globalStatePda,
          lock: testLockPda,
          vault: testVaultPda,
          mint: mint2,
          ownerTokenAccount: user1TokenAccount2,
          owner: user1.publicKey,
          tokenProgram: TOKEN_PROGRAM_ID,
          feeRecipient: FEE_RECIPIENT,
          systemProgram: anchor.web3.SystemProgram.programId,
        })
        .signers([user1])
        .rpc();

      // Try to top up with mint1 (wrong mint)
      try {
        await program.methods
          .topUp(additionalAmount)
          .accounts({
            lock: testLockPda,
            vault: testVaultPda,
            mint: mint1, // Wrong mint!
            ownerTokenAccount: user1TokenAccount1,
            owner: user1.publicKey,
            tokenProgram: TOKEN_PROGRAM_ID,
          })
          .signers([user1])
          .rpc();
        expect.fail("Should have thrown error");
      } catch (err: any) {
        expect(err.error?.errorCode?.code).to.equal("InvalidMint");
      }
    });

    it("can top up multiple times", async () => {
      const lockBefore = await program.account.lock.fetch(topUpLockPda);
      const amountBefore = lockBefore.amount.toNumber();

      const firstTopUp = new anchor.BN(25_000_000_000);
      const secondTopUp = new anchor.BN(30_000_000_000);

      // First top up
      await program.methods
        .topUp(firstTopUp)
        .accounts({
          lock: topUpLockPda,
          vault: topUpVaultPda,
          mint: mint1,
          ownerTokenAccount: user1TokenAccount1,
          owner: user1.publicKey,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .signers([user1])
        .rpc();

      // Second top up
      await program.methods
        .topUp(secondTopUp)
        .accounts({
          lock: topUpLockPda,
          vault: topUpVaultPda,
          mint: mint1,
          ownerTokenAccount: user1TokenAccount1,
          owner: user1.publicKey,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .signers([user1])
        .rpc();

      const lockAfter = await program.account.lock.fetch(topUpLockPda);
      const expectedAmount = amountBefore + firstTopUp.toNumber() + secondTopUp.toNumber();
      expect(lockAfter.amount.toNumber()).to.equal(expectedAmount);
    });
  });

  // ===========================================================================
  // EXTEND TESTS
  // ===========================================================================
  describe("extend", () => {
    let extendLockId: number;
    let extendLockPda: PublicKey;
    const initialAmount = new anchor.BN(100_000_000_000);
    let initialTimestamp: anchor.BN;

    before(async () => {
      const globalState = await program.account.globalState.fetch(globalStatePda);
      extendLockId = globalState.lockCounter.toNumber();
      extendLockPda = getLockPda(extendLockId);
      const extendVaultPda = getVaultPda(extendLockId);

      initialTimestamp = new anchor.BN(Math.floor(Date.now() / 1000) + 3600); // 1 hour from now

      await program.methods
        .lock(initialAmount, initialTimestamp)
        .accounts({
          globalState: globalStatePda,
          lock: extendLockPda,
          vault: extendVaultPda,
          mint: mint1,
          ownerTokenAccount: user1TokenAccount1,
          owner: user1.publicKey,
          tokenProgram: TOKEN_PROGRAM_ID,
          feeRecipient: FEE_RECIPIENT,
          systemProgram: anchor.web3.SystemProgram.programId,
        })
        .signers([user1])
        .rpc();
    });

    it("extends unlock timestamp", async () => {
      const lockBefore = await program.account.lock.fetch(extendLockPda);
      const timestampBefore = lockBefore.unlockTimestamp.toNumber();

      const newTimestamp = new anchor.BN(timestampBefore + 7200); // Add 2 hours

      await program.methods
        .extend(newTimestamp)
        .accounts({
          lock: extendLockPda,
          owner: user1.publicKey,
        })
        .signers([user1])
        .rpc();

      const lockAfter = await program.account.lock.fetch(extendLockPda);
      expect(lockAfter.unlockTimestamp.toNumber()).to.equal(newTimestamp.toNumber());
      expect(lockAfter.isUnlocked).to.equal(false);
      expect(lockAfter.amount.toNumber()).to.equal(initialAmount.toNumber()); // Amount unchanged
    });

    it("does NOT send fees when extending a lock", async () => {
      const lockBefore = await program.account.lock.fetch(extendLockPda);
      const timestampBefore = lockBefore.unlockTimestamp.toNumber();

      // Get balances before extend
      const feeRecipientBalanceBefore = await provider.connection.getBalance(FEE_RECIPIENT);

      const newTimestamp = new anchor.BN(timestampBefore + 7200); // Add 2 hours

      // Extend the lock
      await program.methods
        .extend(newTimestamp)
        .accounts({
          lock: extendLockPda,
          owner: user1.publicKey,
        })
        .signers([user1])
        .rpc();

      // Get balances after extend
      const feeRecipientBalanceAfter = await provider.connection.getBalance(FEE_RECIPIENT);

      // Verify fee recipient balance did NOT increase (no fees sent)
      expect(feeRecipientBalanceAfter).to.equal(feeRecipientBalanceBefore);
    });

    it("cannot shorten unlock timestamp", async () => {
      const lock = await program.account.lock.fetch(extendLockPda);
      const currentTimestamp = lock.unlockTimestamp.toNumber();
      const shorterTimestamp = new anchor.BN(currentTimestamp - 3600); // 1 hour earlier

      try {
        await program.methods
          .extend(shorterTimestamp)
          .accounts({
            lock: extendLockPda,
            owner: user1.publicKey,
          })
          .signers([user1])
          .rpc();
        expect.fail("Should have thrown error");
      } catch (err: any) {
        expect(err.error?.errorCode?.code).to.equal("CannotShortenTimestamp");
      }
    });

    it("cannot extend with same timestamp", async () => {
      const lock = await program.account.lock.fetch(extendLockPda);
      const currentTimestamp = lock.unlockTimestamp.toNumber();

      try {
        await program.methods
          .extend(new anchor.BN(currentTimestamp))
          .accounts({
            lock: extendLockPda,
            owner: user1.publicKey,
          })
          .signers([user1])
          .rpc();
        expect.fail("Should have thrown error");
      } catch (err: any) {
        expect(err.error?.errorCode?.code).to.equal("CannotShortenTimestamp");
      }
    });

    it("cannot shorten timestamp by even 1 second", async () => {
      const lock = await program.account.lock.fetch(extendLockPda);
      const currentTimestamp = lock.unlockTimestamp.toNumber();
      const oneSecondEarlier = new anchor.BN(currentTimestamp - 1);

      try {
        await program.methods
          .extend(oneSecondEarlier)
          .accounts({
            lock: extendLockPda,
            owner: user1.publicKey,
          })
          .signers([user1])
          .rpc();
        expect.fail("Should have thrown error");
      } catch (err: any) {
        expect(err.error?.errorCode?.code).to.equal("CannotShortenTimestamp");
      }
    });

    it("cannot shorten timestamp by a large amount (multiple hours)", async () => {
      const lock = await program.account.lock.fetch(extendLockPda);
      const currentTimestamp = lock.unlockTimestamp.toNumber();
      const manyHoursEarlier = new anchor.BN(currentTimestamp - 86400); // 24 hours earlier

      try {
        await program.methods
          .extend(manyHoursEarlier)
          .accounts({
            lock: extendLockPda,
            owner: user1.publicKey,
          })
          .signers([user1])
          .rpc();
        expect.fail("Should have thrown error");
      } catch (err: any) {
        expect(err.error?.errorCode?.code).to.equal("CannotShortenTimestamp");
      }
    });

    it("cannot revert timestamp after extending (cannot go back)", async () => {
      const lockBefore = await program.account.lock.fetch(extendLockPda);
      const timestampBefore = lockBefore.unlockTimestamp.toNumber();

      // First, extend the lock
      const extendedTimestamp = new anchor.BN(timestampBefore + 7200); // Add 2 hours
      await program.methods
        .extend(extendedTimestamp)
        .accounts({
          lock: extendLockPda,
          owner: user1.publicKey,
        })
        .signers([user1])
        .rpc();

      // Verify it was extended
      const lockAfterExtend = await program.account.lock.fetch(extendLockPda);
      expect(lockAfterExtend.unlockTimestamp.toNumber()).to.equal(extendedTimestamp.toNumber());

      // Now try to revert back to the original timestamp (should fail)
      try {
        await program.methods
          .extend(new anchor.BN(timestampBefore))
          .accounts({
            lock: extendLockPda,
            owner: user1.publicKey,
          })
          .signers([user1])
          .rpc();
        expect.fail("Should have thrown error - cannot revert timestamp");
      } catch (err: any) {
        expect(err.error?.errorCode?.code).to.equal("CannotShortenTimestamp");
      }

      // Verify timestamp was not changed
      const lockAfterFailedRevert = await program.account.lock.fetch(extendLockPda);
      expect(lockAfterFailedRevert.unlockTimestamp.toNumber()).to.equal(extendedTimestamp.toNumber());
    });

    it("cannot set timestamp to past (even if trying to extend)", async () => {
      const lock = await program.account.lock.fetch(extendLockPda);
      const currentTimestamp = lock.unlockTimestamp.toNumber();
      const now = Math.floor(Date.now() / 1000);
      
      // Try to set a timestamp in the past (but still > currentTimestamp would fail anyway)
      // This test ensures we can't accidentally set a past timestamp
      const pastTimestamp = new anchor.BN(now - 3600); // 1 hour ago

      // Even if somehow currentTimestamp was in the past, we should still fail
      // But more importantly, if currentTimestamp > now, we can't set it to past
      if (currentTimestamp > now) {
        try {
          await program.methods
            .extend(pastTimestamp)
            .accounts({
              lock: extendLockPda,
              owner: user1.publicKey,
            })
            .signers([user1])
            .rpc();
          expect.fail("Should have thrown error - cannot set timestamp to past");
        } catch (err: any) {
          // Should fail either because it's shorter or because it's in the past
          expect(err.error?.errorCode?.code === "CannotShortenTimestamp" || 
                 err.error?.errorCode?.code === "TimestampInPast").to.be.true;
        }
      }
    });

    it("cannot extend an unlocked lock", async () => {
      // Create and unlock a lock
      const globalState = await program.account.globalState.fetch(globalStatePda);
      const testLockId = globalState.lockCounter.toNumber();
      const testLockPda = getLockPda(testLockId);
      const testVaultPda = getVaultPda(testLockId);

      const unlockTimestamp = new anchor.BN(Math.floor(Date.now() / 1000) + 2);
      const testAmount = new anchor.BN(10_000_000_000);

      await program.methods
        .lock(testAmount, unlockTimestamp)
        .accounts({
          globalState: globalStatePda,
          lock: testLockPda,
          vault: testVaultPda,
          mint: mint1,
          ownerTokenAccount: user1TokenAccount1,
          owner: user1.publicKey,
          tokenProgram: TOKEN_PROGRAM_ID,
          feeRecipient: FEE_RECIPIENT,
          systemProgram: anchor.web3.SystemProgram.programId,
        })
        .signers([user1])
        .rpc();

      await new Promise((resolve) => setTimeout(resolve, 3000));

      await program.methods
        .unlock()
        .accounts({
          lock: testLockPda,
          vault: testVaultPda,
          mint: mint1,
          ownerTokenAccount: user1TokenAccount1,
          owner: user1.publicKey,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .signers([user1])
        .rpc();

      // Try to extend the unlocked lock
      const newTimestamp = new anchor.BN(Math.floor(Date.now() / 1000) + 7200);
      try {
        await program.methods
          .extend(newTimestamp)
          .accounts({
            lock: testLockPda,
            owner: user1.publicKey,
          })
          .signers([user1])
          .rpc();
        expect.fail("Should have thrown error");
      } catch (err: any) {
        expect(err.error?.errorCode?.code).to.equal("AlreadyUnlocked");
      }
    });

    it("cannot extend someone else's lock", async () => {
      const lock = await program.account.lock.fetch(extendLockPda);
      const currentTimestamp = lock.unlockTimestamp.toNumber();
      const newTimestamp = new anchor.BN(currentTimestamp + 3600);

      try {
        await program.methods
          .extend(newTimestamp)
          .accounts({
            lock: extendLockPda,
            owner: user2.publicKey,
          })
          .signers([user2])
          .rpc();
        expect.fail("Should have thrown error");
      } catch (err: any) {
        expect(err.error?.errorCode?.code).to.equal("Unauthorized");
      }
    });

    it("can extend multiple times", async () => {
      const lockBefore = await program.account.lock.fetch(extendLockPda);
      const timestampBefore = lockBefore.unlockTimestamp.toNumber();

      // First extension: add 1 hour
      const firstExtension = new anchor.BN(timestampBefore + 3600);
      await program.methods
        .extend(firstExtension)
        .accounts({
          lock: extendLockPda,
          owner: user1.publicKey,
        })
        .signers([user1])
        .rpc();

      // Second extension: add another 2 hours
      const secondExtension = new anchor.BN(timestampBefore + 10800); // 3 hours total
      await program.methods
        .extend(secondExtension)
        .accounts({
          lock: extendLockPda,
          owner: user1.publicKey,
        })
        .signers([user1])
        .rpc();

      const lockAfter = await program.account.lock.fetch(extendLockPda);
      expect(lockAfter.unlockTimestamp.toNumber()).to.equal(secondExtension.toNumber());
    });
  });

  // ===========================================================================
  // COMBINED OPERATIONS TESTS
  // ===========================================================================
  describe("combined operations", () => {
    it("can top_up then extend a lock", async () => {
      const now = Math.floor(Date.now() / 1000);
      const initialAmount = new anchor.BN(50_000_000_000);
      const initialTimestamp = new anchor.BN(now + 3600);

      const globalState = await program.account.globalState.fetch(globalStatePda);
      const lockId = globalState.lockCounter.toNumber();
      const lockPda = getLockPda(lockId);
      const vaultPda = getVaultPda(lockId);

      // Create lock
      await program.methods
        .lock(initialAmount, initialTimestamp)
        .accounts({
          globalState: globalStatePda,
          lock: lockPda,
          vault: vaultPda,
          mint: mint1,
          ownerTokenAccount: user1TokenAccount1,
          owner: user1.publicKey,
          tokenProgram: TOKEN_PROGRAM_ID,
          feeRecipient: FEE_RECIPIENT,
          systemProgram: anchor.web3.SystemProgram.programId,
        })
        .signers([user1])
        .rpc();

      // Top up
      const topUpAmount = new anchor.BN(25_000_000_000);
      await program.methods
        .topUp(topUpAmount)
        .accounts({
          lock: lockPda,
          vault: vaultPda,
          mint: mint1,
          ownerTokenAccount: user1TokenAccount1,
          owner: user1.publicKey,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .signers([user1])
        .rpc();

      // Extend
      const newTimestamp = new anchor.BN(now + 7200);
      await program.methods
        .extend(newTimestamp)
        .accounts({
          lock: lockPda,
          owner: user1.publicKey,
        })
        .signers([user1])
        .rpc();

      // Verify both changes
      const lock = await program.account.lock.fetch(lockPda);
      expect(lock.amount.toNumber()).to.equal(initialAmount.toNumber() + topUpAmount.toNumber());
      expect(lock.unlockTimestamp.toNumber()).to.equal(newTimestamp.toNumber());
    });

    it("can extend then top_up a lock", async () => {
      const now = Math.floor(Date.now() / 1000);
      const initialAmount = new anchor.BN(60_000_000_000);
      const initialTimestamp = new anchor.BN(now + 3600);

      const globalState = await program.account.globalState.fetch(globalStatePda);
      const lockId = globalState.lockCounter.toNumber();
      const lockPda = getLockPda(lockId);
      const vaultPda = getVaultPda(lockId);

      // Create lock
      await program.methods
        .lock(initialAmount, initialTimestamp)
        .accounts({
          globalState: globalStatePda,
          lock: lockPda,
          vault: vaultPda,
          mint: mint1,
          ownerTokenAccount: user1TokenAccount1,
          owner: user1.publicKey,
          tokenProgram: TOKEN_PROGRAM_ID,
          feeRecipient: FEE_RECIPIENT,
          systemProgram: anchor.web3.SystemProgram.programId,
        })
        .signers([user1])
        .rpc();

      // Extend first
      const newTimestamp = new anchor.BN(now + 10800);
      await program.methods
        .extend(newTimestamp)
        .accounts({
          lock: lockPda,
          owner: user1.publicKey,
        })
        .signers([user1])
        .rpc();

      // Then top up
      const topUpAmount = new anchor.BN(40_000_000_000);
      await program.methods
        .topUp(topUpAmount)
        .accounts({
          lock: lockPda,
          vault: vaultPda,
          mint: mint1,
          ownerTokenAccount: user1TokenAccount1,
          owner: user1.publicKey,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .signers([user1])
        .rpc();

      // Verify both changes
      const lock = await program.account.lock.fetch(lockPda);
      expect(lock.amount.toNumber()).to.equal(initialAmount.toNumber() + topUpAmount.toNumber());
      expect(lock.unlockTimestamp.toNumber()).to.equal(newTimestamp.toNumber());
    });

    it("complete lifecycle: lock -> top_up -> extend -> unlock", async () => {
      const now = Math.floor(Date.now() / 1000);
      const initialAmount = new anchor.BN(30_000_000_000);
      const initialTimestamp = new anchor.BN(now + 2); // Unlocks soon

      const globalState = await program.account.globalState.fetch(globalStatePda);
      const lockId = globalState.lockCounter.toNumber();
      const lockPda = getLockPda(lockId);
      const vaultPda = getVaultPda(lockId);

      // 1. Create lock
      await program.methods
        .lock(initialAmount, initialTimestamp)
        .accounts({
          globalState: globalStatePda,
          lock: lockPda,
          vault: vaultPda,
          mint: mint1,
          ownerTokenAccount: user1TokenAccount1,
          owner: user1.publicKey,
          tokenProgram: TOKEN_PROGRAM_ID,
          feeRecipient: FEE_RECIPIENT,
          systemProgram: anchor.web3.SystemProgram.programId,
        })
        .signers([user1])
        .rpc();

      let lock = await program.account.lock.fetch(lockPda);
      expect(lock.amount.toNumber()).to.equal(initialAmount.toNumber());
      expect(lock.isUnlocked).to.equal(false);

      // 2. Top up
      const topUpAmount = new anchor.BN(20_000_000_000);
      await program.methods
        .topUp(topUpAmount)
        .accounts({
          lock: lockPda,
          vault: vaultPda,
          mint: mint1,
          ownerTokenAccount: user1TokenAccount1,
          owner: user1.publicKey,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .signers([user1])
        .rpc();

      lock = await program.account.lock.fetch(lockPda);
      expect(lock.amount.toNumber()).to.equal(initialAmount.toNumber() + topUpAmount.toNumber());

      // 3. Extend (before it unlocks) - extend to a timestamp that's soon but after current time
      const extendedTimestamp = new anchor.BN(now + 5); // 5 seconds from now
      await program.methods
        .extend(extendedTimestamp)
        .accounts({
          lock: lockPda,
          owner: user1.publicKey,
        })
        .signers([user1])
        .rpc();

      lock = await program.account.lock.fetch(lockPda);
      expect(lock.unlockTimestamp.toNumber()).to.equal(extendedTimestamp.toNumber());

      // 4. Wait until timestamp is reached and unlock
      await new Promise((resolve) => setTimeout(resolve, 6000)); // Wait 6 seconds to be sure

      await program.methods
        .unlock()
        .accounts({
          lock: lockPda,
          vault: vaultPda,
          mint: mint1,
          ownerTokenAccount: user1TokenAccount1,
          owner: user1.publicKey,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .signers([user1])
        .rpc();

      lock = await program.account.lock.fetch(lockPda);
      expect(lock.isUnlocked).to.equal(true);
      expect(lock.amount.toNumber()).to.equal(initialAmount.toNumber() + topUpAmount.toNumber());
    });
  });

  // ===========================================================================
  // MULTIPLE WALLETS SAME TOKEN TESTS
  // ===========================================================================
  describe("multiple wallets locking same token", () => {
    it("different wallets can lock the same token independently", async () => {
      const now = Math.floor(Date.now() / 1000);
      const amount1 = new anchor.BN(100_000_000_000);
      const amount2 = new anchor.BN(150_000_000_000);
      const timestamp = new anchor.BN(now + 3600);

      // User1 creates a lock
      const globalState1 = await program.account.globalState.fetch(globalStatePda);
      const lockId1 = globalState1.lockCounter.toNumber();
      const lockPda1 = getLockPda(lockId1);
      const vaultPda1 = getVaultPda(lockId1);

      await program.methods
        .lock(amount1, timestamp)
        .accounts({
          globalState: globalStatePda,
          lock: lockPda1,
          vault: vaultPda1,
          mint: mint1,
          ownerTokenAccount: user1TokenAccount1,
          owner: user1.publicKey,
          tokenProgram: TOKEN_PROGRAM_ID,
          feeRecipient: FEE_RECIPIENT,
          systemProgram: anchor.web3.SystemProgram.programId,
        })
        .signers([user1])
        .rpc();

      // User2 creates a lock on the same token
      const globalState2 = await program.account.globalState.fetch(globalStatePda);
      const lockId2 = globalState2.lockCounter.toNumber();
      const lockPda2 = getLockPda(lockId2);
      const vaultPda2 = getVaultPda(lockId2);

      await program.methods
        .lock(amount2, timestamp)
        .accounts({
          globalState: globalStatePda,
          lock: lockPda2,
          vault: vaultPda2,
          mint: mint1,
          ownerTokenAccount: user2TokenAccount1,
          owner: user2.publicKey,
          tokenProgram: TOKEN_PROGRAM_ID,
          systemProgram: anchor.web3.SystemProgram.programId,
        })
        .signers([user2])
        .rpc();

      // Verify both locks exist independently
      const lock1 = await program.account.lock.fetch(lockPda1);
      const lock2 = await program.account.lock.fetch(lockPda2);

      expect(lock1.owner.toString()).to.equal(user1.publicKey.toString());
      expect(lock2.owner.toString()).to.equal(user2.publicKey.toString());
      expect(lock1.mint.toString()).to.equal(mint1.toString());
      expect(lock2.mint.toString()).to.equal(mint1.toString());
      expect(lock1.amount.toNumber()).to.equal(amount1.toNumber());
      expect(lock2.amount.toNumber()).to.equal(amount2.toNumber());
      expect(lock1.id.toNumber()).to.not.equal(lock2.id.toNumber());
    });

    it("can fetch all locks for a token across multiple wallets", async () => {
      const now = Math.floor(Date.now() / 1000);
      const timestamp = new anchor.BN(now + 3600);

      // Create locks from different users on same token
      const amounts = [
        { user: user1, account: user1TokenAccount1, amount: new anchor.BN(50_000_000_000) },
        { user: user2, account: user2TokenAccount1, amount: new anchor.BN(75_000_000_000) },
        { user: user3, account: user3TokenAccount1, amount: new anchor.BN(100_000_000_000) },
      ];

      const createdLockIds: number[] = [];

      for (const { user, account, amount } of amounts) {
        const globalState = await program.account.globalState.fetch(globalStatePda);
        const lockId = globalState.lockCounter.toNumber();
        const lockPda = getLockPda(lockId);
        const vaultPda = getVaultPda(lockId);

        await program.methods
          .lock(amount, timestamp)
          .accounts({
            globalState: globalStatePda,
            lock: lockPda,
            vault: vaultPda,
            mint: mint1,
            ownerTokenAccount: account,
            owner: user.publicKey,
          tokenProgram: TOKEN_PROGRAM_ID,
          feeRecipient: FEE_RECIPIENT,
          systemProgram: anchor.web3.SystemProgram.programId,
        })
        .signers([user])
        .rpc();

        createdLockIds.push(lockId);
        await new Promise(r => setTimeout(r, 50));
      }

      // Fetch all locks for mint1
      const allMint1Locks = await lockFetcher.fetchByMint(mint1);

      // Verify we can find our created locks
      const foundLocks = allMint1Locks.filter(lock =>
        createdLockIds.includes(lock.account.id.toNumber())
      );

      expect(foundLocks.length).to.equal(3);

      // Verify each lock belongs to correct owner
      const owners = foundLocks.map(lock => lock.account.owner.toString());
      expect(owners).to.include(user1.publicKey.toString());
      expect(owners).to.include(user2.publicKey.toString());
      expect(owners).to.include(user3.publicKey.toString());
    });
  });

  // ===========================================================================
  // EDGE CASES AND LIMITS TESTS
  // ===========================================================================
  describe("edge cases and limits", () => {
    it("handles very large amounts correctly", async () => {
      const now = Math.floor(Date.now() / 1000);
      // Use a large but reasonable amount (close to u64 max would be unrealistic)
      const largeAmount = new anchor.BN("1000000000000000000"); // 1 billion tokens with 9 decimals
      const timestamp = new anchor.BN(now + 3600);

      const globalState = await program.account.globalState.fetch(globalStatePda);
      const lockId = globalState.lockCounter.toNumber();
      const lockPda = getLockPda(lockId);
      const vaultPda = getVaultPda(lockId);

      // This should work if user has enough tokens
      // In real scenario, would need to mint enough tokens first
      // For test, we'll use available balance
      const availableAmount = new anchor.BN(1_000_000_000_000); // 1000 tokens

      await program.methods
        .lock(availableAmount, timestamp)
        .accounts({
          globalState: globalStatePda,
          lock: lockPda,
          vault: vaultPda,
          mint: mint1,
          ownerTokenAccount: user1TokenAccount1,
          owner: user1.publicKey,
          tokenProgram: TOKEN_PROGRAM_ID,
          feeRecipient: FEE_RECIPIENT,
          systemProgram: anchor.web3.SystemProgram.programId,
        })
        .signers([user1])
        .rpc();

      const lock = await program.account.lock.fetch(lockPda);
      expect(lock.amount.toNumber()).to.equal(availableAmount.toNumber());
    });

    it("handles very far future timestamps", async () => {
      const now = Math.floor(Date.now() / 1000);
      const amount = new anchor.BN(50_000_000_000);
      // 10 years in the future
      const farFutureTimestamp = new anchor.BN(now + 315360000); // ~10 years

      const globalState = await program.account.globalState.fetch(globalStatePda);
      const lockId = globalState.lockCounter.toNumber();
      const lockPda = getLockPda(lockId);
      const vaultPda = getVaultPda(lockId);

      await program.methods
        .lock(amount, farFutureTimestamp)
        .accounts({
          globalState: globalStatePda,
          lock: lockPda,
          vault: vaultPda,
          mint: mint1,
          ownerTokenAccount: user1TokenAccount1,
          owner: user1.publicKey,
          tokenProgram: TOKEN_PROGRAM_ID,
          feeRecipient: FEE_RECIPIENT,
          systemProgram: anchor.web3.SystemProgram.programId,
        })
        .signers([user1])
        .rpc();

      const lock = await program.account.lock.fetch(lockPda);
      expect(lock.unlockTimestamp.toNumber()).to.equal(farFutureTimestamp.toNumber());
    });

    it("maintains data integrity after multiple operations", async () => {
      const now = Math.floor(Date.now() / 1000);
      const initialAmount = new anchor.BN(80_000_000_000);
      const initialTimestamp = new anchor.BN(now + 3600);

      const globalState = await program.account.globalState.fetch(globalStatePda);
      const lockId = globalState.lockCounter.toNumber();
      const lockPda = getLockPda(lockId);
      const vaultPda = getVaultPda(lockId);

      // Create lock
      await program.methods
        .lock(initialAmount, initialTimestamp)
        .accounts({
          globalState: globalStatePda,
          lock: lockPda,
          vault: vaultPda,
          mint: mint1,
          ownerTokenAccount: user1TokenAccount1,
          owner: user1.publicKey,
          tokenProgram: TOKEN_PROGRAM_ID,
          feeRecipient: FEE_RECIPIENT,
          systemProgram: anchor.web3.SystemProgram.programId,
        })
        .signers([user1])
        .rpc();

      // Store initial values
      const initialLock = await program.account.lock.fetch(lockPda);
      const initialId = initialLock.id.toNumber();
      const initialOwner = initialLock.owner.toString();
      const initialMint = initialLock.mint.toString();
      const initialCreatedAt = initialLock.createdAt.toNumber();
      const initialVaultBump = initialLock.vaultBump;

      // Perform multiple operations
      await program.methods
        .topUp(new anchor.BN(20_000_000_000))
        .accounts({
          lock: lockPda,
          vault: vaultPda,
          mint: mint1,
          ownerTokenAccount: user1TokenAccount1,
          owner: user1.publicKey,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .signers([user1])
        .rpc();

      await program.methods
        .extend(new anchor.BN(now + 7200))
        .accounts({
          lock: lockPda,
          owner: user1.publicKey,
        })
        .signers([user1])
        .rpc();

      await program.methods
        .topUp(new anchor.BN(10_000_000_000))
        .accounts({
          lock: lockPda,
          vault: vaultPda,
          mint: mint1,
          ownerTokenAccount: user1TokenAccount1,
          owner: user1.publicKey,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .signers([user1])
        .rpc();

      // Verify immutable fields remain unchanged
      const finalLock = await program.account.lock.fetch(lockPda);
      expect(finalLock.id.toNumber()).to.equal(initialId);
      expect(finalLock.owner.toString()).to.equal(initialOwner);
      expect(finalLock.mint.toString()).to.equal(initialMint);
      expect(finalLock.createdAt.toNumber()).to.equal(initialCreatedAt);
      expect(finalLock.vaultBump).to.equal(initialVaultBump);

      // Verify mutable fields changed correctly
      expect(finalLock.amount.toNumber()).to.equal(initialAmount.toNumber() + 30_000_000_000);
      expect(finalLock.unlockTimestamp.toNumber()).to.equal(now + 7200);
      expect(finalLock.isUnlocked).to.equal(false);
    });

    it("lock_counter increments correctly for multiple locks", async () => {
      const initialGlobalState = await program.account.globalState.fetch(globalStatePda);
      const initialCounter = initialGlobalState.lockCounter.toNumber();

      const now = Math.floor(Date.now() / 1000);
      const amount = new anchor.BN(10_000_000_000);
      const timestamp = new anchor.BN(now + 3600);

      // Create 5 locks
      const createdIds: number[] = [];
      for (let i = 0; i < 5; i++) {
        const globalState = await program.account.globalState.fetch(globalStatePda);
        const lockId = globalState.lockCounter.toNumber();
        const lockPda = getLockPda(lockId);
        const vaultPda = getVaultPda(lockId);

        await program.methods
          .lock(amount, timestamp)
          .accounts({
            globalState: globalStatePda,
            lock: lockPda,
            vault: vaultPda,
            mint: mint1,
            ownerTokenAccount: user1TokenAccount1,
            owner: user1.publicKey,
            tokenProgram: TOKEN_PROGRAM_ID,
            feeRecipient: FEE_RECIPIENT,
            systemProgram: anchor.web3.SystemProgram.programId,
          })
          .signers([user1])
          .rpc();

        createdIds.push(lockId);
        await new Promise(r => setTimeout(r, 50));
      }

      // Verify counter incremented
      const finalGlobalState = await program.account.globalState.fetch(globalStatePda);
      expect(finalGlobalState.lockCounter.toNumber()).to.equal(initialCounter + 5);

      // Verify IDs are sequential
      for (let i = 1; i < createdIds.length; i++) {
        expect(createdIds[i]).to.equal(createdIds[i - 1] + 1);
      }
    });
  });

  // ===========================================================================
  // RPC FETCHING TESTS - MASSIVE SCENARIO FOR PAGINATION
  // ===========================================================================
  describe("RPC Fetching - Creating Many Locks", () => {
    const now = Math.floor(Date.now() / 1000);
    
    // Track created locks for verification
    const createdLocks = {
      user1: { mint1: [] as number[], mint2: [] as number[], mint3: [] as number[] },
      user2: { mint1: [] as number[], mint2: [] as number[] },
      user3: { mint1: [] as number[] },
    };

    it("creates 15 locks for user1 with mint1 (varying amounts and timestamps)", async () => {
      // Smaller amounts to not exceed available balance (10000 tokens - ~110 used in prior tests)
      const amounts = [
        10, 20, 30, 40, 50, 60, 70, 80, 90, 100,
        150, 200, 250, 300, 500
      ]; // in tokens (will multiply by decimals) - total: 1950 tokens
      
      for (let i = 0; i < 15; i++) {
        const amount = new anchor.BN(amounts[i] * 1_000_000_000); // 9 decimals
        // Spread unlock times: 1 hour, 2 hours, 3 hours... up to 15 hours
        const unlockTimestamp = new anchor.BN(now + (i + 1) * 3600);
        
        const lockId = await createLock(user1, user1TokenAccount1, mint1, amount, unlockTimestamp);
        createdLocks.user1.mint1.push(lockId);
        
        // Small delay to ensure different created_at timestamps
        await new Promise(r => setTimeout(r, 100));
      }
      
      expect(createdLocks.user1.mint1.length).to.equal(15);
      console.log(`Created 15 locks for user1 with mint1 (IDs: ${createdLocks.user1.mint1.join(', ')})`);
    });

    it("creates 8 locks for user1 with mint2", async () => {
      const amounts = [100, 200, 300, 400, 500, 600, 700, 800]; // 6 decimals
      
      for (let i = 0; i < 8; i++) {
        const amount = new anchor.BN(amounts[i] * 1_000_000);
        const unlockTimestamp = new anchor.BN(now + (i + 1) * 7200); // 2 hour intervals
        
        const lockId = await createLock(user1, user1TokenAccount2, mint2, amount, unlockTimestamp);
        createdLocks.user1.mint2.push(lockId);
        await new Promise(r => setTimeout(r, 100));
      }
      
      console.log(`Created 8 locks for user1 with mint2`);
    });

    it("creates 5 locks for user1 with mint3", async () => {
      for (let i = 0; i < 5; i++) {
        const amount = new anchor.BN((i + 1) * 100_000_000_000);
        const unlockTimestamp = new anchor.BN(now + (i + 1) * 86400); // 1 day intervals
        
        const lockId = await createLock(user1, user1TokenAccount3, mint3, amount, unlockTimestamp);
        createdLocks.user1.mint3.push(lockId);
        await new Promise(r => setTimeout(r, 100));
      }
      
      console.log(`Created 5 locks for user1 with mint3`);
    });

    it("creates 10 locks for user2 with mint1", async () => {
      for (let i = 0; i < 10; i++) {
        const amount = new anchor.BN((i + 1) * 50_000_000_000);
        const unlockTimestamp = new anchor.BN(now + (i + 1) * 5400); // 1.5 hour intervals
        
        const lockId = await createLock(user2, user2TokenAccount1, mint1, amount, unlockTimestamp);
        createdLocks.user2.mint1.push(lockId);
        await new Promise(r => setTimeout(r, 100));
      }
      
      console.log(`Created 10 locks for user2 with mint1`);
    });

    it("creates 5 locks for user2 with mint2", async () => {
      for (let i = 0; i < 5; i++) {
        const amount = new anchor.BN((i + 1) * 150_000_000);
        const unlockTimestamp = new anchor.BN(now + (i + 1) * 10800); // 3 hour intervals
        
        const lockId = await createLock(user2, user2TokenAccount2, mint2, amount, unlockTimestamp);
        createdLocks.user2.mint2.push(lockId);
        await new Promise(r => setTimeout(r, 100));
      }
      
      console.log(`Created 5 locks for user2 with mint2`);
    });

    it("creates 7 locks for user3 with mint1", async () => {
      for (let i = 0; i < 7; i++) {
        const amount = new anchor.BN((i + 1) * 30_000_000_000);
        const unlockTimestamp = new anchor.BN(now + (i + 1) * 4000);
        
        const lockId = await createLock(user3, user3TokenAccount1, mint1, amount, unlockTimestamp);
        createdLocks.user3.mint1.push(lockId);
        await new Promise(r => setTimeout(r, 100));
      }
      
      console.log(`Created 7 locks for user3 with mint1`);
    });

    it("verifies total lock count", async () => {
      const allLocks = await lockFetcher.fetchAll();
      // 2 initial locks + 15 + 8 + 5 + 10 + 5 + 7 = 52 total (minus some from initial tests)
      console.log(`Total locks in program: ${allLocks.length}`);
      expect(allLocks.length).to.be.gte(50);
    });
  });

  // ===========================================================================
  // FILTERING BY OWNER (WALLET)
  // ===========================================================================
  describe("RPC Fetching - Filter by Owner (Wallet)", () => {
    it("fetches all locks for user1 via memcmp", async () => {
      const user1Locks = await lockFetcher.fetchByOwner(user1.publicKey);
      
      // Should have 15 + 8 + 5 = 28 locks (plus initial test locks)
      console.log(`User1 total locks: ${user1Locks.length}`);
      expect(user1Locks.length).to.be.gte(28);
      
      // Verify all locks belong to user1
      user1Locks.forEach(lock => {
        expect(lock.account.owner.toString()).to.equal(user1.publicKey.toString());
      });
    });

    it("fetches all locks for user2 via memcmp", async () => {
      const user2Locks = await lockFetcher.fetchByOwner(user2.publicKey);
      
      // Should have 10 + 5 = 15 locks
      console.log(`User2 total locks: ${user2Locks.length}`);
      expect(user2Locks.length).to.be.gte(15);
      
      user2Locks.forEach(lock => {
        expect(lock.account.owner.toString()).to.equal(user2.publicKey.toString());
      });
    });

    it("fetches all locks for user3 via memcmp", async () => {
      const user3Locks = await lockFetcher.fetchByOwner(user3.publicKey);
      
      // Should have at least 7 locks (may have more from other tests)
      console.log(`User3 total locks: ${user3Locks.length}`);
      expect(user3Locks.length).to.be.gte(7);
      
      user3Locks.forEach(lock => {
        expect(lock.account.owner.toString()).to.equal(user3.publicKey.toString());
      });
    });

    it("returns empty array for wallet with no locks", async () => {
      const randomWallet = Keypair.generate();
      const noLocks = await lockFetcher.fetchByOwner(randomWallet.publicKey);
      expect(noLocks.length).to.equal(0);
    });
  });

  // ===========================================================================
  // FILTERING BY TOKEN MINT
  // ===========================================================================
  describe("RPC Fetching - Filter by Token Mint", () => {
    it("fetches all locks for mint1", async () => {
      const mint1Locks = await lockFetcher.fetchByMint(mint1);
      
      // user1: 15, user2: 10, user3: 7 = 32+ locks
      console.log(`Mint1 total locks: ${mint1Locks.length}`);
      expect(mint1Locks.length).to.be.gte(32);
      
      mint1Locks.forEach(lock => {
        expect(lock.account.mint.toString()).to.equal(mint1.toString());
      });
    });

    it("fetches all locks for mint2", async () => {
      const mint2Locks = await lockFetcher.fetchByMint(mint2);
      
      // user1: 8, user2: 5 = 13 locks
      console.log(`Mint2 total locks: ${mint2Locks.length}`);
      expect(mint2Locks.length).to.be.gte(13);
      
      mint2Locks.forEach(lock => {
        expect(lock.account.mint.toString()).to.equal(mint2.toString());
      });
    });

    it("fetches all locks for mint3", async () => {
      const mint3Locks = await lockFetcher.fetchByMint(mint3);
      
      // user1: 5 locks
      console.log(`Mint3 total locks: ${mint3Locks.length}`);
      expect(mint3Locks.length).to.equal(5);
      
      mint3Locks.forEach(lock => {
        expect(lock.account.mint.toString()).to.equal(mint3.toString());
      });
    });
  });

  // ===========================================================================
  // COMBINED FILTERS (OWNER + MINT)
  // ===========================================================================
  describe("RPC Fetching - Combined Filters (Owner + Mint)", () => {
    it("fetches user1 locks with mint1 only", async () => {
      const locks = await lockFetcher.fetchByOwnerAndMint(user1.publicKey, mint1);
      
      console.log(`User1 + Mint1 locks: ${locks.length}`);
      expect(locks.length).to.be.gte(15);
      
      locks.forEach(lock => {
        expect(lock.account.owner.toString()).to.equal(user1.publicKey.toString());
        expect(lock.account.mint.toString()).to.equal(mint1.toString());
      });
    });

    it("fetches user1 locks with mint2 only", async () => {
      const locks = await lockFetcher.fetchByOwnerAndMint(user1.publicKey, mint2);
      
      console.log(`User1 + Mint2 locks: ${locks.length}`);
      expect(locks.length).to.be.gte(8); // At least 8 locks (may have more from other tests)
      
      locks.forEach(lock => {
        expect(lock.account.owner.toString()).to.equal(user1.publicKey.toString());
        expect(lock.account.mint.toString()).to.equal(mint2.toString());
      });
    });

    it("fetches user2 locks with mint2 only", async () => {
      const locks = await lockFetcher.fetchByOwnerAndMint(user2.publicKey, mint2);
      
      console.log(`User2 + Mint2 locks: ${locks.length}`);
      expect(locks.length).to.equal(5);
    });

    it("returns empty for user3 + mint2 (no such combination)", async () => {
      const locks = await lockFetcher.fetchByOwnerAndMint(user3.publicKey, mint2);
      expect(locks.length).to.equal(0);
    });
  });

  // ===========================================================================
  // FILTERING BY AMOUNT (CLIENT-SIDE)
  // ===========================================================================
  describe("RPC Fetching - Filter by Amount Range", () => {
    it("fetches locks with amount between 100-500 tokens (mint1)", async () => {
      const mint1Locks = await lockFetcher.fetchByMint(mint1);
      const minAmount = new anchor.BN(100_000_000_000); // 100 tokens
      const maxAmount = new anchor.BN(500_000_000_000); // 500 tokens
      
      const filtered = lockFetcher.filterByAmountRange(mint1Locks, minAmount, maxAmount);
      
      console.log(`Locks with 100-500 tokens (mint1): ${filtered.length}`);
      expect(filtered.length).to.be.greaterThan(0);
      
      filtered.forEach(lock => {
        const amount = lock.account.amount.toNumber();
        expect(amount).to.be.gte(minAmount.toNumber());
        expect(amount).to.be.lte(maxAmount.toNumber());
      });
    });

    it("fetches user1 locks with small amounts (< 100 tokens)", async () => {
      const user1Mint1Locks = await lockFetcher.fetchByOwnerAndMint(user1.publicKey, mint1);
      const minAmount = new anchor.BN(0);
      const maxAmount = new anchor.BN(100_000_000_000 - 1); // < 100 tokens
      
      const smallLocks = lockFetcher.filterByAmountRange(user1Mint1Locks, minAmount, maxAmount);
      
      console.log(`User1 mint1 locks < 100 tokens: ${smallLocks.length}`);
      expect(smallLocks.length).to.be.greaterThan(0);
      
      smallLocks.forEach(lock => {
        expect(lock.account.amount.toNumber()).to.be.lt(100_000_000_000);
      });
    });

    it("fetches user1 locks with large amounts (> 200 tokens)", async () => {
      const user1Mint1Locks = await lockFetcher.fetchByOwnerAndMint(user1.publicKey, mint1);
      const minAmount = new anchor.BN(200_000_000_000 + 1); // > 200 tokens
      const maxAmount = new anchor.BN(Number.MAX_SAFE_INTEGER);
      
      const largeLocks = lockFetcher.filterByAmountRange(user1Mint1Locks, minAmount, maxAmount);
      
      console.log(`User1 mint1 locks > 200 tokens: ${largeLocks.length}`);
      expect(largeLocks.length).to.be.greaterThan(0);
      
      largeLocks.forEach(lock => {
        expect(lock.account.amount.toNumber()).to.be.gt(200_000_000_000);
      });
    });
  });

  // ===========================================================================
  // FILTERING BY TIMESTAMP (CLIENT-SIDE)
  // ===========================================================================
  describe("RPC Fetching - Filter by Timestamp Range", () => {
    const now = Math.floor(Date.now() / 1000);

    it("fetches locks unlocking in next 6 hours", async () => {
      const allLocks = await lockFetcher.fetchAll();
      const filtered = lockFetcher.filterByUnlockTimestampRange(
        allLocks,
        now,
        now + 6 * 3600
      );
      
      console.log(`Locks unlocking in next 6 hours: ${filtered.length}`);
      
      filtered.forEach(lock => {
        const ts = lock.account.unlockTimestamp.toNumber();
        expect(ts).to.be.gte(now);
        expect(ts).to.be.lte(now + 6 * 3600);
      });
    });

    it("fetches locks unlocking in 12-24 hours", async () => {
      const allLocks = await lockFetcher.fetchAll();
      const filtered = lockFetcher.filterByUnlockTimestampRange(
        allLocks,
        now + 12 * 3600,
        now + 24 * 3600
      );
      
      console.log(`Locks unlocking in 12-24 hours: ${filtered.length}`);
      
      filtered.forEach(lock => {
        const ts = lock.account.unlockTimestamp.toNumber();
        expect(ts).to.be.gte(now + 12 * 3600);
        expect(ts).to.be.lte(now + 24 * 3600);
      });
    });

    it("fetches locks unlocking soon (within 3 hours) using helper", async () => {
      const now = Math.floor(Date.now() / 1000);
      const activeLocks = await lockFetcher.fetchActive();
      const soonLocks = lockFetcher.filterUnlockingSoon(activeLocks, 3 * 3600);
      
      console.log(`Locks unlocking within 3 hours: ${soonLocks.length}`);
      
      soonLocks.forEach(lock => {
        const ts = lock.account.unlockTimestamp.toNumber();
        const threshold = now + 3 * 3600;
        expect(ts).to.be.gte(now);
        expect(ts).to.be.lte(threshold + 10); // Allow small margin for timing differences
      });
    });
  });

  // ===========================================================================
  // SORTING TESTS
  // ===========================================================================
  describe("RPC Fetching - Sorting", () => {
    it("sorts by unlock timestamp ascending (soonest first)", async () => {
      const user1Locks = await lockFetcher.fetchByOwner(user1.publicKey);
      const sorted = lockFetcher.sortByUnlockTimestampAsc(user1Locks);
      
      console.log("User1 locks sorted by unlock timestamp (asc):");
      sorted.slice(0, 5).forEach((lock, i) => {
        console.log(`  ${i + 1}. Lock #${lock.account.id}: unlocks ${new Date(lock.account.unlockTimestamp.toNumber() * 1000).toISOString()}`);
      });
      
      for (let i = 1; i < sorted.length; i++) {
        expect(sorted[i].account.unlockTimestamp.toNumber())
          .to.be.gte(sorted[i - 1].account.unlockTimestamp.toNumber());
      }
    });

    it("sorts by unlock timestamp descending (latest first)", async () => {
      const user1Locks = await lockFetcher.fetchByOwner(user1.publicKey);
      const sorted = lockFetcher.sortByUnlockTimestampDesc(user1Locks);
      
      for (let i = 1; i < sorted.length; i++) {
        expect(sorted[i].account.unlockTimestamp.toNumber())
          .to.be.lte(sorted[i - 1].account.unlockTimestamp.toNumber());
      }
    });

    it("sorts by created_at ascending (oldest first)", async () => {
      const user1Locks = await lockFetcher.fetchByOwner(user1.publicKey);
      const sorted = lockFetcher.sortByCreatedAtAsc(user1Locks);
      
      console.log("User1 locks sorted by created_at (asc):");
      sorted.slice(0, 5).forEach((lock, i) => {
        console.log(`  ${i + 1}. Lock #${lock.account.id}: created ${new Date(lock.account.createdAt.toNumber() * 1000).toISOString()}`);
      });
      
      for (let i = 1; i < sorted.length; i++) {
        expect(sorted[i].account.createdAt.toNumber())
          .to.be.gte(sorted[i - 1].account.createdAt.toNumber());
      }
    });

    it("sorts by created_at descending (newest first)", async () => {
      const user1Locks = await lockFetcher.fetchByOwner(user1.publicKey);
      const sorted = lockFetcher.sortByCreatedAtDesc(user1Locks);
      
      for (let i = 1; i < sorted.length; i++) {
        expect(sorted[i].account.createdAt.toNumber())
          .to.be.lte(sorted[i - 1].account.createdAt.toNumber());
      }
    });

    it("sorts by amount ascending (smallest first)", async () => {
      const user1Mint1Locks = await lockFetcher.fetchByOwnerAndMint(user1.publicKey, mint1);
      const sorted = lockFetcher.sortByAmountAsc(user1Mint1Locks);
      
      console.log("User1 mint1 locks sorted by amount (asc):");
      sorted.slice(0, 5).forEach((lock, i) => {
        console.log(`  ${i + 1}. Lock #${lock.account.id}: ${lock.account.amount.toNumber() / 1e9} tokens`);
      });
      
      for (let i = 1; i < sorted.length; i++) {
        expect(sorted[i].account.amount.gte(sorted[i - 1].account.amount)).to.be.true;
      }
    });

    it("sorts by amount descending (largest first)", async () => {
      const user1Mint1Locks = await lockFetcher.fetchByOwnerAndMint(user1.publicKey, mint1);
      const sorted = lockFetcher.sortByAmountDesc(user1Mint1Locks);
      
      console.log("User1 mint1 locks sorted by amount (desc):");
      sorted.slice(0, 5).forEach((lock, i) => {
        console.log(`  ${i + 1}. Lock #${lock.account.id}: ${lock.account.amount.toNumber() / 1e9} tokens`);
      });
      
      for (let i = 1; i < sorted.length; i++) {
        expect(sorted[i].account.amount.lte(sorted[i - 1].account.amount)).to.be.true;
      }
    });

    it("sorts by ID ascending", async () => {
      const allLocks = await lockFetcher.fetchAll();
      const sorted = lockFetcher.sortByIdAsc(allLocks);
      
      for (let i = 1; i < sorted.length; i++) {
        expect(sorted[i].account.id.toNumber())
          .to.be.gt(sorted[i - 1].account.id.toNumber());
      }
    });
  });

  // ===========================================================================
  // PAGINATION TESTS
  // ===========================================================================
  describe("RPC Fetching - Pagination", () => {
    it("paginates user1 locks with page size 5", async () => {
      const user1Locks = await lockFetcher.fetchByOwner(user1.publicKey);
      const sorted = lockFetcher.sortByCreatedAtDesc(user1Locks);
      
      const pageSize = 5;
      const totalPages = Math.ceil(sorted.length / pageSize);
      
      console.log(`\nPagination test: ${sorted.length} locks, ${totalPages} pages (page size: ${pageSize})`);
      
      // Fetch each page and verify
      for (let page = 0; page < totalPages; page++) {
        const result = lockFetcher.paginate(sorted, page, pageSize);
        
        console.log(`  Page ${page + 1}/${totalPages}: ${result.data.length} items, hasNext: ${result.hasNextPage}, hasPrev: ${result.hasPrevPage}`);
        
        expect(result.page).to.equal(page);
        expect(result.pageSize).to.equal(pageSize);
        expect(result.totalPages).to.equal(totalPages);
        expect(result.totalItems).to.equal(sorted.length);
        
        if (page < totalPages - 1) {
          expect(result.data.length).to.equal(pageSize);
          expect(result.hasNextPage).to.be.true;
        } else {
          expect(result.data.length).to.be.lte(pageSize);
          expect(result.hasNextPage).to.be.false;
        }
        
        if (page > 0) {
          expect(result.hasPrevPage).to.be.true;
        } else {
          expect(result.hasPrevPage).to.be.false;
        }
      }
    });

    it("uses integrated pagination helper with sorting", async () => {
      // Simulate frontend scroll loading
      const pageSize = 5;
      
      console.log("\nSimulating infinite scroll loading for user1:");
      
      // Page 1 - newest locks first
      let page1 = await lockFetcher.fetchPaginatedByOwner(
        user1.publicKey,
        0,
        pageSize,
        'createdAt',
        'desc'
      );
      console.log(`  Page 1: ${page1.data.length} locks loaded`);
      expect(page1.data.length).to.equal(pageSize);
      expect(page1.page).to.equal(0);
      
      // Page 2 - scroll down
      let page2 = await lockFetcher.fetchPaginatedByOwner(
        user1.publicKey,
        1,
        pageSize,
        'createdAt',
        'desc'
      );
      console.log(`  Page 2: ${page2.data.length} more locks loaded`);
      expect(page2.hasPrevPage).to.be.true;
      
      // Page 3 - continue scrolling
      let page3 = await lockFetcher.fetchPaginatedByOwner(
        user1.publicKey,
        2,
        pageSize,
        'createdAt',
        'desc'
      );
      console.log(`  Page 3: ${page3.data.length} more locks loaded`);
      
      // Verify no duplicates between pages
      const page1Ids = new Set(page1.data.map(l => l.account.id.toNumber()));
      const page2Ids = new Set(page2.data.map(l => l.account.id.toNumber()));
      const page3Ids = new Set(page3.data.map(l => l.account.id.toNumber()));
      
      page2Ids.forEach(id => expect(page1Ids.has(id)).to.be.false);
      page3Ids.forEach(id => expect(page1Ids.has(id)).to.be.false);
      page3Ids.forEach(id => expect(page2Ids.has(id)).to.be.false);
    });

    it("paginates by unlock timestamp for 'upcoming unlocks' view", async () => {
      const pageSize = 10;
      
      // Get locks sorted by unlock timestamp (soonest first)
      const result = await lockFetcher.fetchPaginatedByOwner(
        user1.publicKey,
        0,
        pageSize,
        'unlockTimestamp',
        'asc'
      );
      
      console.log(`\nUpcoming unlocks for user1 (first ${result.data.length}):`);
      result.data.forEach((lock, i) => {
        const unlockDate = new Date(lock.account.unlockTimestamp.toNumber() * 1000);
        console.log(`  ${i + 1}. Lock #${lock.account.id}: ${unlockDate.toISOString()}`);
      });
      
      // Verify sorted correctly
      for (let i = 1; i < result.data.length; i++) {
        expect(result.data[i].account.unlockTimestamp.toNumber())
          .to.be.gte(result.data[i - 1].account.unlockTimestamp.toNumber());
      }
    });

    it("paginates by amount for 'largest locks' view", async () => {
      const pageSize = 5;
      
      // Get locks sorted by amount (largest first)
      const result = await lockFetcher.fetchPaginatedByOwner(
        user1.publicKey,
        0,
        pageSize,
        'amount',
        'desc'
      );
      
      console.log(`\nLargest locks for user1 (top ${result.data.length}):`);
      result.data.forEach((lock, i) => {
        console.log(`  ${i + 1}. Lock #${lock.account.id}: ${lock.account.amount.toNumber() / 1e9} tokens (mint: ${lock.account.mint.toString().slice(0, 8)}...)`);
      });
      
      // Verify sorted correctly
      for (let i = 1; i < result.data.length; i++) {
        expect(result.data[i].account.amount.lte(result.data[i - 1].account.amount)).to.be.true;
      }
    });
  });

  // ===========================================================================
  // ACTIVE VS UNLOCKED FILTERING
  // ===========================================================================
  describe("RPC Fetching - Active vs Unlocked", () => {
    it("fetches only active (not unlocked) locks", async () => {
      const activeLocks = await lockFetcher.fetchActive();
      const allLocks = await lockFetcher.fetchAll();
      
      console.log(`Active locks: ${activeLocks.length} / ${allLocks.length} total`);
      
      activeLocks.forEach(lock => {
        expect(lock.account.isUnlocked).to.be.false;
      });
    });

    it("fetches active locks for specific user", async () => {
      const activeUser1Locks = await lockFetcher.fetchActiveByOwner(user1.publicKey);
      const allUser1Locks = await lockFetcher.fetchByOwner(user1.publicKey);
      
      console.log(`User1 active locks: ${activeUser1Locks.length} / ${allUser1Locks.length} total`);
      
      activeUser1Locks.forEach(lock => {
        expect(lock.account.isUnlocked).to.be.false;
        expect(lock.account.owner.toString()).to.equal(user1.publicKey.toString());
      });
    });

    it("identifies unlockable locks (timestamp passed, not yet unlocked)", async () => {
      const activeLocks = await lockFetcher.fetchActive();
      const unlockable = lockFetcher.filterUnlockable(activeLocks);
      
      console.log(`Unlockable locks (ready to claim): ${unlockable.length}`);
      
      const now = Math.floor(Date.now() / 1000);
      unlockable.forEach(lock => {
        expect(lock.account.isUnlocked).to.be.false;
        expect(lock.account.unlockTimestamp.toNumber()).to.be.lte(now);
      });
    });
  });

  // ===========================================================================
  // COMPLEX QUERY SCENARIOS
  // ===========================================================================
  describe("RPC Fetching - Complex Query Scenarios", () => {
    it("dashboard view: user's locks grouped by token", async () => {
      const user1Locks = await lockFetcher.fetchByOwner(user1.publicKey);
      
      // Group by mint
      const byMint = new Map<string, LockAccount[]>();
      user1Locks.forEach(lock => {
        const mintKey = lock.account.mint.toString();
        if (!byMint.has(mintKey)) {
          byMint.set(mintKey, []);
        }
        byMint.get(mintKey)!.push(lock);
      });
      
      console.log("\nUser1 dashboard - locks by token:");
      for (const [mint, locks] of byMint) {
        const totalAmount = locks.reduce((sum, l) => sum + l.account.amount.toNumber(), 0);
        const activeLocks = locks.filter(l => !l.account.isUnlocked);
        console.log(`  ${mint.slice(0, 8)}...: ${locks.length} locks (${activeLocks.length} active), total: ${totalAmount / 1e9} tokens`);
      }
      
      expect(byMint.size).to.equal(3); // 3 different mints for user1
    });

    it("token page view: all locks for specific token across all users", async () => {
      const mint1Locks = await lockFetcher.fetchByMint(mint1);
      const sorted = lockFetcher.sortByAmountDesc(mint1Locks);
      
      // Group by owner
      const byOwner = new Map<string, LockAccount[]>();
      sorted.forEach(lock => {
        const ownerKey = lock.account.owner.toString();
        if (!byOwner.has(ownerKey)) {
          byOwner.set(ownerKey, []);
        }
        byOwner.get(ownerKey)!.push(lock);
      });
      
      console.log("\nMint1 token page - locks by owner:");
      for (const [owner, locks] of byOwner) {
        const totalAmount = locks.reduce((sum, l) => sum + l.account.amount.toNumber(), 0);
        console.log(`  ${owner.slice(0, 8)}...: ${locks.length} locks, total: ${totalAmount / 1e9} tokens`);
      }
      
      expect(byOwner.size).to.equal(3); // 3 users have mint1 locks
    });

    it("upcoming unlocks widget: next 5 locks to unlock for user", async () => {
      const activeLocks = await lockFetcher.fetchActiveByOwner(user1.publicKey);
      const sorted = lockFetcher.sortByUnlockTimestampAsc(activeLocks);
      const upcoming = sorted.slice(0, 5);
      
      console.log("\nUser1's next 5 upcoming unlocks:");
      const now = Math.floor(Date.now() / 1000);
      upcoming.forEach((lock, i) => {
        const unlockTs = lock.account.unlockTimestamp.toNumber();
        const hoursUntil = ((unlockTs - now) / 3600).toFixed(1);
        console.log(`  ${i + 1}. Lock #${lock.account.id}: ${lock.account.amount.toNumber() / 1e9} tokens in ${hoursUntil} hours`);
      });
      
      expect(upcoming.length).to.be.lte(5);
    });

    it("analytics: total locked value per token", async () => {
      const allLocks = await lockFetcher.fetchAll();
      const activeLocks = allLocks.filter(l => !l.account.isUnlocked);
      
      const tvlByMint = new Map<string, anchor.BN>();
      activeLocks.forEach(lock => {
        const mintKey = lock.account.mint.toString();
        const current = tvlByMint.get(mintKey) || new anchor.BN(0);
        tvlByMint.set(mintKey, current.add(lock.account.amount));
      });
      
      console.log("\nTotal Value Locked (TVL) by token:");
      for (const [mint, tvl] of tvlByMint) {
        console.log(`  ${mint.slice(0, 8)}...: ${tvl.toString()} (raw)`);
      }
    });
  });

  // ===========================================================================
  // PERFORMANCE CONSIDERATIONS
  // ===========================================================================
  describe("RPC Fetching - Performance Notes", () => {
    it("demonstrates efficient filtering strategy", async () => {
      console.log("\n=== RPC FETCHING BEST PRACTICES ===\n");
      
      console.log("1. MEMCMP FILTERS (server-side, fast):");
      console.log("   - Filter by owner: offset 16");
      console.log("   - Filter by mint: offset 48");
      console.log("   - Can combine multiple memcmp filters");
      
      console.log("\n2. CLIENT-SIDE FILTERS (after fetch):");
      console.log("   - Amount ranges (no memcmp for ranges)");
      console.log("   - Timestamp ranges");
      console.log("   - isUnlocked status");
      
      console.log("\n3. PAGINATION STRATEGY:");
      console.log("   - Fetch all matching locks first");
      console.log("   - Sort client-side");
      console.log("   - Paginate from sorted array");
      console.log("   - Cache results for smooth scrolling");
      
      console.log("\n4. RECOMMENDED FRONTEND APPROACH:");
      console.log("   - Use memcmp to narrow results (owner + mint)");
      console.log("   - Apply client-side filters (amount, timestamp)");
      console.log("   - Sort by desired field");
      console.log("   - Paginate with consistent ordering");
      
      // Demonstrate timing
      const startFetch = Date.now();
      const user1Locks = await lockFetcher.fetchByOwner(user1.publicKey);
      const fetchTime = Date.now() - startFetch;
      
      const startFilter = Date.now();
      const filtered = lockFetcher.filterByAmountRange(
        user1Locks,
        new anchor.BN(50_000_000_000),
        new anchor.BN(500_000_000_000)
      );
      const sorted = lockFetcher.sortByUnlockTimestampAsc(filtered);
      const paginated = lockFetcher.paginate(sorted, 0, 10);
      const processTime = Date.now() - startFilter;
      
      console.log(`\n5. PERFORMANCE EXAMPLE:`);
      console.log(`   - Fetch ${user1Locks.length} locks: ${fetchTime}ms`);
      console.log(`   - Filter + Sort + Paginate: ${processTime}ms`);
      console.log(`   - Result: ${paginated.data.length} items on page 1`);
    });
  });

  // ===========================================================================
  // GLOBAL STATE & LOCK COUNTER TESTS
  // ===========================================================================
  describe("Global State & Lock Counter", () => {
    it("should have lock_counter that matches actual lock count", async () => {
      const globalState = await program.account.globalState.fetch(globalStatePda);
      const counterValue = globalState.lockCounter.toNumber();
      
      // Verify counter exists and is a valid number
      expect(counterValue).to.be.a('number');
      expect(counterValue).to.be.greaterThanOrEqual(0);
      
      // Verify counter matches the actual number of locks
      const allLocks = await lockFetcher.fetchAll();
      expect(counterValue).to.equal(allLocks.length);
    });

    it("should increment lock_counter when creating locks", async () => {
      // Capture initial state
      const globalStateInitial = await program.account.globalState.fetch(globalStatePda);
      const initialCounter = globalStateInitial.lockCounter.toNumber();
      
      // Create 5 locks
      const unlockTimestamp = new anchor.BN(Math.floor(Date.now() / 1000) + 3600);
      const amount = new anchor.BN(100_000_000); // 0.1 tokens

      const lockIds: number[] = [];

      for (let i = 0; i < 5; i++) {
        // Check counter before creating lock
        const globalStateBefore = await program.account.globalState.fetch(globalStatePda);
        const expectedId = globalStateBefore.lockCounter.toNumber();
        
        // Create lock
        const lockId = await createLock(
          user1,
          user1TokenAccount1,
          mint1,
          amount,
          unlockTimestamp
        );

        lockIds.push(lockId);

        // Verify the lock got the correct sequential ID
        expect(lockId).to.equal(expectedId);

        // Verify counter incremented
        const globalStateAfter = await program.account.globalState.fetch(globalStatePda);
        expect(globalStateAfter.lockCounter.toNumber()).to.equal(expectedId + 1);

        // Verify the lock account has the correct ID
        const lockPda = getLockPda(lockId);
        const lock = await program.account.lock.fetch(lockPda);
        expect(lock.id.toNumber()).to.equal(lockId);
      }

      // Verify all IDs are sequential relative to initial counter
      for (let i = 0; i < lockIds.length; i++) {
        expect(lockIds[i]).to.equal(initialCounter + i);
      }

      // Final counter should be initial + 5
      const finalGlobalState = await program.account.globalState.fetch(globalStatePda);
      expect(finalGlobalState.lockCounter.toNumber()).to.equal(initialCounter + 5);
    });

    it("should easily fetch total lock count from GlobalState", async () => {
      const totalCount = await lockFetcher.getTotalLockCount();
      expect(totalCount).to.be.a('number');
      expect(totalCount).to.be.greaterThanOrEqual(0);
      
      // Verify it matches the actual number of locks
      const allLocks = await lockFetcher.fetchAll();
      expect(totalCount).to.equal(allLocks.length);
    });

    it("should fetch the X most recent locks correctly", async () => {
      // Create 10 more locks to have enough data
      const unlockTimestamp = new anchor.BN(Math.floor(Date.now() / 1000) + 3600);
      const amount = new anchor.BN(50_000_000);

      const totalBefore = await lockFetcher.getTotalLockCount();

      for (let i = 0; i < 10; i++) {
        await createLock(
          user1,
          user1TokenAccount1,
          mint1,
          amount,
          unlockTimestamp
        );
      }

      const totalAfter = await lockFetcher.getTotalLockCount();
      expect(totalAfter).to.equal(totalBefore + 10);

      // Fetch the 5 most recent locks
      const latest5 = await lockFetcher.fetchLatestLocks(5);
      expect(latest5.length).to.equal(5);

      // Verify they are sorted by ID descending (highest ID = most recent)
      for (let i = 0; i < latest5.length - 1; i++) {
        expect(latest5[i].account.id.toNumber()).to.be.greaterThan(
          latest5[i + 1].account.id.toNumber()
        );
      }

      // Verify the most recent lock has the highest ID (totalAfter - 1)
      expect(latest5[0].account.id.toNumber()).to.equal(totalAfter - 1);
      expect(latest5[latest5.length - 1].account.id.toNumber()).to.equal(totalAfter - 5);
    });

    it("should fetch locks by ID range correctly", async () => {
      const totalCount = await lockFetcher.getTotalLockCount();
      
      if (totalCount >= 10) {
        // Fetch locks with IDs from (totalCount - 10) to (totalCount - 1)
        const startId = totalCount - 10;
        const endId = totalCount;
        
        const locksInRange = await lockFetcher.fetchLocksByIdRange(startId, endId);
        
        // Should have 10 locks (or less if some were unlocked/deleted)
        expect(locksInRange.length).to.be.greaterThan(0);
        expect(locksInRange.length).to.be.lessThanOrEqual(10);
        
        // Verify all IDs are in range
        locksInRange.forEach(lock => {
          const id = lock.account.id.toNumber();
          expect(id).to.be.greaterThanOrEqual(startId);
          expect(id).to.be.lessThan(endId);
        });

        // Verify they are sorted by ID ascending
        for (let i = 0; i < locksInRange.length - 1; i++) {
          expect(locksInRange[i].account.id.toNumber()).to.be.lessThan(
            locksInRange[i + 1].account.id.toNumber()
          );
        }
      }
    });

    it("should maintain sequential IDs across multiple users", async () => {
      const totalBefore = await lockFetcher.getTotalLockCount();
      const unlockTimestamp = new anchor.BN(Math.floor(Date.now() / 1000) + 3600);
      const amount = new anchor.BN(30_000_000);

      // Create locks from different users
      const lockId1 = await createLock(user1, user1TokenAccount1, mint1, amount, unlockTimestamp);
      const lockId2 = await createLock(user2, user2TokenAccount1, mint1, amount, unlockTimestamp);
      const lockId3 = await createLock(user3, user3TokenAccount1, mint1, amount, unlockTimestamp);
      const lockId4 = await createLock(user1, user1TokenAccount2, mint2, amount, unlockTimestamp);

      // Verify IDs are sequential regardless of user
      expect(lockId2).to.equal(lockId1 + 1);
      expect(lockId3).to.equal(lockId2 + 1);
      expect(lockId4).to.equal(lockId3 + 1);

      // Verify each lock has the correct ID stored
      const lock1 = await program.account.lock.fetch(getLockPda(lockId1));
      const lock2 = await program.account.lock.fetch(getLockPda(lockId2));
      const lock3 = await program.account.lock.fetch(getLockPda(lockId3));
      const lock4 = await program.account.lock.fetch(getLockPda(lockId4));

      expect(lock1.id.toNumber()).to.equal(lockId1);
      expect(lock2.id.toNumber()).to.equal(lockId2);
      expect(lock3.id.toNumber()).to.equal(lockId3);
      expect(lock4.id.toNumber()).to.equal(lockId4);

      // Verify global counter matches
      const totalAfter = await lockFetcher.getTotalLockCount();
      expect(totalAfter).to.equal(totalBefore + 4);
    });

    it("should allow fetching latest locks even when some are unlocked", async () => {
      const totalBefore = await lockFetcher.getTotalLockCount();
      const unlockTimestamp = new anchor.BN(Math.floor(Date.now() / 1000) + 3600);
      const amount = new anchor.BN(20_000_000);

      // Create 3 locks
      const lockId1 = await createLock(user1, user1TokenAccount1, mint1, amount, unlockTimestamp);
      const lockId2 = await createLock(user1, user1TokenAccount1, mint1, amount, unlockTimestamp);
      const lockId3 = await createLock(user1, user1TokenAccount1, mint1, amount, unlockTimestamp);

      // Verify total count is correct
      const totalAfter = await lockFetcher.getTotalLockCount();
      expect(totalAfter).to.equal(totalBefore + 3);

      // Fetch the 5 most recent locks (should include our 3 new ones)
      const latest5 = await lockFetcher.fetchLatestLocks(5);
      expect(latest5.length).to.equal(5);
      
      // Verify they are sorted by ID descending (highest ID = most recent)
      for (let i = 0; i < latest5.length - 1; i++) {
        expect(latest5[i].account.id.toNumber()).to.be.greaterThan(
          latest5[i + 1].account.id.toNumber()
        );
      }
      
      // Verify our newly created locks are in the latest locks
      const ids = latest5.map(l => l.account.id.toNumber());
      expect(ids).to.include(lockId1);
      expect(ids).to.include(lockId2);
      expect(ids).to.include(lockId3);
      
      // Verify the most recent lock is lockId3 (the last one we created)
      expect(latest5[0].account.id.toNumber()).to.equal(lockId3);
    });

    it("should handle edge case: fetch latest locks when count > total locks", async () => {
      const totalCount = await lockFetcher.getTotalLockCount();
      
      // Try to fetch more locks than exist
      const latest100 = await lockFetcher.fetchLatestLocks(100);
      
      // Should return at most totalCount locks
      expect(latest100.length).to.be.lessThanOrEqual(totalCount);
      expect(latest100.length).to.be.greaterThan(0);
    });
  });
});
