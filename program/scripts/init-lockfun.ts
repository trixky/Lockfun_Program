/**
 * Script to initialize the Lockfun program
 * Usage:
 *   Devnet:  npx ts-node scripts/init-lockfun.ts devnet
 *   Mainnet: npx ts-node scripts/init-lockfun.ts mainnet
 *   Local:   npx ts-node scripts/init-lockfun.ts localnet
 */

import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { Lockfun } from "../target/types/lockfun";
import { PublicKey, Connection, clusterApiUrl, Keypair } from "@solana/web3.js";
import * as fs from "fs";
import * as path from "path";
import { homedir } from "os";

const MAINNET_RPC = "https://api.mainnet-beta.solana.com";

// Load wallet from Solana config file
function loadWallet(): anchor.Wallet {
  const walletPath = process.env.ANCHOR_WALLET || path.join(homedir(), ".config", "solana", "id.json");
  
  if (!fs.existsSync(walletPath)) {
    throw new Error(`Wallet file not found: ${walletPath}\nSet ANCHOR_WALLET environment variable or ensure ~/.config/solana/id.json exists`);
  }
  
  const keypair = Keypair.fromSecretKey(
    Buffer.from(JSON.parse(fs.readFileSync(walletPath, "utf-8")))
  );
  
  return {
    publicKey: keypair.publicKey,
    signTransaction: async (tx: any) => {
      tx.sign(keypair);
      return tx;
    },
    signAllTransactions: async (txs: any[]) => {
      return txs.map((tx) => {
        tx.sign(keypair);
        return tx;
      });
    },
  };
}

async function main() {
  const cluster = process.argv[2] || "devnet";
  
  // Setup provider based on cluster
  let connection: Connection;
  let rpcUrl: string;
  
  if (cluster === "mainnet") {
    rpcUrl = MAINNET_RPC;
    connection = new Connection(rpcUrl, "confirmed");
  } else if (cluster === "localnet") {
    rpcUrl = "http://localhost:8899";
    connection = new Connection(rpcUrl, "confirmed");
  } else {
    rpcUrl = clusterApiUrl("devnet");
    connection = new Connection(rpcUrl, "confirmed");
  }
  
  const wallet = loadWallet();
  const provider = new anchor.AnchorProvider(connection, wallet, {
    commitment: "confirmed",
  });
  anchor.setProvider(provider);

  const program = anchor.workspace.Lockfun as Program<Lockfun>;

  console.log("=".repeat(60));
  console.log("🔒 LOCKFUN INITIALIZATION");
  console.log("=".repeat(60));
  console.log("Cluster:", cluster.toUpperCase());
  console.log("RPC:", rpcUrl);
  console.log("Program ID:", program.programId.toString());
  console.log("Wallet:", wallet.publicKey.toString());

  // Check balance
  const balance = await connection.getBalance(wallet.publicKey);
  console.log("Balance:", balance / 1e9, "SOL");

  if (cluster === "mainnet" && balance < 0.01 * 1e9) {
    console.error("❌ Insufficient balance! Need at least 0.01 SOL");
    process.exit(1);
  }

  // Derive GlobalState PDA
  const [globalStatePda] = PublicKey.findProgramAddressSync(
    [Buffer.from("global_state")],
    program.programId
  );
  console.log("GlobalState PDA:", globalStatePda.toString());

  // Check if already initialized
  const globalStateAccount = await connection.getAccountInfo(globalStatePda);
  
  if (globalStateAccount) {
    console.log("\n⚠️  Program already initialized!");
    try {
      const globalState = await program.account.globalState.fetch(globalStatePda);
      console.log("Lock Counter:", globalState.lockCounter.toNumber());
      console.log("Authority:", globalState.authority.toString());
      console.log("\n✅ GlobalState is ready!");
    } catch (error) {
      console.error("❌ Error fetching GlobalState:", error);
      process.exit(1);
    }
  } else {
    console.log("\n🚀 Initializing program...");
    
    try {
      const tx = await program.methods
        .initialize()
        .accounts({
          globalState: globalStatePda,
          authority: wallet.publicKey,
          systemProgram: anchor.web3.SystemProgram.programId,
        })
        .rpc();

      console.log("✅ Initialized! Transaction:", tx);
      
      if (cluster === "mainnet") {
        console.log(`🔗 https://solscan.io/tx/${tx}`);
      } else if (cluster === "devnet") {
        console.log(`🔗 https://solscan.io/tx/${tx}?cluster=devnet`);
      }
      
      // Wait for confirmation
      await connection.confirmTransaction(tx, "confirmed");
      
      const globalState = await program.account.globalState.fetch(globalStatePda);
      console.log("\n📊 GlobalState created:");
      console.log("  Lock Counter:", globalState.lockCounter.toNumber());
      console.log("  Authority:", globalState.authority.toString());
      console.log("\n✅ Program initialized successfully!");
    } catch (error) {
      console.error("❌ Error initializing program:", error);
      process.exit(1);
    }
  }

  console.log("\n" + "=".repeat(60));
  console.log("🎉 DONE! Lockfun is ready on", cluster.toUpperCase());
  console.log("=".repeat(60));
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
