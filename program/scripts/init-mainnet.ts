/**
 * Script to initialize the Redrok program on MAINNET and write the first message
 * Run with: npx ts-node scripts/init-mainnet.ts
 * 
 * ⚠️  WARNING: This will execute on MAINNET and cost real SOL!
 */

import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { Redrok } from "../target/types/redrok";
import { PublicKey, Connection } from "@solana/web3.js";

const MAINNET_RPC = "https://api.mainnet-beta.solana.com";

async function main() {
  // Setup provider for mainnet
  const connection = new Connection(MAINNET_RPC, "confirmed");
  const wallet = anchor.Wallet.local();
  const provider = new anchor.AnchorProvider(connection, wallet, {
    commitment: "confirmed",
  });
  anchor.setProvider(provider);

  const program = anchor.workspace.Redrok as Program<Redrok>;

  console.log("=".repeat(60));
  console.log("🔴 REDROK MAINNET INITIALIZATION");
  console.log("=".repeat(60));
  console.log("⚠️  WARNING: This is MAINNET - real SOL will be spent!");
  console.log("Program ID:", program.programId.toString());
  console.log("Wallet:", wallet.publicKey.toString());

  // Check balance
  const balance = await connection.getBalance(wallet.publicKey);
  console.log("Balance:", balance / 1e9, "SOL");

  if (balance < 0.01 * 1e9) {
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
    const globalState = await program.account.globalState.fetch(globalStatePda);
    console.log("Counter:", globalState.counter.toNumber());
    console.log("Authority:", globalState.authority.toString());
  } else {
    console.log("\n🚀 Initializing program on MAINNET...");
    
    const tx = await program.methods
      .initialize()
      .accounts({
        globalState: globalStatePda,
        authority: wallet.publicKey,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .rpc();

    console.log("✅ Initialized! Tx:", tx);
    console.log(`🔗 https://solscan.io/tx/${tx}`);
    
    // Wait for confirmation
    await connection.confirmTransaction(tx, "confirmed");
    
    const globalState = await program.account.globalState.fetch(globalStatePda);
    console.log("Counter:", globalState.counter.toNumber());
    console.log("Authority:", globalState.authority.toString());
  }

  // Check current counter
  const globalState = await program.account.globalState.fetch(globalStatePda);
  
  if (globalState.counter.toNumber() === 0) {
    console.log("\n📝 Writing first message 'Hello Red World!'...");
    
    const messageId = globalState.counter;
    const [messagePda] = PublicKey.findProgramAddressSync(
      [Buffer.from("message"), messageId.toArrayLike(Buffer, "le", 8)],
      program.programId
    );
    
    const tx = await program.methods
      .write("Hello Red World! 🔴", null)
      .accounts({
        globalState: globalStatePda,
        message: messagePda,
        parentMessage: null,
        parentWriter: null,
        writer: wallet.publicKey,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .rpc();

    console.log("✅ First message written! Tx:", tx);
    console.log(`🔗 https://solscan.io/tx/${tx}`);
    
    // Wait for confirmation
    await connection.confirmTransaction(tx, "confirmed");
    
    const message = await program.account.message.fetch(messagePda);
    console.log("\n📄 Message #0:");
    console.log("  ID:", message.id.toNumber());
    console.log("  Content:", message.content);
    console.log("  Writer:", message.writer.toString());
    console.log("  Timestamp:", new Date(message.timestamp.toNumber() * 1000).toISOString());
  } else {
    console.log("\n✅ First message already exists!");
    
    const [messagePda] = PublicKey.findProgramAddressSync(
      [Buffer.from("message"), Buffer.alloc(8)], // id = 0
      program.programId
    );
    
    const message = await program.account.message.fetch(messagePda);
    console.log("\n📄 Message #0:");
    console.log("  ID:", message.id.toNumber());
    console.log("  Content:", message.content);
    console.log("  Writer:", message.writer.toString());
    console.log("  Timestamp:", new Date(message.timestamp.toNumber() * 1000).toISOString());
  }

  console.log("\n" + "=".repeat(60));
  console.log("🎉 DONE! REDROK is live on MAINNET!");
  console.log("=".repeat(60));
}

main().catch(console.error);


