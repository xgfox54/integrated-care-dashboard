// Server-only transport for the deployment-pinned corpus. This module never
// accepts an HTTP response destination and never returns a key or a Response.
import { MANUAL_ASSET_PREFIX, MANUAL_CORPUS_SCHEMA, type ManualAssetLoader, type ManualCorpusManifest } from "./types.ts";

export interface EncryptedManualAssetDescriptor {
  readonly logical_path: string;
  readonly asset_path: string;
  readonly sha256: string;
  readonly bytes: number;
  readonly plaintext_sha256: string;
  readonly plaintext_bytes: number;
}

export interface EncryptedManualAssetsManifest {
  readonly schema_version: "manual-assets-aes-gcm-1";
  readonly revision: string;
  readonly algorithm: "AES-256-GCM";
  readonly compression: "gzip";
  readonly key_id: string;
  readonly batches: readonly EncryptedManualAssetDescriptor[];
}

export interface ManualAssetsFetcher {
  fetch(request: Request): Promise<Response>;
}

const MAX_PLAINTEXT_BYTES = 1024 * 1024;
// A gzip stream can be slightly larger than an incompressible input.
const MAX_CIPHERTEXT_BYTES = MAX_PLAINTEXT_BYTES + 65_536;
const MAGIC = new TextEncoder().encode("MCPGCM01");
const HEADER_BYTES = MAGIC.byteLength + 12;
const TAG_BYTES = 16;
const HASH = /^[a-f0-9]{64}$/;
const encoder = new TextEncoder();

class ManualAssetError extends Error {
  constructor(code: string) { super(code); this.name = "ManualAssetError"; }
}

function requireValue(value: unknown, code: string): asserts value {
  if (!value) throw new ManualAssetError(code);
}

function checkAbort(signal?: AbortSignal): void {
  if (signal?.aborted) throw new ManualAssetError("MANUAL_ASSET_ABORTED");
}

