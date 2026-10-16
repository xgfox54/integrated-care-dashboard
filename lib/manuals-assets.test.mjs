import assert from "node:assert/strict";
import { createCipheriv, randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import { gzipSync } from "node:zlib";
import { createEncryptedManualAssetLoader } from "./manuals/assets.ts";
import { advanceManualCorpus, readableManualRevision } from "./manuals/store.ts";
import { activate, manualDatabase, NOW, pack, section, sha256 } from "./manuals-test-support.mjs";

const aadFor = (manifest, descriptor) => Buffer.from(`manual-corpus-1\0${manifest.revision}\0${descriptor.path}\0${descriptor.sha256}`);

// The producer uses Node crypto/zlib; the consumer uses WebCrypto and web streams.
function encrypt(compressed, rawKey, aad) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", rawKey, iv);
  cipher.setAAD(aad);
  return Buffer.concat([Buffer.from("MCPGCM01"), iv, cipher.update(compressed), cipher.final(), cipher.getAuthTag()]);
}

function seal(fixture, { rawKey = randomBytes(32), compressed, aad } = {}) {
  const keyId = sha256(rawKey).slice(0, 24);
  const assets = new Map();
  const batches = fixture.manifest.batches.map((batch, index) => {
    const assetPath = `/__manual_cipher/${fixture.manifest.revision}/${keyId}/batch-${String(index).padStart(4, "0")}.bin`;
    const bytes = encrypt(compressed ? compressed(batch, index) : gzipSync(fixture.assets.get(batch.path)), rawKey,
      aad ? aad(batch, index) : aadFor(fixture.manifest, batch));
    assets.set(assetPath, bytes);
    return { logical_path: batch.path, asset_path: assetPath, sha256: sha256(bytes), bytes: bytes.byteLength,
      plaintext_sha256: batch.sha256, plaintext_bytes: batch.bytes };
  });
  return { key: rawKey.toString("base64"), assets, manifest: { schema_version: "manual-assets-aes-gcm-1", revision: fixture.manifest.revision,
    algorithm: "AES-256-GCM", compression: "gzip", key_id: keyId, batches } };
}

function transport(sealed, responseFor) {
  const calls = [];
  return {
    calls,
    async fetch(request) {
      const url = new URL(request.url);
      assert.equal(url.origin, "https://manual-assets.internal");
      assert.equal(url.search, "");
      assert.equal(request.redirect, "manual");
      assert.ok(sealed.assets.has(url.pathname));
      calls.push(url.pathname);
      return responseFor ? responseFor(sealed.assets.get(url.pathname), request) : new Response(sealed.assets.get(url.pathname));
    },
  };
}

function loader(fixture, sealed, fetcher = transport(sealed)) {
  return createEncryptedManualAssetLoader(fetcher, sealed.key, fixture.manifest, sealed.manifest);
}

test("Node AES-GCM/gzip assets round-trip byte-identical Unicode, CRLF and table bodies through internal fetch only", async () => {
  const body = "한글 <table><tr><td>금액</td><td>🙂</td></tr></table>\r\n".repeat(1200);
  const fixture = pack({ sections: [section({ content: body })] });
  const sealed = seal(fixture);
  const fetcher = transport(sealed);
  const load = loader(fixture, sealed, fetcher);
  for (const batch of fixture.manifest.batches) {
    const result = await load(batch.path);
    assert.deepEqual(result, fixture.assets.get(batch.path));
    assert.equal(sha256(result), batch.sha256);
  }
  assert.deepEqual(fetcher.calls, sealed.manifest.batches.map((batch) => batch.asset_path));
  assert.ok(fetcher.calls.every((path) => !path.startsWith("/__manual_corpus/")));
});

