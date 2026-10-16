#!/usr/bin/env node
// Public hosting serves ciphertext only. The key is supplied on hidden stdin and
// stored separately as a Sites runtime secret; it is never written by this tool.
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve, join } from "node:path";
import { createInterface } from "node:readline";
import { gzipSync, gunzipSync } from "node:zlib";

const args = process.argv.slice(2);
if (args.some((arg) => !["--verify", "--built", "--runtime"].includes(arg))) throw new Error("Only --verify, --built and --runtime are accepted. Secrets belong on stdin.");
if (args.includes("--runtime") && (args.includes("--verify") || args.includes("--built"))) throw new Error("RUNTIME_AND_VERIFY_MODES_ARE_EXCLUSIVE");
if (args.includes("--built") && !args.includes("--verify")) throw new Error("BUILT_REQUIRES_VERIFY");
const root = process.cwd();
const source = JSON.parse(readFileSync(join(root, "data/manual-corpus/manifest.json"), "utf8"));
const output = join(root, "data/manual-corpus/encrypted-assets.json");
const magic = Buffer.from("MCPGCM01", "ascii");
const sha = (value) => createHash("sha256").update(value).digest("hex");
const fail = (ok, code) => { if (!ok) throw new Error(code); };
const sourcePath = (path) => join(root, "data/manual-corpus/assets", path);
const aad = (batch) => Buffer.from("manual-corpus-1\0" + source.revision + "\0" + batch.path + "\0" + batch.sha256, "utf8");

function validateLogicalPath(batch) {
  fail(batch.path.startsWith("/__manual_corpus/" + source.revision + "/") && /\/batch-\d{4}\.json$/.test(batch.path) && !batch.path.includes(".."), "UNSAFE_LOGICAL_PATH");
}

function validatePublicAbsence(directory) {
  fail(!existsSync(join(directory, "__manual_corpus")), "PLAINTEXT_MANUALS_MUST_NOT_BE_PUBLIC");
}

function checkEnvelopeIndex(index) {
  fail(index.schema_version === "manual-assets-aes-gcm-1" && index.algorithm === "AES-256-GCM" && index.compression === "gzip", "ENVELOPE_SCHEMA_MISMATCH");
  fail(index.revision === source.revision && /^[0-9a-f]{24}$/.test(index.key_id), "ENVELOPE_REVISION_MISMATCH");
  fail(index.batches.length === source.batches.length, "ENVELOPE_BATCH_COUNT_MISMATCH");
  for (let i = 0; i < source.batches.length; i++) {
    const batch = source.batches[i], entry = index.batches[i];
    validateLogicalPath(batch);
    fail(entry.logical_path === batch.path && entry.plaintext_sha256 === batch.sha256 && entry.plaintext_bytes === batch.bytes, "ENVELOPE_SOURCE_MISMATCH");
    const expected = "/__manual_cipher/" + source.revision + "/" + index.key_id + "/batch-" + String(i).padStart(4, "0") + ".bin";
    fail(entry.asset_path === expected, "ENVELOPE_PATH_MISMATCH");
    const original = readFileSync(sourcePath(batch.path));
    fail(original.length === batch.bytes && sha(original) === batch.sha256, "SOURCE_HASH_MISMATCH");
    for (const directory of [join(root, "public"), ...(args.includes("--built") ? [join(root, "dist/client")] : [])]) {
      validatePublicAbsence(directory);
      const bytes = readFileSync(join(directory, entry.asset_path));
      fail(bytes.length === entry.bytes && sha(bytes) === entry.sha256 && bytes.subarray(0, 8).equals(magic), "CIPHERTEXT_HASH_MISMATCH");
    }
  }
}

async function hiddenKey() {
  let previous;
  if (process.stdin.isTTY) {
    previous = execFileSync("stty", ["-g"], { stdio: ["inherit", "pipe", "ignore"], encoding: "utf8" }).trim();
    execFileSync("stty", ["-echo"], { stdio: ["inherit", "ignore", "ignore"] });
  }
  process.stdout.write("Ready for manual asset key JSON on hidden stdin.\n");
  try {
    const input = createInterface({ input: process.stdin, crlfDelay: Infinity });
    const line = await new Promise((accept, reject) => {
      input.once("line", accept);
      input.once("error", reject);
      input.once("close", () => reject(new Error("KEY_INPUT_CLOSED")));
    });
    input.close();
    let data;
    try { data = JSON.parse(line); } catch { throw new Error("KEY_INPUT_INVALID"); }
    const value = data?.key;
    fail(typeof value === "string" && /^[A-Za-z0-9+/]{43}=$/.test(value), "KEY_FORMAT_INVALID");
    const key = Buffer.from(value, "base64");
    fail(key.length === 32 && key.toString("base64") === value, "KEY_FORMAT_INVALID");
    return key;
  } finally {
    if (previous) execFileSync("stty", [previous], { stdio: ["inherit", "ignore", "ignore"] });
  }
}

