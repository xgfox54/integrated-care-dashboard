import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

// The public edition verifies the pinned manifest and ciphertext without the
// original packs or a decryption key. It does not claim plaintext validation.
const args = process.argv.slice(2);
if (args.some((arg) => arg !== "--built")) throw new Error("Only --built is accepted");
const manifest = JSON.parse(readFileSync("data/manual-corpus/manifest.json", "utf8"));
const index = JSON.parse(readFileSync("data/manual-corpus/encrypted-assets.json", "utf8"));
const requireValid = (condition, message) => { if (!condition) throw new Error(message); };
requireValid(index.schema_version === "manual-assets-aes-gcm-1" && index.algorithm === "AES-256-GCM" && index.compression === "gzip", "Invalid envelope schema");
requireValid(index.revision === manifest.revision && /^[0-9a-f]{24}$/.test(index.key_id), "Invalid envelope identity");
requireValid(index.batches.length === manifest.batches.length && index.batches.length > 0, "Invalid batch count");
const directories = ["public", ...(args.includes("--built") ? ["dist/client"] : [])];
for (const directory of directories) requireValid(!existsSync(join(directory, "__manual_corpus")), "Plaintext packs must not be public assets");
for (let i = 0; i < index.batches.length; i++) {
  const source = manifest.batches[i];
  const entry = index.batches[i];
  const expectedLogical = `/__manual_corpus/${manifest.revision}/batch-${String(i).padStart(4, "0")}.json`;
  const expectedCipher = `/__manual_cipher/${manifest.revision}/${index.key_id}/batch-${String(i).padStart(4, "0")}.bin`;
  requireValid(source.path === expectedLogical && entry.logical_path === source.path && entry.asset_path === expectedCipher, "Unexpected batch path");
  requireValid(entry.plaintext_sha256 === source.sha256 && entry.plaintext_bytes === source.bytes, "Manifest mismatch");
  for (const directory of directories) {
    const root = resolve(directory);
    const file = resolve(root, `.${entry.asset_path}`);
    requireValid(file.startsWith(root + "/") || file.startsWith(root + "\\"), "Asset escapes root");
    const bytes = readFileSync(file);
    requireValid(bytes.length === entry.bytes && bytes.subarray(0, 8).toString("ascii") === "MCPGCM01", "Invalid ciphertext envelope");
    requireValid(createHash("sha256").update(bytes).digest("hex") === entry.sha256, "Ciphertext hash mismatch");
  }
}
console.log(JSON.stringify({ check: "PUBLIC_CIPHERTEXT_MANIFEST_VERIFIED", batches: index.batches.length, plaintext_validation: "NOT_INCLUDED_IN_PUBLIC_EDITION", plaintext_public_files: 0, built: args.includes("--built") }));
