import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { TimelockSupply } from "../target/types/timelock_supply";
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
  private program: Program<TimelockSupply>;

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

  constructor(program: Program<TimelockSupply>) {
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
}

describe("timelock_supply", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.TimelockSupply as Program<TimelockSupply>;

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
            systemProgram: anchor.web3.SystemProgram.programId,
          })
          .signers([user1])
          .rpc();
        expect.fail("Should have thrown error");
      } catch (err: any) {
        expect(err.error?.errorCode?.code).to.equal("TimestampInPast");
      }
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
      
      // Should have 7 locks
      console.log(`User3 total locks: ${user3Locks.length}`);
      expect(user3Locks.length).to.equal(7);
      
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
      expect(locks.length).to.equal(8);
      
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
      const activeLocks = await lockFetcher.fetchActive();
      const soonLocks = lockFetcher.filterUnlockingSoon(activeLocks, 3 * 3600);
      
      console.log(`Locks unlocking within 3 hours: ${soonLocks.length}`);
      
      soonLocks.forEach(lock => {
        const ts = lock.account.unlockTimestamp.toNumber();
        expect(ts).to.be.gte(now);
        expect(ts).to.be.lte(now + 3 * 3600);
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
});
