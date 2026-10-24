// 복지톡 저장소의 복지DB 업데이트 커밋을 복지MCP 매뉴얼 DB와 복지제도100 연결에 반영한다. 절차는 scripts/manuals/UPDATE.md에 있다.
import { spawnSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { patchManualCorpora } from "../welfare100/patch-manual-corpora.mjs";
import { combinedManualLines, readCorpus } from "../welfare100/manual-pages.mjs";
import { lineFingerprint } from "../welfare100/manual-link-scope.mjs";

const SITE = process.cwd();
const argv = process.argv.slice(2);
const arg = (name, fallback) => { const index = argv.indexOf("--" + name); return index >= 0 ? argv[index + 1] : fallback; };
const flag = (name) => argv.includes("--" + name);
const sha = (value) => createHash("sha256").update(value).digest("hex");
const fail = (message) => { throw new Error(message); };

function run(command, args, { cwd = SITE, input, allowFailure = false, env = process.env } = {}) {
  const result = spawnSync(command, args, { cwd, input, env, encoding: "utf8", maxBuffer: 1 << 30, windowsHide: true });
  if (!allowFailure && result.status !== 0) fail(command + " " + args.slice(0, 3).join(" ") + " 실패(" + result.status + ")\n" + String(result.stdout ?? "").slice(-3000) + "\n" + String(result.stderr ?? "").slice(-3000));
  return result;
}

function vault(mode, key) {
  const script = path.join(SITE, "scripts/manuals/manual-key-vault.ps1");
  const env = key ? { ...process.env, MANUAL_CORPUS_KEY_INPUT: key } : process.env;
  const result = run("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", script, "-Mode", mode], { env, allowFailure: true });
  return result.status === 0 ? result.stdout.trim() : null;
}

function readManifest(repo) {
  const name = arg("manifest") ?? fs.readdirSync(repo).filter((file) => /^db-update-\d{4}-\d{2}-\d{2}\.json$/.test(file)).sort().at(-1);
  if (!name) fail("복지톡 저장소에 db-update-*.json이 없습니다.");
  return { name, manifest: JSON.parse(fs.readFileSync(path.join(repo, name), "utf8")) };
}

function exportSource(repo, commit, target) {
  fs.rmSync(target, { recursive: true, force: true });
  fs.mkdirSync(path.join(target, "source-md"), { recursive: true });
  const files = run("git", ["-C", repo, "ls-tree", "-z", "--name-only", commit, "source-md/"]).stdout.split("\0").filter(Boolean);
  for (const file of files) {
    const blob = spawnSync("git", ["-C", repo, "show", commit + ":" + file], { maxBuffer: 1 << 30, windowsHide: true });
    if (blob.status !== 0) fail("git show 실패: " + file);
    fs.writeFileSync(path.join(target, file), blob.stdout);
  }
  return files.length;
}