validatePublicAbsence(join(root, "public"));
if (args.includes("--verify")) {
  const index = JSON.parse(readFileSync(output, "utf8"));
  checkEnvelopeIndex(index);
  console.log(JSON.stringify({ check: "ENCRYPTED_MANUAL_ASSETS_VERIFIED", batches: index.batches.length, plaintext_public_files: 0, built: args.includes("--built") }));
} else {
  const key = await hiddenKey();
  const keyId = sha(key).slice(0, 24);
  let index;
  if (existsSync(output)) {
    index = JSON.parse(readFileSync(output, "utf8"));
    fail(index.key_id === keyId, "EXISTING_ENVELOPE_KEY_MISMATCH");
    checkEnvelopeIndex(index);
  } else {
    index = { schema_version: "manual-assets-aes-gcm-1", revision: source.revision, algorithm: "AES-256-GCM", compression: "gzip", key_id: keyId, batches: [] };
    const nonces = new Set();
    for (let i = 0; i < source.batches.length; i++) {
      const batch = source.batches[i];
      validateLogicalPath(batch);
      const original = readFileSync(sourcePath(batch.path));
      fail(original.length === batch.bytes && sha(original) === batch.sha256, "SOURCE_HASH_MISMATCH");
      const packed = gzipSync(original, { level: 9 });
      const nonce = randomBytes(12), nonceId = nonce.toString("hex");
      fail(!nonces.has(nonceId), "NONCE_COLLISION");
      nonces.add(nonceId);
      const cipher = createCipheriv("aes-256-gcm", key, nonce, { authTagLength: 16 });
      cipher.setAAD(aad(batch));
      const bytes = Buffer.concat([magic, nonce, cipher.update(packed), cipher.final(), cipher.getAuthTag()]);
      const assetPath = "/__manual_cipher/" + source.revision + "/" + keyId + "/batch-" + String(i).padStart(4, "0") + ".bin";
      const target = join(root, "public", assetPath);
      mkdirSync(resolve(target, ".."), { recursive: true });
      fail(!existsSync(target), "ENVELOPE_TARGET_ALREADY_EXISTS");
      writeFileSync(target, bytes, { flag: "wx" });
      index.batches.push({ logical_path: batch.path, asset_path: assetPath, sha256: sha(bytes), bytes: bytes.length, plaintext_sha256: batch.sha256, plaintext_bytes: batch.bytes });
    }
  }
  // An independent Node decrypt + bounded decompression checks every produced
  // envelope. Runtime Web Crypto and invalid-envelope cases have separate tests.
  let compressedBytes = 0;
  for (let i = 0; i < source.batches.length; i++) {
    const batch = source.batches[i], entry = index.batches[i];
    const bytes = readFileSync(join(root, "public", entry.asset_path));
    const decrypt = createDecipheriv("aes-256-gcm", key, bytes.subarray(8, 20), { authTagLength: 16 });
    decrypt.setAAD(aad(batch));
    decrypt.setAuthTag(bytes.subarray(bytes.length - 16));
    const packed = Buffer.concat([decrypt.update(bytes.subarray(20, bytes.length - 16)), decrypt.final()]);
    compressedBytes += packed.length;
    const original = gunzipSync(packed, { maxOutputLength: 1_048_576 });
    fail(original.length === batch.bytes && sha(original) === batch.sha256, "DECRYPTED_SOURCE_MISMATCH");
  }
  let runtimeVerified = null;
  if (args.includes("--runtime")) {
    const { createEncryptedManualAssetLoader } = await import("../../lib/manuals/assets.ts");
    const allowed = new Set(index.batches.map((entry) => entry.asset_path));
    const assets = { fetch: async (request) => {
      const path = new URL(typeof request === "string" ? request : request.url).pathname;
      fail(allowed.has(path), "UNEXPECTED_RUNTIME_ASSET_PATH");
      return new Response(readFileSync(join(root, "public", path)));
    } };
    const loader = await createEncryptedManualAssetLoader(assets, key.toString("base64"), source, index);
    runtimeVerified = 0;
    for (const batch of source.batches) {
      const original = await loader(batch.path, new AbortController().signal);
      fail(original.length === batch.bytes && sha(original) === batch.sha256, "RUNTIME_DECRYPTED_SOURCE_MISMATCH");
      runtimeVerified++;
    }
  }
  key.fill(0);
  writeFileSync(output, JSON.stringify(index, null, 2) + "\n");
  checkEnvelopeIndex(index);
  const audit = { checked_at: new Date().toISOString(), revision: source.revision, key_id: keyId, algorithm: index.algorithm, compression: index.compression, batches: index.batches.length, plaintext_bytes: source.batches.reduce((sum, row) => sum + row.bytes, 0), compressed_bytes: compressedBytes, ciphertext_bytes: index.batches.reduce((sum, row) => sum + row.bytes, 0), decrypted_hashes_verified: index.batches.length, runtime_decrypted_hashes_verified: runtimeVerified, plaintext_public_files: 0, secret_storage: "SITES_RUNTIME_SECRET_ONLY", index_sha256: sha(readFileSync(output)) };
  audit.runtime_engine = runtimeVerified === null ? null : "Node.js WebCrypto (Worker loader source; not workerd)";
  audit.runtime_engine_version = runtimeVerified === null ? null : process.version;
  audit.runtime_loader_sha256 = runtimeVerified === null ? null : sha(readFileSync(join(root, "lib/manuals/assets.ts")));
  const auditPath = join(root, "docs/qa/manual-corpus-runtime-20261010/asset-envelope-audit.json");
  mkdirSync(resolve(auditPath, ".."), { recursive: true });
  writeFileSync(auditPath, JSON.stringify(audit, null, 2) + "\n");
  console.log(JSON.stringify(audit));
}
