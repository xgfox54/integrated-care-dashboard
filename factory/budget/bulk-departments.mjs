import { readFileSync, writeFileSync, mkdirSync, existsSync, renameSync, openSync, closeSync, unlinkSync } from "node:fs";
import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { officialAttachments, organisationDepartments, documentRows, matchCorpus } from "./department-corpus.mjs";

const repo = fileURLToPath(new URL("../../", import.meta.url));
const digest = (value) => createHash("sha256").update(value).digest("hex");
const read = (file) => JSON.parse(readFileSync(file, "utf8").replace(/^\uFEFF/u, ""));
function json(file, data) { mkdirSync(path.dirname(file), { recursive: true }); writeFileSync(file + ".tmp", JSON.stringify(data, null, 2)); renameSync(file + ".tmp", file); }
const relative = (root, file) => path.relative(root, file).replaceAll("\\", "/");
function artifact(root, file) { const bytes = readFileSync(file); return { path: relative(root, file), bytes: bytes.length, sha256: digest(bytes) }; }
function verify(root, item) { if (!item || !existsSync(path.join(root, item.path)) || digest(readFileSync(path.join(root, item.path))) !== item.sha256) throw Error("ARTIFACT_INTEGRITY_FAILED"); }

async function request(url, maxBytes) {
  if (new URL(url).protocol !== "https:") throw Error("HTTPS_REQUIRED");
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(90000), redirect: "error" });
      if (!response.ok) throw Error("HTTP_" + response.status);
      if (Number(response.headers.get("content-length") ?? 0) > maxBytes) throw Error("RESPONSE_TOO_LARGE");
      const reader = response.body.getReader(), chunks = []; let size = 0;
      while (true) { const { done, value } = await reader.read(); if (done) break; size += value.length; if (size > maxBytes) { await reader.cancel(); throw Error("RESPONSE_TOO_LARGE"); } chunks.push(value); }
      return Buffer.concat(chunks);
    } catch (error) { if (attempt === 2 || error.message === "RESPONSE_TOO_LARGE") throw error; }
  }
}

async function parsePdf(file, sha, first, last, output) {
  await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["--max-old-space-size=1024", "--import", pathToFileURL(path.join(repo, "factory/hwp-parser/src/net-guard.mjs")).href, path.join(repo, "factory/budget/parse-department-source.mjs"), file, sha, String(first), String(last), output], { cwd: repo, windowsHide: true, stdio: ["ignore", "ignore", "ignore"], timeout: 600000 });
    child.once("error", () => reject(Error("PARSER_START_FAILED")));
    child.once("exit", (code) => code === 0 ? resolve() : reject(Error("PARSER_EXIT_" + code)));
  });
}

function signature(data) { return JSON.stringify([data.total, data.size, data.snapshot, data.snapshots ?? null]); }
export function departmentTocRange(toc) {
  const range = toc.page_range ?? { first: 1, last: 250 };
  if (!Number.isInteger(range.first) || !Number.isInteger(range.last) || range.first < 1 || range.last < range.first || range.last > 5000 || range.last - range.first >= 250) throw Error("INVALID_DEPARTMENT_TOC_RANGE");
  return range;
}
export function validateApiPage(data, config, year, expectedSignature) {
  if (!data.snapshot?.complete || !Array.isArray(data.items) || data.unavailable || !Number.isInteger(data.total) || !Number.isInteger(data.size) || data.size < 1) throw Error("INCOMPLETE_PUBLIC_SNAPSHOT");
  if (expectedSignature && signature(data) !== expectedSignature) throw Error("SNAPSHOT_CHANGED_NEW_RUN_REQUIRED");
  for (const item of data.items) if (item.fiscal_entity?.fiscal_entity_id !== config.fiscal_entity_id || item.fiscal_entity.name !== config.fiscal_entity_name || item.fiscal_year !== year || !/^\d{4}-\d{2}-\d{2}$/u.test(item.reference_date ?? "")) throw Error("API_SCOPE_MISMATCH");
}