function identityRows() {
  const known = new Set();
  for (const file of fs.readdirSync(path.join(SITE, "drizzle")).filter((name) => name.endsWith(".sql"))) {
    const text = fs.readFileSync(path.join(SITE, "drizzle", file), "utf8");
    if (!text.includes("manual_original_identity")) continue;
    for (const match of text.matchAll(/\('([0-9a-f]{64})',/g)) known.add(match[1]);
  }
  return known;
}

function writeIdentityMigration(catalog, manifest, date) {
  const known = identityRows();
  const bySha = new Map(manifest.documents.map((document) => [document.sha256, document]));
  const rows = catalog.documents.filter((document) => !known.has(document.sha256) && bySha.get(document.sha256)?.original_sha256).map((document) => bySha.get(document.sha256));
  if (!rows.length) return null;
  const quote = (value) => value === null || value === undefined ? "NULL" : typeof value === "number" ? String(value) : "'" + String(value).replaceAll("'", "''") + "'";
  const next = Math.max(...fs.readdirSync(path.join(SITE, "drizzle")).map((name) => Number(name.slice(0, 4))).filter(Number.isFinite)) + 1;
  const file = String(next).padStart(4, "0") + "_manual_original_identity_" + date.replaceAll("-", "") + ".sql";
  const values = rows.map((row) => "(" + [row.sha256, row.original_name, row.original_sha256, row.format, row.page_count ?? null].map(quote).join(",") + ")").join(",\n");
  fs.writeFileSync(path.join(SITE, "drizzle", file), "INSERT OR REPLACE INTO manual_original_identity (parsed_sha256, original_name, original_sha256, format, page_count) VALUES\n" + values + ";\n");
  return { file, rows: rows.length };
}

function bundleJson(bundle, document) {
  const candidates = [document.kordoc_json, document.original_sha256?.slice(0, 12) + ".json"].filter(Boolean).map((name) => path.join(bundle, name));
  return candidates.find((file) => fs.existsSync(file)) ?? null;
}

function updatePageInventory(manifest, bundle, checkedAt) {
  const file = path.join(SITE, "data/manual-original-page-inventory.json");
  const inventory = JSON.parse(fs.readFileSync(file, "utf8"));
  const present = new Set(inventory.map((item) => item.original_sha256));
  const added = [];
  for (const document of manifest.documents.filter((item) => item.original_sha256 && !present.has(item.original_sha256))) {
    const json = bundleJson(bundle, document);
    const pages = document.low_text_pages ?? (json ? JSON.parse(fs.readFileSync(json, "utf8")).pageQuality?.filter((page) => page.needsOcr).map((page) => page.page) : null);
    if (!pages) fail("쪽 정보가 없습니다(번들 JSON 없음): " + document.original_name);
    inventory.push({ original_sha256: document.original_sha256, page_count: document.page_count, ocr_candidate_pages: pages, retained_hash_checked_at: checkedAt, official_candidate: null });
    present.add(document.original_sha256);
    added.push(document.original_name);
  }
  if (added.length) fs.writeFileSync(file, JSON.stringify(inventory) + "\n");
  return added;
}

function welfare100Changes(repo, manifest, sourceRoot, bundle) {
  const previous = manifest.previous?.manifest ? JSON.parse(fs.readFileSync(path.join(repo, manifest.previous.manifest), "utf8")) : { documents: [] };
  const previousByName = new Map(previous.documents.map((document) => [document.source_name, document]));
  return manifest.documents.filter((document) => document.replaces && document.legacy_serial && fromUpdate(document, manifest)).map((document) => {
    const old = previousByName.get(document.replaces);
    const json = bundleJson(bundle, document);
    if (!json) fail("복지제도100 원본 쪽 정보를 만들 Kordoc JSON이 번들에 없습니다: " + document.original_name);
    return {
      key: document.legacy_serial,
      old_source_name: document.replaces,
      old_marker: old?.desktop_file,
      new_source_name: document.source_name,
      new_text_path: path.join(sourceRoot, "source-md", document.source_name),
      old_original_sha256: document.replaces_original_sha256 ?? old?.original_sha256,
      new_original: { name: document.original_name, sha256: document.original_sha256, format: document.format, page_count: document.page_count, kordoc_json: json, parser: (document.content_source ?? "").split("_")[1] ?? "" },
    };
  });
}

const fromUpdate = (document, manifest) => String(document.content_source ?? "").replaceAll("-", "").endsWith(manifest.update.replaceAll("-", ""));
const deepEqual = (a, b) => JSON.stringify(a) === JSON.stringify(b);
function refsOf(payload) { return payload.kind === "curated" ? payload.extra?.talkRefs ?? [] : payload.kind === "auto" ? payload.raw?.talkRefs ?? [] : []; }

function regenerateWelfare100(keys, work) {
  const manuals = path.join(work, "w100-manuals");
  const out = path.join(work, "w100-out");
  fs.rmSync(out, { recursive: true, force: true });
  run(process.execPath, ["scripts/welfare100/export-manual-markdown.mjs", manuals]);
  run(process.execPath, ["--experimental-strip-types", "scripts/welfare100/build-catalog.mjs", "--from-items", "public/data/welfare100/items", "--manuals", manuals, "--out", out, "--allow-stale"]);
  const itemsDir = path.join(SITE, "public/data/welfare100/items");
  const changed = [];
  for (const file of fs.readdirSync(path.join(out, "items")).filter((name) => name.endsWith(".json"))) {
    const target = path.join(itemsDir, file);
    if (!fs.existsSync(target)) continue;
    const current = JSON.parse(fs.readFileSync(target, "utf8"));
    const regenerated = JSON.parse(fs.readFileSync(path.join(out, "items", file), "utf8"));
    const touches = [...refsOf(current), ...refsOf(regenerated)].some((ref) => keys.includes(ref.key) || keys.includes(ref.sourceKey));
    if (!touches || deepEqual(refsOf(current), refsOf(regenerated))) continue;
    if (current.kind === "curated") current.extra.talkRefs = regenerated.extra.talkRefs;
    else current.raw.talkRefs = regenerated.raw.talkRefs;
    fs.writeFileSync(target, JSON.stringify(current));
    changed.push(file.replace(/\.json$/, ""));
  }
  const reconciled = reconcileReviews(keys);
  const attach = run(process.execPath, ["scripts/welfare100/attach-manual-pages.mjs"], { allowFailure: true });
  if (attach.status !== 0) fail("attach-manual-pages 실패(검수 판정 지문 불일치 등)\n" + attach.stdout.slice(-3000) + attach.stderr.slice(-2000));
  return { changedItems: changed, reconciled, attach: JSON.parse(attach.stdout.slice(attach.stdout.indexOf("{"))) };
}

// 같은 문구가 새 판에 여러 번 나오면 지문만으로 옮긴 판정이 다시 계산한 연결과 다른 줄에 붙을 수 있다.
// 직접·보류 판정은 그 사업의 새 연결 가운데 판정 지문과 같은 문구의 줄로 맞추고, 그런 연결이 없으면 보관 목록으로 옮긴다.
function reconcileReviews(keys) {
  const reviewsPath = path.join(SITE, "data/welfare100/manual-link-reviews.json");
  const reviews = JSON.parse(fs.readFileSync(reviewsPath, "utf8"));
  const revisions = JSON.parse(fs.readFileSync(path.join(SITE, "data/welfare100/manual-corpus-revisions.json"), "utf8"));
  const lines = combinedManualLines(readCorpus(path.join(SITE, "data/manual-corpus/assets/__manual_corpus"), revisions.combined));
  const fingerprintAt = (key, line) => lineFingerprint(lines.get(key)?.[line - 1]);
  const itemsDir = path.join(SITE, "public/data/welfare100/items");
  const itemPath = (item) => path.join(itemsDir, item.replace(/^curated:/, "") + ".json");
  const refsFor = (item) => fs.existsSync(itemPath(item)) ? refsOf(JSON.parse(fs.readFileSync(itemPath(item), "utf8"))).filter((ref) => !ref.curatedSource) : [];
  const now = new Date().toISOString();
  const kept = [];
  const retired = [];
  let aligned = 0;
  for (const decision of reviews.decisions) {
    const key = decision.to_key ?? decision.key;
    if (decision.decision === "EXCLUDE" || !keys.includes(decision.key)) { kept.push(decision); continue; }
    const refs = refsFor(decision.item).filter((ref) => ref.key === key);
    if (refs.some((ref) => ref.line === (decision.to_line ?? decision.line))) { kept.push(decision); continue; }
    const fromOrigin = decision.to_line ? refs.find((ref) => fingerprintAt(key, ref.line) === decision.line_sha256) : null;
    if (fromOrigin) { kept.push({ ...decision, line: fromOrigin.line, migrated: { ...(decision.migrated ?? {}), aligned_to_regenerated_link: true } }); aligned += 1; continue; }
    const wanted = decision.to_line_sha256 ?? decision.line_sha256;
    const match = refs.find((ref) => fingerprintAt(key, ref.line) === wanted);
    if (!match) { retired.push({ ...decision, retired_reason: "NO_REGENERATED_LINK_WITH_REVIEWED_TEXT", retired_at: now, retired_from_revision: revisions.previous?.combined }); continue; }
    const { to_key: _toKey, to_line: _toLine, to_line_sha256: _toSha, ...rest } = decision;
    kept.push({ ...rest, key, line: match.line, line_sha256: wanted, migrated: { ...(decision.migrated ?? {}), aligned_to_regenerated_link: true } });
    aligned += 1;
  }
  const decided = new Set(kept.flatMap((decision) => [decision.item + "#" + decision.key + "#" + decision.line, ...(decision.to_line ? [decision.item + "#" + decision.to_key + "#" + decision.to_line] : [])]));
  const carried = [];
  for (const old of (reviews.retired_decisions ?? []).filter((decision) => decision.decision === "EXCLUDE" && decision.retired_from_revision === revisions.previous?.combined && keys.includes(decision.key) && !decision.carried_to_line)) {
    const file = itemPath(old.item);
    if (!fs.existsSync(file)) continue;
    const payload = JSON.parse(fs.readFileSync(file, "utf8"));
    const list = payload.kind === "curated" ? payload.extra.talkRefs : payload.raw.talkRefs;
    const unreviewed = list.filter((ref) => !ref.curatedSource && ref.key === old.key && !decided.has(old.item + "#" + ref.key + "#" + ref.line));
    if (!unreviewed.length) continue;
    for (const ref of unreviewed) {
      const { retired_reason: _reason, retired_at: _at, retired_from_revision: _from, migrated: _migrated, ...base } = old;
      kept.push({ ...base, line: ref.line, line_sha256: fingerprintAt(ref.key, ref.line), carried_from: { revision: old.retired_from_revision, line: old.line, basis: "retired_exclusion_same_item_and_manual" } });
      decided.add(old.item + "#" + ref.key + "#" + ref.line);
      old.carried_to_line = ref.line;
      carried.push(old.item + " " + ref.key + ":" + ref.line);
    }
    const remaining = list.filter((ref) => !unreviewed.includes(ref));
    if (payload.kind === "curated") payload.extra.talkRefs = remaining; else payload.raw.talkRefs = remaining;
    fs.writeFileSync(file, JSON.stringify(payload));
  }
  fs.writeFileSync(reviewsPath, JSON.stringify({ ...reviews, decisions: kept, retired_decisions: [...(reviews.retired_decisions ?? []), ...retired] }, null, 1) + "\n");
  return { aligned, retired: retired.length, carriedExclusions: carried };
}


function seal(revision) {
  const encryptedPath = path.join(SITE, "data/manual-corpus/encrypted-assets.json");
  if (fs.existsSync(encryptedPath) && JSON.parse(fs.readFileSync(encryptedPath, "utf8")).revision !== revision) fs.rmSync(encryptedPath);
  if (!fs.existsSync(encryptedPath)) fs.rmSync(path.join(SITE, "public/__manual_cipher", revision), { recursive: true, force: true });
  let key = vault("get");
  let rotated = false;
  if (!key) {
    key = randomBytes(32).toString("base64");
    if (vault("store", key) === null) fail("새 암호화 키를 Windows 자격 증명 관리자에 저장하지 못했습니다.");
    rotated = true;
  }
  const result = run(process.execPath, ["scripts/manuals/seal-corpus-assets.mjs", "--runtime"], { input: JSON.stringify({ key }) + "\n" });
  const audit = JSON.parse(result.stdout.slice(result.stdout.indexOf("{\"checked_at\"")));
  return { keyId: audit.key_id, keyRotated: rotated, batches: audit.batches, runtimeVerified: audit.runtime_decrypted_hashes_verified };
}

async function verifyLive(url, manifestRevision, documents) {
  const deadline = Date.now() + 45 * 60 * 1000;
  let status;
  while (Date.now() < deadline) {
    status = await (await fetch(url + "/api/manuals/status", { signal: AbortSignal.timeout(60000) })).json();
    if (status.active_revision === manifestRevision) break;
    if (status.ingestion?.last_error) fail("운영 반입 오류: " + status.ingestion.last_error);
    if (status.configured_revision !== manifestRevision) fail("운영 사이트가 아직 새 revision을 모릅니다(배포 전이거나 이전 버전 응답): " + status.configured_revision);
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  if (status?.active_revision !== manifestRevision) fail("45분 안에 반입이 끝나지 않았습니다.");
  const checks = [];
  for (const document of documents) {
    const query = document.source_name.replace(/\[[^\]]*\]/g, " ").replace(/\([^)]*\)|20\d{2}년?|\.md$|최종|★/g, " ").replace(/\s+/g, " ").trim();
    const body = { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "search_manuals", arguments: { query, limit: 5 } } };
    const response = await fetch(url + "/chatgpt/mcp", { method: "POST", headers: { "content-type": "application/json", accept: "application/json, text/event-stream" }, body: JSON.stringify(body), signal: AbortSignal.timeout(60000) });
    const text = await response.text();
    checks.push({ document: document.source_name, query, found: text.includes(manifestRevision) && text.includes(JSON.stringify(document.source_name).slice(1, 20)) });
  }
  return { active_revision: status.active_revision, sections: status.active?.section_count, checks };
}

