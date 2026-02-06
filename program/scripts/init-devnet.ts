/**
 * Script to initialize the B3drok program on devnet and write the first message
 * Run with: npx ts-node scripts/init-devnet.ts
 */

import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { B3drok } from "../target/types/b3drok";
import { PublicKey, Connection, clusterApiUrl } from "@solana/web3.js";

async function main() {
  // Setup provider for devnet
  const connection = new Connection(clusterApiUrl("devnet"), "confirmed");
  const wallet = anchor.Wallet.local();
  const provider = new anchor.AnchorProvider(connection, wallet, {
    commitment: "confirmed",
  });
  anchor.setProvider(provider);

  const program = anchor.workspace.B3drok as Program<B3drok>;

  console.log("=".repeat(60));
  console.log("B3DROK DEVNET INITIALIZATION");
  console.log("=".repeat(60));
  console.log("Program ID:", program.programId.toString());
  console.log("Wallet:", wallet.publicKey.toString());

  // Check balance
  const balance = await connection.getBalance(wallet.publicKey);
  console.log("Balance:", balance / 1e9, "SOL");

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
    console.log("\n🚀 Initializing program...");
    
    const tx = await program.methods
      .initialize()
      .accounts({
        globalState: globalStatePda,
        authority: wallet.publicKey,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .rpc();

    console.log("✅ Initialized! Tx:", tx);
    
    // Wait for confirmation
    await connection.confirmTransaction(tx, "confirmed");
    
    const globalState = await program.account.globalState.fetch(globalStatePda);
    console.log("Counter:", globalState.counter.toNumber());
    console.log("Authority:", globalState.authority.toString());
  }

  // Check current counter
  const globalState = await program.account.globalState.fetch(globalStatePda);
  
  if (globalState.counter.toNumber() === 0) {
    console.log("\n📝 Writing first message 'Hello World'...");
    
    const messageId = globalState.counter;
    const [messagePda] = PublicKey.findProgramAddressSync(
      [Buffer.from("message"), messageId.toArrayLike(Buffer, "le", 8)],
      program.programId
    );
    
    const tx = await program.methods
      .write("Hello World! 🌍 This is the first message on B3DROK.", null)
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
  console.log("🎉 DONE! Program is ready on devnet.");
  console.log("=".repeat(60));
}

main().catch(console.error);











