/**
 * Convert a Solana private key JSON file to base58 format
 * Usage: node script/json-to-base58.js <PATH_TO_JSON_FILE>
 * 
 * The JSON file should contain an array of numbers (bytes) representing the private key
 * Example: [84,6,14,137,120,139,225,154,231,165,219,27,...]
 */

import bs58 from "bs58";
import { readFileSync } from "fs";
import { resolve } from "path";

const jsonFilePath = process.argv[2];

if (!jsonFilePath) {
  console.error("❌ Usage: node script/json-to-base58.js <PATH_TO_JSON_FILE>");
  console.error("   Example: node script/json-to-base58.js ../program/test.json");
  process.exit(1);
}

try {
  // Resolve the file path (supports relative and absolute paths)
  const resolvedPath = resolve(jsonFilePath);
  
  // Read and parse the JSON file
  const fileContent = readFileSync(resolvedPath, "utf-8");
  const keyArray = JSON.parse(fileContent);
  
  // Validate that it's an array
  if (!Array.isArray(keyArray)) {
    console.error("❌ Invalid JSON format: expected an array of numbers");
    process.exit(1);
  }
  
  // Validate array length (should be 32 or 64 bytes for Solana keys)
  if (keyArray.length !== 32 && keyArray.length !== 64) {
    console.warn(`⚠️  Warning: Expected 32 or 64 bytes, got ${keyArray.length} bytes`);
  }
  
  // Validate that all elements are numbers
  if (!keyArray.every((byte) => typeof byte === "number" && byte >= 0 && byte <= 255)) {
    console.error("❌ Invalid array: all elements must be numbers between 0 and 255");
    process.exit(1);
  }
  
  // Convert array to Uint8Array
  const keyBytes = new Uint8Array(keyArray);
  
  // Convert to base58
  const base58Key = bs58.encode(keyBytes);
  
  // Display the result
  console.log("\n✅ Base58 private key:\n");
  console.log(base58Key);
  console.log("");
  
} catch (error) {
  if (error.code === "ENOENT") {
    console.error(`❌ File not found: ${jsonFilePath}`);
  } else if (error instanceof SyntaxError) {
    console.error(`❌ Invalid JSON format: ${error.message}`);
  } else {
    console.error(`❌ Error: ${error.message}`);
  }
  process.exit(1);
}