async function main() {
  const repo = path.resolve(arg("bokjitalk") ?? fail("--bokjitalk <복지톡 저장소 경로>가 필요합니다."));
  const { name: manifestName, manifest } = readManifest(repo);
  const commit = arg("commit") ?? run("git", ["-C", repo, "log", "-1", "--format=%H", "--", manifestName]).stdout.trim();
  if (!/^[0-9a-f]{40}$/.test(commit)) fail("복지톡 커밋을 찾지 못했습니다.");
  const revision = "sgw-" + commit.slice(0, 12) + "-v1";
  const changedDocuments = manifest.documents.filter((document) => fromUpdate(document, manifest));
  if (arg("verify-live")) {
    console.log(JSON.stringify(await verifyLive(arg("verify-live").replace(/\/$/, ""), revision, changedDocuments), null, 1));
    return;
  }
  if (!run("git", ["-C", repo, "branch", "-r", "--contains", commit]).stdout.trim() && !flag("allow-unpushed")) fail("복지톡 커밋 " + commit.slice(0, 12) + "이 GitLab에 없습니다. 인용 링크가 깨지므로 먼저 push하세요.");
  const bundle = path.resolve(arg("bundle") ?? path.join(process.env.LOCALAPPDATA ?? os.homedir(), "BokjiTalkManualUpdate", manifest.update));
  const work = path.join(os.tmpdir(), "manual-update-" + commit.slice(0, 12));
  const checkedAt = new Date().toISOString();
  const python = arg("python") ?? [path.join(repo, ".venv-openkb/Scripts/python.exe"), "python"].find((candidate) => candidate === "python" || fs.existsSync(candidate));
  const files = exportSource(repo, commit, path.join(work, "source"));
  const pack = run(python, ["-X", "utf8", "scripts/manuals/build-corpus-pack.py", "--source-db", path.join(repo, "wiki/kb-v120/welfare.db"), "--source-root", path.join(work, "source"), "--source-directory", "source-md", "--source-commit", commit]);
  const catalog = JSON.parse(fs.readFileSync(path.join(SITE, "data/manual-corpus/catalog.json"), "utf8"));
  if (catalog.revision !== revision) fail("팩 revision이 예상과 다릅니다: " + catalog.revision);
  const identity = writeIdentityMigration(catalog, manifest, manifest.update);
  const inventory = updatePageInventory(manifest, bundle, checkedAt);
  let welfare100 = null;
  if (!flag("skip-welfare100")) {
    const changes = welfare100Changes(repo, manifest, path.join(work, "source"), bundle);
    if (changes.length) {
      const patched = patchManualCorpora({ site: SITE, changes, suffix: commit.slice(0, 12), checkedAt });
      welfare100 = { ...patched, ...regenerateWelfare100(patched.keys, work) };
    }
  }
  const sealed = seal(revision);
  run(process.execPath, ["scripts/manuals/seal-corpus-assets.mjs", "--verify"]);
  let tests = "생략";
  if (!flag("skip-tests")) {
    const testFiles = fs.readdirSync(path.join(SITE, "lib")).filter((file) => /^(manual|manuals|mcp-manuals|welfare100-manual).*\.test\.mjs$/.test(file)).map((file) => "lib/" + file);
    const result = run(process.execPath, ["--experimental-strip-types", "--test", ...testFiles], { allowFailure: true });
    const summary = (result.stdout.match(/ℹ (tests|pass|fail) \d+/g) ?? []).join(", ");
    if (result.status !== 0) fail("매뉴얼 시험 실패: " + summary + "\n" + result.stdout.slice(-4000));
    const tsc = run(process.execPath, [path.join(SITE, "node_modules/typescript/bin/tsc"), "--noEmit"], { allowFailure: true });
    if (tsc.status !== 0) fail("타입 검사 실패\n" + tsc.stdout.slice(-3000));
    tests = summary + ", tsc 통과";
  }
  const report = { checked_at: checkedAt, bokjitalk_commit: commit, manifest: manifestName, revision, source_files: files, pack: JSON.parse(pack.stdout.trim().split("\n").at(-1)), identity_migration: identity, page_inventory_added: inventory, welfare100, seal: sealed, tests };
  const qaDir = path.join(SITE, "docs/qa/manual-corpus-update-" + manifest.update.replaceAll("-", ""));
  fs.mkdirSync(qaDir, { recursive: true });
  fs.writeFileSync(path.join(qaDir, "summary.json"), JSON.stringify(report, null, 1) + "\n");
  console.log(JSON.stringify({ ...report, next: sealed.keyRotated ? "키를 새로 만들었습니다. 배포 전에 Sites 비밀값 MANUAL_CORPUS_KEY를 자격 증명 관리자의 값으로 바꾸세요(UPDATE.md 4단계)." : "Sites 배포 후 --verify-live로 운영 반입을 확인하세요(UPDATE.md 5단계)." }, null, 1));
}

main().catch((error) => { console.error("오류: " + error.message); process.exit(2); });
