#!/usr/bin/env node
// Offline workerd compatibility check. Only a freshly generated synthetic key
// is used. The test config has no sockets and no network/external services.
import { createCipheriv, createHash, randomBytes } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve, sep } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";
import { build, version as esbuildVersion } from "esbuild";

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const args = process.argv.slice(2);
const options = {};
for (let index = 0; index < args.length; index += 2) {
  const name = args[index];
  if (!["--scratch-dir", "--output-dir"].includes(name) || !args[index + 1]) {
    throw new Error("Usage: node scripts/manuals/workerd-asset-compat.mjs [--scratch-dir DIR] [--output-dir DIR]");
  }
  options[name] = resolve(args[index + 1]);
}
const scratchRoot = options["--scratch-dir"] ?? tmpdir();
const relativeScratch = relative(repo, scratchRoot);
if (relativeScratch !== ".." && !relativeScratch.startsWith(".." + sep)) throw new Error("Synthetic fixture workspace must be outside the repository");
mkdirSync(scratchRoot, { recursive: true });
const scratch = mkdtempSync(join(scratchRoot, "workerd-asset-compat-"));
const output = options["--output-dir"] ?? join(repo, "docs/qa/manual-corpus-runtime-20261010");
mkdirSync(output, { recursive: true });
const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const hashFile = (path) => sha256(readFileSync(path));
const assetSource = join(repo, "lib/manuals/assets.ts");
const sourceHash = hashFile(assetSource);
const viteSource = readFileSync(join(repo, "vite.config.ts"), "utf8");
const compatibilityDate = viteSource.match(/compatibility_date:\s*["'](\d{4}-\d{2}-\d{2})["']/)?.[1];
const flagsText = viteSource.match(/compatibility_flags:\s*(\[[^\]]*\])/s)?.[1];
if (!compatibilityDate || !flagsText) throw new Error("Literal Worker compatibility settings were not found");
const compatibilityFlags = JSON.parse(flagsText);
if (!Array.isArray(compatibilityFlags) || compatibilityFlags.some((flag) => typeof flag !== "string")) throw new Error("Invalid compatibility flags");

const rawKey = randomBytes(32);
const keyBase64 = rawKey.toString("base64");
const keyId = sha256(rawKey).slice(0, 24);
const revision = "synthetic-workerd-compat-v1";
const logicalPath = `/__manual_corpus/${revision}/batch-0000.json`;
const assetPath = `/__manual_cipher/${revision}/${keyId}/batch-0000.bin`;
const plaintext = Buffer.from(JSON.stringify({ schema_version: "manual-corpus-1", revision, batch_index: 0,
  documents: [], sections: [{ section_id: "synthetic-section", content: "합성 fixture: 실제 지원기준 아님 🙂\r\n<table><tr><td>한글</td><td>Unicode</td></tr></table>\r\n".repeat(1200) }] }));
const plainHash = sha256(plaintext);
const nonce = randomBytes(12);
const gzip = gzipSync(plaintext);
const cipher = createCipheriv("aes-256-gcm", rawKey, nonce);
cipher.setAAD(Buffer.from(`manual-corpus-1\0${revision}\0${logicalPath}\0${plainHash}`));
const sealed = Buffer.concat([Buffer.from("MCPGCM01"), nonce, cipher.update(gzip), cipher.final(), cipher.getAuthTag()]);
rawKey.fill(0);
const manifest = { schema_version: "manual-corpus-1", revision, source_commit: "0".repeat(40), source_repository: "https://synthetic.invalid/no-network",
  created_at: "2026-10-10T00:00:00Z", document_count: 0, section_count: 1,
  batches: [{ path: logicalPath, sha256: plainHash, bytes: plaintext.byteLength, documents: 0, sections: 1 }] };
const encrypted = { schema_version: "manual-assets-aes-gcm-1", revision, algorithm: "AES-256-GCM", compression: "gzip", key_id: keyId,
  batches: [{ logical_path: logicalPath, asset_path: assetPath, sha256: sha256(sealed), bytes: sealed.byteLength,
    plaintext_sha256: plainHash, plaintext_bytes: plaintext.byteLength }] };
const fixture = { key: keyBase64, manifest, encrypted, logicalPath, plaintextBase64: plaintext.toString("base64") };

const entry = `import { createEncryptedManualAssetLoader } from ${JSON.stringify(assetSource)};
const fixture = ${JSON.stringify(fixture)};
const unpack = value => Uint8Array.from(atob(value), ch => ch.charCodeAt(0));
const check = (value, message) => { if (!value) throw new Error(message); };
export default { async test(_ctrl, env) {
  let failures = 0;
  async function scenario(id, fn) {
    try { const observed = await fn(); console.log("WORKERD_COMPAT_OBSERVATION " + JSON.stringify({id,status:"PASS",observed})); }
    catch (error) { failures++; console.log("WORKERD_COMPAT_OBSERVATION " + JSON.stringify({id,status:"FAIL",error:{name:error.name,message:String(error.message).replaceAll(fixture.key,"[SYNTHETIC_KEY_REDACTED]")}})); }
  }
  await scenario("request_redirect_error_reproduced", async () => {
    let observed;
    try { new Request("https://manual-assets.internal/synthetic.bin", {redirect:"error"}); }
    catch (error) { observed = {name:error.name,message:error.message}; }
    check(observed?.name === "TypeError", "redirect:error did not reproduce the expected TypeError"); return observed;
  });
  await scenario("request_redirect_manual_supported", async () => {
    const request = new Request("https://manual-assets.internal/synthetic.bin", {redirect:"manual"});
    check(request.redirect === "manual", "manual redirect mode was not retained"); return {redirect:request.redirect};
  });
  const loadFrom = binding => createEncryptedManualAssetLoader(binding, fixture.key, fixture.manifest, fixture.encrypted);
  await scenario("production_loader_node_seal_workerd_roundtrip", async () => {
    const bytes = await loadFrom(env.ASSET_OK)(fixture.logicalPath);
    const expected = unpack(fixture.plaintextBase64);
    check(bytes.length === expected.length && bytes.every((value,index) => value === expected[index]), "Plaintext bytes differ");
    const hash = [...new Uint8Array(await crypto.subtle.digest("SHA-256",bytes))].map(value => value.toString(16).padStart(2,"0")).join("");
    check(hash === fixture.manifest.batches[0].sha256, "Plaintext SHA differs");
    return {plaintext_bytes:bytes.length,plaintext_sha256:hash,byte_identical:true};
  });
  for (const status of [302,307]) await scenario("production_loader_rejects_" + status + "_without_following", async () => {
    let observed;
    try { await loadFrom(env["ASSET_" + status])(fixture.logicalPath); }
    catch (error) { observed = {name:error.name,message:error.message}; }
    check(observed?.name === "ManualAssetError" && observed?.message === "MANUAL_ENCRYPTED_ASSET_HTTP_ERROR", "Redirect was not rejected at the HTTP status gate");
    return observed;
  });
  if (failures) throw new Error("WORKERD_COMPAT_FAILED:" + failures);
} };`;
const assetEntry = `const path = ${JSON.stringify(assetPath)};
const payload = ${JSON.stringify(sealed.toString("base64"))};
export default { async fetch(request, env) {
  const url = new URL(request.url);
  console.log("WORKERD_COMPAT_ASSET_CALL " + JSON.stringify({status:Number(env.STATUS),pathname:url.pathname,redirect:request.redirect}));
  if (url.origin !== "https://manual-assets.internal" || url.pathname !== path) throw new Error("UNEXPECTED_FIXTURE_REQUEST");
  if (env.STATUS !== "200") return new Response(null,{status:Number(env.STATUS),headers:{Location:"https://must-not-be-requested.invalid/redirect-target"}});
  return new Response(Uint8Array.from(atob(payload), ch => ch.charCodeAt(0)),{status:200});
} };`;
const bundle = await build({ stdin: { contents: entry, sourcefile: "workerd-asset-test.mjs", resolveDir: repo },
  bundle: true, write: false, format: "esm", platform: "neutral", target: "es2022", logLevel: "silent", metafile: true });
writeFileSync(join(scratch, "test.mjs"), bundle.outputFiles[0].contents, { mode: 0o600 });
writeFileSync(join(scratch, "assets.mjs"), assetEntry, { mode: 0o600 });
writeFileSync(join(scratch, "deny.mjs"), 'export default { fetch() { console.log("WORKERD_COMPAT_UNEXPECTED_OUTBOUND"); throw new Error("NETWORK_DISABLED_IN_COMPAT_TEST"); } };\n');
const worker = (module, bindings = "") => `(modules=[(name=${JSON.stringify(module)},esModule=embed ${JSON.stringify(module)})],compatibilityDate=${JSON.stringify(compatibilityDate)},compatibilityFlags=${JSON.stringify(compatibilityFlags)},globalOutbound="internet"${bindings ? ",bindings=" + bindings : ""})`;
const config = `using Workerd = import "/workerd/workerd.capnp";
const config :Workerd.Config = (sockets=[], services=[
  (name="compat",worker=${worker("test.mjs", '[(name="ASSET_OK",service="asset-200"),(name="ASSET_302",service="asset-302"),(name="ASSET_307",service="asset-307")]')}),
  ${[200,302,307].map(status => `(name="asset-${status}",worker=${worker("assets.mjs", `[(name="STATUS",text="${status}")]`)})`).join(",\n  ")},
  (name="internet",worker=${worker("deny.mjs")})
]);\n`;
const configPath = join(scratch, "config.capnp");
writeFileSync(configPath, config);
const binary = join(repo, "node_modules/workerd/bin/workerd");
const result = spawnSync(binary, ["test", configPath, "compat"], { cwd: scratch, encoding: "utf8", timeout: 30_000, maxBuffer: 2 * 1024 * 1024, env: {} });
const rawOutput = ((result.stdout ?? "") + (result.stderr ?? "")).replaceAll(keyBase64, "[SYNTHETIC_KEY_REDACTED]");
writeFileSync(join(scratch, "output.txt"), rawOutput);
const readEvents = prefix => rawOutput.split(/\r?\n/).filter(line => line.startsWith(prefix)).map(line => JSON.parse(line.slice(prefix.length)));
const scenarios = readEvents("WORKERD_COMPAT_OBSERVATION ");
const calls = readEvents("WORKERD_COMPAT_ASSET_CALL ");
const forbiddenCalls = rawOutput.split("WORKERD_COMPAT_UNEXPECTED_OUTBOUND").length - 1;
const sourceUnchanged = hashFile(assetSource) === sourceHash;
const passed = result.status === 0 && scenarios.length === 5 && scenarios.every(test => test.status === "PASS") &&
  calls.length === 3 && calls.every(call => call.redirect === "manual") &&
  [200,302,307].every(status => calls.filter(call => call.status === status && call.pathname === assetPath).length === 1) && forbiddenCalls === 0 && sourceUnchanged;
const audit = { schema_version: "workerd-manual-asset-compat-1", recorded_at: new Date().toISOString(), status: passed ? "PASS" : "FAIL",
  scope: "OFFLINE_SYNTHETIC_FIXTURE_REAL_WORKERD_ENGINE_NOT_PRODUCTION_IMPORT",
  runtime: { node: process.version, workerd_package: JSON.parse(readFileSync(join(repo,"node_modules/workerd/package.json"),"utf8")).version,
    workerd_binary_sha256: hashFile(binary), esbuild: esbuildVersion, compatibility_date: compatibilityDate, compatibility_flags: compatibilityFlags },
  source: { path: "lib/manuals/assets.ts", sha256: sourceHash, unchanged_during_test: sourceUnchanged,
    types_sha256: hashFile(join(repo,"lib/manuals/types.ts")), vite_config_sha256: hashFile(join(repo,"vite.config.ts")),
    test_script_sha256: hashFile(fileURLToPath(import.meta.url)), bundled_inputs: Object.keys(bundle.metafile.inputs) },
  isolation: { sockets: 0, network_services: 0, external_services: 0, outbound_target: "in-process refusing Worker", inherited_process_environment: false,
    production_key_access: false, synthetic_key_generated_in_process: true, generated_fixture_or_key_files_in_repo: false, unexpected_outbound_attempts: forbiddenCalls },
  fixture: { revision, plaintext_bytes: plaintext.byteLength, plaintext_sha256: plainHash, gzip_bytes: gzip.byteLength,
    ciphertext_bytes: sealed.byteLength, ciphertext_sha256: sha256(sealed), temporary_workspace: scratch },
  scenarios, asset_service_calls: calls, expected_asset_service_calls: 3,
  execution: { exit_code: result.status, signal: result.signal, error_code: result.error?.code ?? null, engine_test_entrypoints: 1,
    output_file: "workerd-compat-output.txt", output_sha256: sha256(rawOutput), config_sha256: sha256(config), bundled_code_sha256: sha256(bundle.outputFiles[0].contents) },
  reproduction: { working_directory: repo, command: ["node", "scripts/manuals/workerd-asset-compat.mjs", "--scratch-dir", scratchRoot, "--output-dir", output] },
  limitations: ["The asset response is supplied by an in-process workerd service binding, not Sites production ASSETS.",
    "This verifies Request, WebCrypto AES-GCM, Blob.stream, gzip and redirect rejection with a synthetic fixture; it does not import D1 or validate a production secret."] };
writeFileSync(join(output, "workerd-compat-output.txt"), rawOutput);
writeFileSync(join(output, "workerd-compat-audit.json"), JSON.stringify(audit, null, 2) + "\n");
console.log(JSON.stringify({ status: audit.status, scenarios: scenarios.length, passed: scenarios.filter(test => test.status === "PASS").length,
  asset_service_calls: calls.length, unexpected_outbound_attempts: forbiddenCalls, source_sha256: sourceHash,
  plaintext_bytes: plaintext.byteLength, audit: join(output,"workerd-compat-audit.json") }));
if (!passed) process.exitCode = 2;