test("changing to encrypted transport resumes the same pinned corpus cursor, IDs, source hashes and original manifest", async () => {
  const db = manualDatabase();
  try {
    const fixture = pack();
    const first = await advanceManualCorpus(db, fixture.load, fixture.manifest, { now: () => NOW });
    assert.equal(first.status, "ADVANCED");
    assert.equal(first.next_batch, 1);
    const sealed = seal(fixture);
    const fetcher = transport(sealed);
    const load = loader(fixture, sealed, fetcher);
    await activate(db, { ...fixture, load });
    assert.equal(fetcher.calls.length, 1);
    assert.equal(fetcher.calls[0], sealed.manifest.batches[1].asset_path);
    const state = await readableManualRevision(db);
    assert.equal(state.revision, fixture.manifest.revision);
    assert.equal(state.manifest_sha256, sha256(JSON.stringify(fixture.manifest)));
    const stored = db.sqlite.prepare("SELECT section_id, content, content_hash FROM manual_section").get();
    assert.equal(stored.section_id, "section-one");
    assert.equal(stored.content, section().content);
    assert.equal(stored.content_hash, section().content_hash);
    assert.equal(db.sqlite.prepare("SELECT COUNT(*) n FROM manual_corpus").get().n, 1);
  } finally { db.sqlite.close(); }
});

test("missing, malformed, noncanonical and wrong keys fail before fetching and expose no key value", async () => {
  const fixture = pack();
  const sealed = seal(fixture, { rawKey: Buffer.alloc(32, 0) });
  const noncanonical = "A".repeat(42) + "B=";
  const candidates = [undefined, "", "private value", " " + sealed.key, Buffer.alloc(31).toString("base64"),
    Buffer.alloc(33).toString("base64"), noncanonical, Buffer.alloc(32, 1).toString("base64")];
  for (const candidate of candidates) {
    const fetcher = transport(sealed);
    const load = createEncryptedManualAssetLoader(fetcher, candidate, fixture.manifest, sealed.manifest);
    await assert.rejects(load(fixture.manifest.batches[0].path), (error) => {
      assert.match(error.message, /^MANUAL_ASSET_KEY_(MISSING|INVALID|ID_MISMATCH)$/);
      if (candidate) assert.equal(error.message.includes(candidate), false);
      return true;
    });
    assert.equal(fetcher.calls.length, 0);
  }
});

test("encrypted manifest schema, version and every plaintext descriptor must match the original compiled manifest", () => {
  const fixture = pack();
  const sealed = seal(fixture);
  const changes = [
    (value) => { value.schema_version = "other"; },
    (value) => { value.revision = "other"; },
    (value) => { value.algorithm = "AES-128-GCM"; },
    (value) => { value.compression = "identity"; },
    (value) => { value.key_id = "not-a-key-id"; },
    (value) => { value.batches.pop(); },
    (value) => { value.batches[1].logical_path = value.batches[0].logical_path; },
    (value) => { value.batches[0].plaintext_sha256 = "a".repeat(64); },
    (value) => { value.batches[0].plaintext_bytes++; },
    (value) => { value.batches[0].asset_path = "https://example.test/data"; },
    (value) => { value.batches[0].asset_path = "/__manual_cipher/../private"; },
    (value) => { value.batches[0].bytes = 2 * 1024 * 1024; },
  ];
  for (const change of changes) {
    const edited = structuredClone(sealed.manifest);
    change(edited);
    assert.throws(() => createEncryptedManualAssetLoader(transport(sealed), sealed.key, fixture.manifest, edited),
      /^ManualAssetError: MANUAL_ENCRYPTED_(MANIFEST|DESCRIPTOR)_INVALID$/);
  }
  const oversized = structuredClone(fixture.manifest);
  const matching = structuredClone(sealed.manifest);
  oversized.batches[0].bytes = matching.batches[0].plaintext_bytes = 1024 * 1024 + 1;
  assert.throws(() => createEncryptedManualAssetLoader(transport(sealed), sealed.key, oversized, matching), /MANUAL_ENCRYPTED_DESCRIPTOR_INVALID/);
});

