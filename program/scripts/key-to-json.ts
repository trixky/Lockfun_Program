/**
 * Convert a base58 private key to JSON array format for Solana CLI
 * Usage: npm run key-to-json <BASE58_PRIVATE_KEY>
 * 
 * Supports both:
 * - 32 bytes (seed only, from Phantom/Solflare export)
 * - 64 bytes (full keypair)
 */

import bs58 from "bs58";
import { Keypair } from "@solana/web3.js";

const privateKeyBase58 = process.argv[2];

if (!privateKeyBase58) {
  console.error("❌ Usage: npm run key-to-json <BASE58_PRIVATE_KEY>");
  console.error("   Example: npm run key-to-json 5abc123...");
  process.exit(1);
}

try {
  const keyBytes = bs58.decode(privateKeyBase58);
  
  let keypair: Keypair;
  
  if (keyBytes.length === 32) {
    // 32 bytes = seed only (from Phantom/Solflare)
    // Generate full keypair from seed
    keypair = Keypair.fromSeed(keyBytes);
    console.log("\n🔑 Detected 32-byte seed (Phantom/Solflare format)");
  } else if (keyBytes.length === 64) {
    // 64 bytes = full keypair
    keypair = Keypair.fromSecretKey(keyBytes);
    console.log("\n🔑 Detected 64-byte full keypair");
  } else {
    console.error(`❌ Invalid key length: ${keyBytes.length} bytes (expected 32 or 64)`);
    process.exit(1);
  }
  
  const jsonArray = JSON.stringify(Array.from(keypair.secretKey));
  
  console.log("📍 Public address:", keypair.publicKey.toBase58());
  console.log("\n✅ JSON array format for id.json:\n");
  console.log(jsonArray);
  console.log("\n📋 To save directly to id.json, run:");
  console.log(`echo '${jsonArray}' > ~/.config/solana/id.json`);
  console.log("");
} catch (error) {
  console.error("❌ Invalid base58 key:", (error as Error).message);
  process.exit(1);
}