async function sha256(bytes: Uint8Array<ArrayBuffer>): Promise<string> {
  return [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function descriptors(manual: ManualCorpusManifest, encrypted: EncryptedManualAssetsManifest): Map<string, EncryptedManualAssetDescriptor> {
  requireValue(manual?.schema_version === MANUAL_CORPUS_SCHEMA && /^[a-z0-9][a-z0-9._-]{0,99}$/.test(manual.revision), "MANUAL_ENCRYPTED_MANIFEST_INVALID");
  requireValue(encrypted?.schema_version === "manual-assets-aes-gcm-1" && encrypted.revision === manual.revision &&
    encrypted.algorithm === "AES-256-GCM" && encrypted.compression === "gzip" && /^[a-f0-9]{24}$/.test(encrypted.key_id), "MANUAL_ENCRYPTED_MANIFEST_INVALID");
  requireValue(Array.isArray(manual.batches) && Array.isArray(encrypted.batches) && manual.batches.length > 0 &&
    manual.batches.length <= 10_000 && encrypted.batches.length === manual.batches.length, "MANUAL_ENCRYPTED_MANIFEST_INVALID");
  const result = new Map<string, EncryptedManualAssetDescriptor>();
  for (let index = 0; index < manual.batches.length; index++) {
    const plain = manual.batches[index];
    const cipher = encrypted.batches[index];
    requireValue(plain && cipher && typeof plain.path === "string" && plain.path.length <= 500 &&
      plain.path.startsWith(`${MANUAL_ASSET_PREFIX}${manual.revision}/`) && plain.path.endsWith(".json") &&
      !/[?#%\\\s\0]/.test(plain.path) && plain.path.slice(1).split("/").every((part: string) => part && part !== "." && part !== ".."), "MANUAL_ENCRYPTED_DESCRIPTOR_INVALID");
    requireValue(!result.has(plain.path) && cipher.logical_path === plain.path &&
      cipher.asset_path === `/__manual_cipher/${manual.revision}/${encrypted.key_id}/batch-${String(index).padStart(4, "0")}.bin` &&
      HASH.test(plain.sha256) && cipher.plaintext_sha256 === plain.sha256 && HASH.test(cipher.sha256) &&
      Number.isSafeInteger(plain.bytes) && plain.bytes > 0 && plain.bytes <= MAX_PLAINTEXT_BYTES &&
      cipher.plaintext_bytes === plain.bytes && Number.isSafeInteger(cipher.bytes) &&
      cipher.bytes > HEADER_BYTES + TAG_BYTES && cipher.bytes <= MAX_CIPHERTEXT_BYTES, "MANUAL_ENCRYPTED_DESCRIPTOR_INVALID");
    // Keep the checked mapping fixed even if a caller retains its input object.
    result.set(plain.path, Object.freeze({ ...cipher }));
  }
  return result;
}

async function importKey(keyBase64: string, keyId: string): Promise<CryptoKey> {
  requireValue(typeof keyBase64 === "string" && keyBase64.length > 0, "MANUAL_ASSET_KEY_MISSING");
  requireValue(/^[A-Za-z0-9+/]{43}=$/.test(keyBase64), "MANUAL_ASSET_KEY_INVALID");
  let binary: string;
  try { binary = atob(keyBase64); }
  catch { throw new ManualAssetError("MANUAL_ASSET_KEY_INVALID"); }
  requireValue(binary.length === 32 && btoa(binary) === keyBase64, "MANUAL_ASSET_KEY_INVALID");
  const raw = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  try {
    requireValue((await sha256(raw)).slice(0, 24) === keyId, "MANUAL_ASSET_KEY_ID_MISMATCH");
    return await crypto.subtle.importKey("raw", raw, { name: "AES-GCM", length: 256 }, false, ["decrypt"]);
  } catch (error) {
    if (error instanceof ManualAssetError) throw error;
    throw new ManualAssetError("MANUAL_ASSET_KEY_IMPORT_FAILED");
  } finally { raw.fill(0); }
}

/** Never accumulates bytes beyond the pinned length, including without Content-Length. */
async function readExact(stream: ReadableStream<Uint8Array> | null, expectedBytes: number, signal: AbortSignal | undefined,
  lengthError: string, streamError: string): Promise<Uint8Array<ArrayBuffer>> {
  checkAbort(signal);
  requireValue(stream, streamError);
  const reader = stream.getReader();
  const output = new Uint8Array(expectedBytes);
  let length = 0;
  const cancel = () => { void reader.cancel().catch(() => {}); };
  signal?.addEventListener("abort", cancel, { once: true });
  try {
    checkAbort(signal);
    for (;;) {
      const { done, value } = await reader.read();
      checkAbort(signal);
      if (done) break;
      requireValue(value instanceof Uint8Array && length + value.byteLength <= expectedBytes, lengthError);
      output.set(value, length);
      length += value.byteLength;
    }
    requireValue(length === expectedBytes, lengthError);
    return output;
  } catch (error) {
    cancel();
    checkAbort(signal);
    if (error instanceof ManualAssetError) throw error;
    throw new ManualAssetError(streamError);
  } finally {
    signal?.removeEventListener("abort", cancel);
    reader.releaseLock();
  }
}

/**
 * Both manifests are compiled server input. Only their one-to-one, same-revision
 * mapping can be loaded; an arbitrary URL or a plaintext static fallback is never used.
 * The caller passes the resulting bytes to the existing hash-validating importer.
 */
export function createEncryptedManualAssetLoader(assetsFetcher: ManualAssetsFetcher, keyBase64: string,
  manualManifest: ManualCorpusManifest, encryptedManifest: EncryptedManualAssetsManifest): ManualAssetLoader {
  const byPath = descriptors(manualManifest, encryptedManifest);
  const revision = encryptedManifest.revision;
  const keyId = encryptedManifest.key_id;
  let key: Promise<CryptoKey> | undefined;
  return async (path, signal) => {
    let unexpectedCode = "MANUAL_ENCRYPTED_ASSET_READ_FAILED";
    try {
      checkAbort(signal);
      const descriptor = byPath.get(path);
      requireValue(descriptor, "MANUAL_ENCRYPTED_ASSET_NOT_LISTED");
      const cryptoKey = await (key ??= importKey(keyBase64, keyId));
      checkAbort(signal);
      unexpectedCode = "MANUAL_ENCRYPTED_ASSET_REQUEST_FAILED";
      // workerd supports manual/follow redirect modes. Keep redirects visible
      // here so the status check rejects them without fetching another URL.
      const request = new Request("https://manual-assets.internal" + descriptor.asset_path, { signal, redirect: "manual" });
      unexpectedCode = "MANUAL_ENCRYPTED_ASSET_FETCH_FAILED";
      const response = await assetsFetcher.fetch(request);
      unexpectedCode = "MANUAL_ENCRYPTED_ASSET_READ_INIT_FAILED";
      if (response.status !== 200 || response.redirected) {
        void response.body?.cancel().catch(() => {});
        throw new ManualAssetError("MANUAL_ENCRYPTED_ASSET_HTTP_ERROR");
      }
      const ciphertext = await readExact(response.body, descriptor.bytes, signal, "MANUAL_ENCRYPTED_ASSET_SIZE_MISMATCH", "MANUAL_ENCRYPTED_ASSET_READ_FAILED");
      unexpectedCode = "MANUAL_ENCRYPTED_ASSET_DIGEST_FAILED";
      requireValue(await sha256(ciphertext) === descriptor.sha256, "MANUAL_ENCRYPTED_ASSET_HASH_MISMATCH");
      requireValue(MAGIC.every((byte, index) => ciphertext[index] === byte), "MANUAL_ENCRYPTED_ASSET_HEADER_INVALID");
      checkAbort(signal);
      const aad = encoder.encode(`${MANUAL_CORPUS_SCHEMA}\0${revision}\0${descriptor.logical_path}\0${descriptor.plaintext_sha256}`);
      let compressed: ArrayBuffer;
      try {
        compressed = await crypto.subtle.decrypt({ name: "AES-GCM", iv: ciphertext.subarray(MAGIC.byteLength, HEADER_BYTES),
          additionalData: aad, tagLength: 128 }, cryptoKey, ciphertext.subarray(HEADER_BYTES));
      } catch { throw new ManualAssetError("MANUAL_ENCRYPTED_ASSET_AUTH_FAILED"); }
      checkAbort(signal);
      unexpectedCode = "MANUAL_ASSET_GZIP_INIT_FAILED";
      const stream = new Blob([compressed]).stream().pipeThrough(new DecompressionStream("gzip"));
      unexpectedCode = "MANUAL_ENCRYPTED_ASSET_READ_INIT_FAILED";
      const plaintext = await readExact(stream, descriptor.plaintext_bytes, signal, "MANUAL_ASSET_PLAINTEXT_SIZE_MISMATCH", "MANUAL_ASSET_GZIP_INVALID");
      unexpectedCode = "MANUAL_ENCRYPTED_ASSET_DIGEST_FAILED";
      requireValue(await sha256(plaintext) === descriptor.plaintext_sha256, "MANUAL_ASSET_PLAINTEXT_HASH_MISMATCH");
      checkAbort(signal);
      return plaintext;
    } catch (error) {
      checkAbort(signal);
      if (error instanceof ManualAssetError) throw error;
      // Fetch/stream/crypto errors can contain implementation details or request data.
      throw new ManualAssetError(unexpectedCode);
    }
  };
}