test("unlisted paths and URLs are rejected without network access or plaintext fallbacks", async () => {
  const fixture = pack();
  const sealed = seal(fixture);
  const fetcher = transport(sealed);
  const load = loader(fixture, sealed, fetcher);
  for (const path of ["https://example.test/file", "/__manual_corpus/other/batch-0.json", "/__manual_corpus/../secrets", sealed.manifest.batches[0].asset_path]) {
    await assert.rejects(load(path), /^ManualAssetError: MANUAL_ENCRYPTED_ASSET_NOT_LISTED$/);
  }
  assert.equal(fetcher.calls.length, 0);
});

test("ciphertext streaming stops at the pinned byte count despite absent or false Content-Length", async () => {
  const fixture = pack();
  const sealed = seal(fixture);
  for (const withLength of [false, true]) {
    let cancelled = false;
    const fetcher = transport(sealed, (bytes) => new Response(new ReadableStream({
      start(controller) { controller.enqueue(Buffer.concat([bytes, Buffer.alloc(1)])); },
      cancel() { cancelled = true; },
    }), { headers: withLength ? { "content-length": String(bytes.byteLength) } : {} }));
    await assert.rejects(loader(fixture, sealed, fetcher)(fixture.manifest.batches[0].path), /MANUAL_ENCRYPTED_ASSET_SIZE_MISMATCH/);
    assert.equal(cancelled, true);
  }
});

test("truncated ciphertext and ciphertext hash corruption fail before decrypting", async () => {
  const fixture = pack();
  const sealed = seal(fixture);
  const first = fixture.manifest.batches[0].path;
  await assert.rejects(loader(fixture, sealed, transport(sealed, (bytes) => new Response(bytes.subarray(0, -1))))(first), /MANUAL_ENCRYPTED_ASSET_SIZE_MISMATCH/);
  await assert.rejects(loader(fixture, sealed, transport(sealed, (bytes) => {
    const copy = Buffer.from(bytes); copy[copy.length - 1] ^= 1; return new Response(copy);
  }))(first), /MANUAL_ENCRYPTED_ASSET_HASH_MISMATCH/);
});

test("invalid envelope magic is rejected even with a matching ciphertext hash", async () => {
  const fixture = pack();
  const sealed = seal(fixture);
  const descriptor = sealed.manifest.batches[0];
  const bytes = Buffer.from(sealed.assets.get(descriptor.asset_path));
  bytes[0] ^= 1;
  sealed.assets.set(descriptor.asset_path, bytes);
  descriptor.sha256 = sha256(bytes);
  await assert.rejects(loader(fixture, sealed)(descriptor.logical_path), /MANUAL_ENCRYPTED_ASSET_HEADER_INVALID/);
});

test("GCM authentication binds the revision, logical path and original plaintext hash", async () => {
  const fixture = pack();
  const changes = [
    (batch) => Buffer.from(`manual-corpus-1\0other-revision\0${batch.path}\0${batch.sha256}`),
    (batch) => Buffer.from(`manual-corpus-1\0${fixture.manifest.revision}\0/__manual_corpus/another.json\0${batch.sha256}`),
    (batch) => Buffer.from(`manual-corpus-1\0${fixture.manifest.revision}\0${batch.path}\0${"a".repeat(64)}`),
  ];
  for (const aad of changes) {
    const sealed = seal(fixture, { aad });
    await assert.rejects(loader(fixture, sealed)(fixture.manifest.batches[0].path), /MANUAL_ENCRYPTED_ASSET_AUTH_FAILED/);
  }
});

test("authenticated non-gzip content is rejected with a safe format error", async () => {
  const fixture = pack();
  const sealed = seal(fixture, { compressed: () => Buffer.from("not a gzip stream") });
  await assert.rejects(loader(fixture, sealed)(fixture.manifest.batches[0].path), /^ManualAssetError: MANUAL_ASSET_GZIP_INVALID$/);
});