async function run(configFile, root, entityId, maxDocuments) {
  const configBytes = readFileSync(configFile), config = JSON.parse(configBytes);
  const entity = config.entities.find((e) => e.id === entityId);
  if (!entity || !/^[a-z0-9-]+$/u.test(entityId) || entity.stage !== "adopted_initial" || entity.amount_unit !== "천원") throw Error("UNREVIEWED_ENTITY_PROFILE");
  mkdirSync(root, { recursive: true });
  const lockFile = path.join(root, ".lock");
  if (existsSync(lockFile)) {
    const lock = read(lockFile); let live = true;
    try { process.kill(lock.pid, 0); } catch (error) { if (error.code === "ESRCH") live = false; else throw Error("LOCK_OWNER_UNKNOWN"); }
    if (live) throw Error("RUN_ALREADY_ACTIVE");
    unlinkSync(lockFile);
  }
  const fd = openSync(lockFile, "wx"); writeFileSync(fd, JSON.stringify({ pid: process.pid })); closeSync(fd);
  const stateFile = path.join(root, entityId, "state.json");
  const state = existsSync(stateFile) ? read(stateFile) : { schema: "department-bulk-state-v1", entity: entityId, config_sha256: digest(configBytes), status: "NEW", downloads: {}, parses: {}, api_pages: {}, history: [] };
  const save = (status) => { state.status = status; state.updated_at = new Date().toISOString(); json(stateFile, state); };
  const startedAt = new Date().toISOString();
  let reused = 0, downloaded = 0, parsed = 0, apiFetched = 0;
  try {
    if (state.config_sha256 !== digest(configBytes)) throw Error("CONFIG_CHANGED_NEW_RUN_REQUIRED");
    const parserHash = digest(Buffer.concat([readFileSync(path.join(repo, "factory/budget/parse-department-source.mjs")), readFileSync(path.join(repo, "factory/hwp-parser/parser-pin.json"))]));
    if (state.parser_sha256 && state.parser_sha256 !== parserHash) throw Error("PARSER_CHANGED_NEW_RUN_REQUIRED");
    state.parser_sha256 = parserHash;
    const mappingFile = path.join(repo, "components/budget/budget-department-names.json");
    const baseline = path.join(root, "baseline-mappings.json");
    if (!existsSync(baseline)) { writeFileSync(baseline, readFileSync(mappingFile)); }
    if (!state.baseline) state.baseline = artifact(root, baseline);
    verify(root, state.baseline);
    const inventoryFile = path.join(root, "national-inventory.json");
    if (!existsSync(inventoryFile)) {
      const url = config.public_api + "?mode=social_welfare&view=filters";
      const payload = JSON.parse((await request(url, 8 * 1024 * 1024)).toString());
      if (!payload.filters?.entities || !payload.filters?.departments) throw Error("INVALID_NATIONAL_INVENTORY");
      json(inventoryFile, { retrieved_at: new Date().toISOString(), url, ...payload });
    }
    const national = read(inventoryFile).filters;
    const queue = national.entities.map((e) => ({ ...e, profile: config.entities.find((p) => p.fiscal_entity_id === e.id)?.id ?? null, execution_condition: config.entities.some((p) => p.fiscal_entity_id === e.id) ? "REGISTERED" : "OFFICIAL_2026_ADOPTED_INDEX_AND_PARSER_PROFILE_REQUIRED" }));
    json(path.join(root, "queue.json"), { generated_at: new Date().toISOString(), units: queue });
    save("INDEX");
    const indexFile = path.join(root, entityId, "official-index.html");
    if (!state.index) { writeFileSync(indexFile, await request(entity.index_url, 8 * 1024 * 1024)); state.index = artifact(root, indexFile); save("INDEX"); }
    verify(root, state.index);
    if (entity.download_resolver) {
      const resolver = entity.download_resolver;
      if (new URL(resolver.url).origin !== new URL(entity.index_url).origin || !/^[a-f0-9]{64}$/u.test(resolver.sha256)) throw Error("INVALID_DOWNLOAD_RESOLVER");
      if (!state.download_resolver) {
        const bytes = await request(resolver.url, 2 * 1024 * 1024);
        if (digest(bytes) !== resolver.sha256) throw Error("OFFICIAL_DOWNLOAD_RESOLVER_CHANGED");
        const file = path.join(root, entityId, "official-download-resolver.js");
        writeFileSync(file, bytes); state.download_resolver = { ...artifact(root, file), url: resolver.url }; save("DOWNLOAD_RESOLVER_VERIFIED");
      }
      verify(root, state.download_resolver);
      if (state.download_resolver.sha256 !== resolver.sha256) throw Error("OFFICIAL_DOWNLOAD_RESOLVER_CHANGED");
    }
    const documents = officialAttachments(readFileSync(indexFile, "utf8"), entity).map((d) => ({ ...d, index_sha256: state.index.sha256 }));
    if (entity.department_toc) {
      const file = path.join(root, entityId, "raw", "department-toc.pdf");
      if (!state.department_toc) {
        const bytes = await request(entity.department_toc.url, 64 * 1024 * 1024);
        if (bytes.subarray(0, 5).toString() !== "%PDF-") throw Error("NOT_PDF");
        mkdirSync(path.dirname(file), { recursive: true }); writeFileSync(file, bytes);
        state.department_toc = { ...artifact(root, file), url: entity.department_toc.url, retrieved_at: new Date().toISOString() }; downloaded++; save("DEPARTMENT_TOC");
      } else { verify(root, state.department_toc); reused++; }
      const key = "department-toc", output = path.join(root, entityId, "parsed", key);
      if (!state.parses[key]) {
        const range = departmentTocRange(entity.department_toc);
        await parsePdf(file, state.department_toc.sha256, range.first, range.last, output);
        const count = read(path.join(output, "parse-summary.json")).pageCount;
        if (!Number.isInteger(count) || count < (entity.department_toc.page_range ? range.last : 1) || count > (entity.department_toc.page_range ? 5000 : 250)) throw Error("DEPARTMENT_TOC_PAGE_LIMIT");
        state.parses[key] = ["parse-summary.json", "document.json", "tables.jsonl"].map((name) => artifact(root, path.join(output, name)));
        parsed++; save("DEPARTMENT_TOC_PARSED");
      } else { for (const item of state.parses[key]) verify(root, item); reused++; }
      const summary = organisationDepartments({ blocks: read(path.join(output, "document.json")).blocks, tables: readFileSync(path.join(output, "tables.jsonl"), "utf8").trim().split("\n").filter(Boolean).map(JSON.parse) }, config.year, entity.department_toc.account_name);
      for (const document of documents) {
        document.toc_names = summary.names;
        document.department_toc = { source_url: state.department_toc.url, raw_sha256: state.department_toc.sha256, ...(entity.department_toc.page_range ? { page_range: entity.department_toc.page_range } : {}), locations: summary.locations };
      }
    }
    json(path.join(root, entityId, "document-inventory.json"), { index_url: entity.index_url, index_sha256: state.index.sha256, fiscal_year: config.year, account: entity.account_name, documents });
    let completedThisRun = 0;
    for (const doc of documents) {
      if (completedThisRun >= maxDocuments) { save("PAUSED_DOCUMENT_BUDGET"); return { status: state.status, reused, downloaded, parsed, apiFetched }; }
      const pdf = path.join(root, entityId, "raw", doc.id + ".pdf");
      if (!state.downloads[doc.id]) {
        save("DOWNLOADING"); const bytes = await request(doc.url, 64 * 1024 * 1024);
        if (bytes.subarray(0, 5).toString() !== "%PDF-") throw Error("NOT_PDF");
        mkdirSync(path.dirname(pdf), { recursive: true }); writeFileSync(pdf, bytes);
        state.downloads[doc.id] = { ...artifact(root, pdf), url: doc.url, retrieved_at: new Date().toISOString() }; downloaded++; save("DOWNLOADED");
      } else { verify(root, state.downloads[doc.id]); reused++; }
      doc.sha256 = state.downloads[doc.id].sha256;
      const probeKey = doc.id + "-probe", probe = path.join(root, entityId, "parsed", probeKey);
      const parse = async (key, first, last, output) => {
        if (state.parses[key]) { for (const item of state.parses[key]) verify(root, item); reused++; return; }
        save("PARSING"); await parsePdf(pdf, doc.sha256, first, last, output);
        state.parses[key] = ["parse-summary.json", "document.json", "tables.jsonl"].map((name) => artifact(root, path.join(output, name)));
        parsed++; save("PARSED_CHUNK");
      };
      await parse(probeKey, 1, 1, probe);
      const count = read(path.join(probe, "parse-summary.json")).pageCount;
      if (!Number.isInteger(count) || count < 1 || count > 5000) throw Error("INVALID_PAGE_COUNT");
      doc.page_count = count; doc.chunks = [];
      for (let first = 1; first <= count; first += 250) {
        const last = Math.min(count, first + 249), key = doc.id + "-" + first + "-" + last;
        await parse(key, first, last, path.join(root, entityId, "parsed", key)); doc.chunks.push(key);
      }
      completedThisRun++;
      console.log(JSON.stringify({ entity: entityId, documents_complete: completedThisRun, documents_total: documents.length, parser_chunks: parsed, reused }));
    }
    json(path.join(root, entityId, "documents.json"), documents);
    save("API");
    const apiUrl = (page) => config.public_api + "?" + new URLSearchParams({ mode: "department", region: entity.region, entity: entity.fiscal_entity_id, year: config.year, view: "main", page: String(page) });
    const first = JSON.parse((await request(apiUrl(1), 8 * 1024 * 1024)).toString()); apiFetched++;
    validateApiPage(first, entity, config.year, state.api_signature); state.api_signature = signature(first);
    const totalPages = Math.ceil(first.total / first.size);
    if (!totalPages || totalPages > 10000) throw Error("API_PAGE_RANGE_UNSUPPORTED");
    const getPage = async (page) => {
      if (state.api_pages[page]) { verify(root, state.api_pages[page]); const data = read(path.join(root, state.api_pages[page].path)); validateApiPage(data, entity, config.year, state.api_signature); reused++; return; }
      const data = page === 1 ? first : JSON.parse((await request(apiUrl(page), 8 * 1024 * 1024)).toString());
      if (page !== 1) apiFetched++;
      validateApiPage(data, entity, config.year, state.api_signature);
      if (data.page !== page || data.items.length !== Math.min(data.size, data.total - (page - 1) * data.size)) throw Error("API_PAGE_INCOMPLETE");
      const file = path.join(root, entityId, "api", page + ".json"); json(file, data); state.api_pages[page] = artifact(root, file); save("API");
    };
    for (let page = 1; page <= totalPages; page += 3) await Promise.all(Array.from({ length: Math.min(3, totalPages - page + 1) }, (_, i) => getPage(page + i)));
    const items = Object.keys(state.api_pages).sort((a, b) => Number(a) - Number(b)).flatMap((key) => read(path.join(root, state.api_pages[key].path)).items);
    if (items.length !== first.total || new Set(items.map((i) => i.fiscal_project_id)).size !== items.length) throw Error("API_DUPLICATE_OR_MISSING_ROWS");
    const final = JSON.parse((await request(apiUrl(1), 8 * 1024 * 1024)).toString()); apiFetched++;
    validateApiPage(final, entity, config.year, state.api_signature);
    const rows = [], pageAudit = [];
    for (const doc of documents) {
      const blocks = [], tables = [];
      for (const key of doc.chunks) {
        const dir = path.join(root, entityId, "parsed", key);
        blocks.push(...read(path.join(dir, "document.json")).blocks);
        tables.push(...readFileSync(path.join(dir, "tables.jsonl"), "utf8").trim().split("\n").filter(Boolean).map((line) => JSON.parse(line)));
      }
      const collected = documentRows(doc, { blocks, tables }, entity, config.year); rows.push(...collected.rows); pageAudit.push(...collected.audit);
    }
    const result = matchCorpus(items, rows);
    const report = { status: "REVIEW_REQUIRED", entity, matcher_sha256: digest(readFileSync(path.join(repo, "factory/budget/department-corpus.mjs"))), api_projects: items.length, api_signature: state.api_signature, api_dates: [...new Set(items.map((i) => i.reference_date))], documents: documents.length, pages: documents.reduce((n, d) => n + d.page_count, 0), document_rows: rows.length, page_audit: pageAudit, ...result };
    json(path.join(root, entityId, "matches.json"), report);
    state.report = artifact(root, path.join(root, entityId, "matches.json"));
    state.history.push({ started_at: startedAt, completed_at: new Date().toISOString(), reused, downloaded, parsed, apiFetched, candidates: result.mappings.length });
    delete state.error;
    save("REVIEW_REQUIRED");
    return { status: state.status, candidates: result.mappings.length, held: result.held.length, api_projects: items.length, documents: documents.length, reused, downloaded, parsed, apiFetched };
  } catch (error) {
    state.error = { code: /^[A-Z0-9_]+$/u.test(error.message) ? error.message : "IO_OR_NETWORK_FAILURE", at: new Date().toISOString() }; save("FAILED"); throw Error(state.error.code);
  } finally { unlinkSync(lockFile); }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [config, output, entity, limit] = process.argv.slice(2);
  if (!config || !output || !entity) throw Error("USAGE_config_output_entity_optionalMaxDocuments");
  console.log(JSON.stringify(await run(path.resolve(config), path.resolve(output), entity, limit ? Number(limit) : Infinity)));
}