test("gzip expansion cannot exceed the original byte count or the 1 MiB manifest ceiling", async () => {
  const fixture = pack();
  const oversized = seal(fixture, { compressed: () => gzipSync(Buffer.alloc(2 * 1024 * 1024, 65)) });
  await assert.rejects(loader(fixture, oversized)(fixture.manifest.batches[0].path), /MANUAL_ASSET_PLAINTEXT_SIZE_MISMATCH/);
  const short = seal(fixture, { compressed: (batch) => gzipSync(fixture.assets.get(batch.path).subarray(0, -1)) });
  await assert.rejects(loader(fixture, short)(fixture.manifest.batches[0].path), /MANUAL_ASSET_PLAINTEXT_SIZE_MISMATCH/);
});

test("same-length authenticated plaintext must still satisfy the unchanged original SHA256", async () => {
  const fixture = pack();
  const sealed = seal(fixture, { compressed: (batch) => {
    const bytes = Buffer.from(fixture.assets.get(batch.path)); bytes[0] ^= 1; return gzipSync(bytes);
  } });
  await assert.rejects(loader(fixture, sealed)(fixture.manifest.batches[0].path), /MANUAL_ASSET_PLAINTEXT_HASH_MISMATCH/);
});

test("abort cancels pending asset streams and does not expose the supplied abort reason", { timeout: 3000 }, async () => {
  const fixture = pack();
  const sealed = seal(fixture);
  const early = new AbortController();
  early.abort("private reason");
  const noFetch = transport(sealed);
  await assert.rejects(loader(fixture, sealed, noFetch)(fixture.manifest.batches[0].path, early.signal), /^ManualAssetError: MANUAL_ASSET_ABORTED$/);
  assert.equal(noFetch.calls.length, 0);
  let enter;
  let cancelled = false;
  const started = new Promise((resolve) => { enter = resolve; });
  const fetcher = transport(sealed, () => new Response(new ReadableStream({
    pull() { enter(); },
    cancel() { cancelled = true; },
  })));
  const controller = new AbortController();
  const pending = loader(fixture, sealed, fetcher)(fixture.manifest.batches[0].path, controller.signal);
  await started;
  controller.abort("private reason");
  await assert.rejects(pending, /^ManualAssetError: MANUAL_ASSET_ABORTED$/);
  assert.equal(cancelled, true);
});

test("transport failures and unsuccessful HTTP responses never expose upstream error data", async () => {
  const fixture = pack();
  const sealed = seal(fixture);
  const failure = { async fetch() { throw new Error("private upstream details " + sealed.key); } };
  await assert.rejects(loader(fixture, sealed, failure)(fixture.manifest.batches[0].path), /^ManualAssetError: MANUAL_ENCRYPTED_ASSET_FETCH_FAILED$/);
  await assert.rejects(loader(fixture, sealed, transport(sealed, () => new Response("private upstream text", { status: 404 })))(fixture.manifest.batches[0].path), /^ManualAssetError: MANUAL_ENCRYPTED_ASSET_HTTP_ERROR$/);
});

test("Worker-compatible manual redirects reject external 302/307 locations after one internal request", async () => {
  const fixture = pack();
  const sealed = seal(fixture);
  for (const status of [302, 307]) {
    const fetcher = transport(sealed, (_bytes, request) => {
      assert.equal(request.redirect, "manual");
      return new Response(null, { status, headers: { location: "https://external.example.test/never-fetch-this" } });
    });
    await assert.rejects(loader(fixture, sealed, fetcher)(fixture.manifest.batches[0].path), /^ManualAssetError: MANUAL_ENCRYPTED_ASSET_HTTP_ERROR$/);
    assert.deepEqual(fetcher.calls, [sealed.manifest.batches[0].asset_path]);
  }
});

test("unexpected Request initialization failures expose only their fixed stage code", async (t) => {
  const fixture = pack();
  const sealed = seal(fixture);
  const fetcher = transport(sealed);
  t.mock.method(globalThis, "Request", function () { throw new Error("private constructor details"); });
  await assert.rejects(loader(fixture, sealed, fetcher)(fixture.manifest.batches[0].path), /^ManualAssetError: MANUAL_ENCRYPTED_ASSET_REQUEST_FAILED$/);
  assert.equal(fetcher.calls.length, 0);
});

test("response reader initialization and actual stream errors have separate safe codes", async () => {
  const fixture = pack();
  const sealed = seal(fixture);
  const first = fixture.manifest.batches[0].path;
  const setup = transport(sealed, () => ({ status: 200, redirected: false, body: {
    getReader() { throw new Error("private reader initialization details"); },
  } }));
  await assert.rejects(loader(fixture, sealed, setup)(first), /^ManualAssetError: MANUAL_ENCRYPTED_ASSET_READ_INIT_FAILED$/);
  const reading = transport(sealed, () => new Response(new ReadableStream({
    pull(controller) { controller.error(new Error("private streaming details")); },
  })));
  await assert.rejects(loader(fixture, sealed, reading)(first), /^ManualAssetError: MANUAL_ENCRYPTED_ASSET_READ_FAILED$/);
});

test("unexpected ciphertext digest failures expose only their fixed stage code", async (t) => {
  const fixture = pack();
  const sealed = seal(fixture);
  const digest = crypto.subtle.digest;
  let digests = 0;
  t.mock.method(crypto.subtle, "digest", function (...args) {
    if (++digests === 2) throw new Error("private digest details");
    return digest.apply(crypto.subtle, args);
  });
  await assert.rejects(loader(fixture, sealed)(fixture.manifest.batches[0].path), /^ManualAssetError: MANUAL_ENCRYPTED_ASSET_DIGEST_FAILED$/);
});

test("unexpected gzip stream initialization failures expose only their fixed stage code", async (t) => {
  const fixture = pack();
  const sealed = seal(fixture);
  t.mock.method(globalThis, "DecompressionStream", function () { throw new Error("private gzip initialization details"); });
  await assert.rejects(loader(fixture, sealed)(fixture.manifest.batches[0].path), /^ManualAssetError: MANUAL_ASSET_GZIP_INIT_FAILED$/);
});

test("a failed encrypted batch retains the previous active corpus and stores no plaintext rows for the new revision", async () => {
  const db = manualDatabase();
  try {
    const previous = pack();
    await activate(db, previous);
    const next = pack({ revision: "fixture-v2", createdAt: "2026-10-10T05:00:00Z" });
    const sealed = seal(next, { aad: () => Buffer.from("incorrect aad") });
    const result = await advanceManualCorpus(db, loader(next, sealed), next.manifest, { now: () => NOW });
    assert.equal(result.status, "FAILED");
    assert.equal(result.error_code, "MANUAL_ENCRYPTED_ASSET_AUTH_FAILED");
    assert.equal(result.next_batch, 0);
    assert.equal((await readableManualRevision(db)).revision, previous.manifest.revision);
    assert.equal(db.sqlite.prepare("SELECT COUNT(*) n FROM manual_document WHERE corpus_revision=?").get(next.manifest.revision).n, 0);
    assert.equal(db.sqlite.prepare("SELECT COUNT(*) n FROM manual_section WHERE corpus_revision=?").get(next.manifest.revision).n, 0);
  } finally { db.sqlite.close(); }
});

test("fixed loader diagnostics survive storage, release the lease and allow a later verified retry", async () => {
  const fixture = pack();
  const scenarios = [
    { expected: "MANUAL_ASSET_KEY_INVALID", key: "not a base64 key" },
    { expected: "MANUAL_ENCRYPTED_ASSET_FETCH_FAILED", response: () => { throw new Error("private fetch details"); } },
    { expected: "MANUAL_ENCRYPTED_ASSET_READ_INIT_FAILED", response: () => ({ status: 200, redirected: false, body: {
      getReader() { throw new Error("private reader initialization details"); },
    } }) },
    { expected: "MANUAL_ENCRYPTED_ASSET_HTTP_ERROR", response: () => new Response("private upstream text", { status: 404 }) },
    { expected: "MANUAL_ENCRYPTED_ASSET_SIZE_MISMATCH", response: (bytes) => new Response(bytes.subarray(0, -1)) },
    { expected: "MANUAL_ENCRYPTED_ASSET_HASH_MISMATCH", response: (bytes) => {
      const copy = Buffer.from(bytes); copy[copy.length - 1] ^= 1; return new Response(copy);
    } },
    { expected: "MANUAL_ASSET_GZIP_INVALID", options: { compressed: () => Buffer.from("not gzip") } },
  ];
  for (const scenario of scenarios) {
    const db = manualDatabase();
    try {
      const sealed = seal(fixture, scenario.options);
      const load = createEncryptedManualAssetLoader(transport(sealed, scenario.response), scenario.key ?? sealed.key, fixture.manifest, sealed.manifest);
      const result = await advanceManualCorpus(db, load, fixture.manifest, { now: () => NOW });
      assert.equal(result.status, "FAILED");
      assert.equal(result.error_code, scenario.expected);
      assert.equal(result.next_batch, 0);
      const row = db.sqlite.prepare("SELECT last_error, lease_token, failure_count, retry_after FROM manual_corpus").get();
      assert.equal(row.last_error, scenario.expected);
      assert.equal(row.lease_token, null);
      assert.equal(row.failure_count, 1);
      assert.equal(row.retry_after, NOW + 5);
      const correct = seal(fixture);
      assert.equal((await advanceManualCorpus(db, loader(fixture, correct), fixture.manifest, { now: () => NOW + 6 })).status, "ADVANCED");
    } finally { db.sqlite.close(); }
  }
});

test("raw errors, arbitrary ManualAssetError messages and code-shaped objects remain redacted in persisted status", async () => {
  const privateText = "private response body and test-only key value";
  const errors = [
    new Error(privateText),
    Object.assign(new Error("MANUAL_ASSET_KEY_INVALID " + privateText), { name: "ManualAssetError" }),
    Object.assign(new Error("MANUAL_UNKNOWN_ASSET_ERROR"), { name: "ManualAssetError" }),
    new Error("MANUAL_ASSET_KEY_INVALID"),
    { name: "ManualAssetError", message: "MANUAL_ASSET_KEY_INVALID", code: "MANUAL_ASSET_KEY_INVALID" },
  ];
  for (const error of errors) {
    const db = manualDatabase();
    try {
      const fixture = pack();
      const result = await advanceManualCorpus(db, async () => { throw error; }, fixture.manifest, { now: () => NOW });
      const row = db.sqlite.prepare("SELECT last_error, next_batch, lease_token FROM manual_corpus").get();
      assert.equal(result.error_code, "MANUAL_STORAGE_OR_ASSET_ERROR");
      assert.equal(row.last_error, "MANUAL_STORAGE_OR_ASSET_ERROR");
      assert.equal(row.next_batch, 0);
      assert.equal(row.lease_token, null);
      assert.equal(JSON.stringify({ result, row }).includes(privateText), false);
    } finally { db.sqlite.close(); }
  }
});

test("the generated deployment manifest has a complete matching transport map without access to the production key", () => {
  const manual = JSON.parse(readFileSync(new URL("../data/manual-corpus/manifest.json", import.meta.url), "utf8"));
  const encrypted = JSON.parse(readFileSync(new URL("../data/manual-corpus/encrypted-assets.json", import.meta.url), "utf8"));
  const fetcher = { async fetch() { assert.fail("manifest validation must not fetch an asset"); } };
  assert.equal(typeof createEncryptedManualAssetLoader(fetcher, "", manual, encrypted), "function");
  assert.equal(encrypted.batches.length, manual.batches.length);
});
