#!/usr/bin/env node
// 공개 read-only MCP 회귀평가. 인증 토큰·관리자 API·배포 작업은 사용하지 않는다.
// node scripts/mcp/run-golden-qa.mjs --endpoint https://example/mcp --output /tmp/qa
// node scripts/mcp/run-golden-qa.mjs --records-input native.jsonl --output /tmp/qa
import { appendFile, mkdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { evaluateRecord, evaluationProfile, FAQ_PROFILE, isAdmissibleCandidate, recordsCsv, renderReport, summarize, unwrapToolResult, validateGolden } from "./evaluate-golden-qa.mjs";
import { loadFaqTestSuite } from "./faq-test-suite.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const ACTIVE_BENCHMARK = path.join(ROOT, "quality/active-benchmark.json");
const DEFAULT_ENDPOINT = "https://integrated-care-national-dashboard.xgfox54.chatgpt.site/mcp";
const iso = () => new Date().toISOString();
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const formatError = (error) => ({ code: typeof error?.code === "string" ? error.code : error?.name ?? "ERROR", message: String(error?.message ?? error).slice(0, 1000), ...(error?.http_status ? { http_status: error.http_status } : {}) });

function help() {
  console.log(`복지정보MCP 골든 QA 검색·근거 회귀평가

--endpoint URL            공개 MCP HTTP 주소 (기본 운영 /mcp)
--golden FILE             명시적 테스트셋 JSON (기본 quality/active-benchmark.json의 FAQ 200)
--output DIR              결과 폴더
--concurrency N           문항 병렬수 1~8 (기본 2)
--limit N                 1~10,000개 부분 실행. 생략하면 전체 문항
--timeout-ms N            요청당 제한 1,000~60,000ms (기본 25,000)
--retries N               추가 재시도 0~3회 (기본 2)
--min-interval-ms N        요청 사이 최소 간격 (기본 1,100ms)
--records-input FILE      native 또는 HTTP 원 응답 JSONL을 오프라인 평가
--help                    도움말

records-input 형식:
 {kind:"status",phase:"start"|"end",at:"ISO",dataset_status:MCP결과,integration_status:MCP결과,initialize:JSONRPC결과}
 {kind:"record",id:"WFAQ-001",question:"원문",search:{arguments:{query:"원문"},result:MCP결과},fetched:[{id:"manual:revision:section",rank:1,result:MCP결과}],attempts:[]}
다른 문항의 원 응답을 대체하지 않으며, 누락 문항은 NOT_RUN으로 남깁니다.
출력: records.jsonl, summary.json, results.csv, REPORT.md, latest.json
숫자/연도는 컨텍스트 검사이며 최종 답변 정답률은 NOT_EVALUATED입니다.`);
}

export function parseArgs(argv) {
  const values = {};
  const valid = new Set(["endpoint", "golden", "output", "concurrency", "limit", "timeout-ms", "retries", "min-interval-ms", "records-input"]);
  for (let i = 0; i < argv.length; i += 1) {
    const argument = argv[i];
    if (argument === "--help") return { help: true };
    if (!argument.startsWith("--") || !valid.has(argument.slice(2))) throw new Error("알 수 없는 옵션: " + argument);
    if (argv[i + 1] === undefined || argv[i + 1].startsWith("--")) throw new Error("옵션 값이 없습니다: " + argument);
    values[argument.slice(2)] = argv[++i];
  }
  const integer = (key, fallback, min, max) => {
    const value = values[key] === undefined ? fallback : Number(values[key]);
    if (!Number.isInteger(value) || value < min || value > max) throw new Error(`${key}는 ${min}~${max} 정수여야 합니다.`);
    return value;
  };
  const endpoint = new URL(values.endpoint ?? DEFAULT_ENDPOINT);
  if (!(["https:", "http:"].includes(endpoint.protocol)) || endpoint.username || endpoint.password) throw new Error("인증정보 없는 HTTP(S) 주소가 필요합니다.");
  if (endpoint.protocol === "http:" && !["localhost", "127.0.0.1", "[::1]"].includes(endpoint.hostname)) throw new Error("외부 주소는 HTTPS를 사용하세요.");
  return {
    endpoint: endpoint.toString(), golden: values.golden ? path.resolve(values.golden) : null,
    output: path.resolve(values.output ?? path.join(ROOT, "docs/qa", "golden-qa-" + iso().replace(/[:.]/g, "-"))),
    concurrency: integer("concurrency", 2, 1, 8), limit: values.limit === undefined ? null : integer("limit", 200, 1, 10000),
    timeoutMs: integer("timeout-ms", 25_000, 1_000, 60_000), retries: integer("retries", 2, 0, 3),
    minIntervalMs: integer("min-interval-ms", 1_100, 0, 60_000), recordsInput: values["records-input"] ? path.resolve(values["records-input"]) : null,
  };
}

export async function loadBenchmark(options) {
  const manifest = options.golden ? null : JSON.parse(await readFile(ACTIVE_BENCHMARK, "utf8"));
  const filename = options.golden ?? path.resolve(ROOT, manifest.path);
  const fileText = await readFile(filename, "utf8");
  const input = JSON.parse(fileText);
  const isSuite = input.schema_version === "faq-test-suite-1";
  const golden = isSuite ? await loadFaqTestSuite(filename) : validateGolden(input);
  const text = isSuite ? JSON.stringify(golden) : fileText;
  const sha256 = createHash("sha256").update(text).digest("hex");
  const profile = evaluationProfile(golden);
  if (manifest) {
    if (manifest.sha256 !== sha256) throw new Error("활성 테스트셋 SHA가 manifest와 다릅니다.");
    if (manifest.count !== golden.items.length || manifest.dataset_id !== golden.dataset_id || manifest.version !== golden.version || manifest.evaluation_profile !== profile) throw new Error("활성 테스트셋 ID·버전·개수·프로필이 manifest와 다릅니다.");
  }
  return { golden, filename, text, sha256, profile, selection: manifest ? "active_manifest" : "explicit_golden_argument" };
}

export function validateInputQuestion(item, raw, profile) {
  if (!raw) return;
  if (raw.question !== undefined && raw.question !== item.question) throw new Error("테스트 질문과 원 응답 질문이 다릅니다: " + item.id);
  const query = raw.search?.arguments?.query;
  if (query !== undefined && query !== item.question) throw new Error("테스트 질문과 실제 search 입력이 다릅니다: " + item.id);
  if (profile === FAQ_PROFILE && !["NOT_RUN", "BLOCKED_PRECHECK"].includes(raw.status) && typeof query !== "string") throw new Error("FAQ 원문 대조를 위한 search.arguments.query가 없습니다: " + item.id);
}

function parseResponse(text, contentType) {
  if (!contentType.includes("text/event-stream")) return JSON.parse(text);
  const messages = text.split(/\r?\n\r?\n/).map((block) => block.split(/\r?\n/).filter((line) => line.startsWith("data:")).map((line) => line.slice(5).trim()).join("\n")).filter(Boolean);
  for (const message of messages.reverse()) { const parsed = JSON.parse(message); if (parsed.result || parsed.error) return parsed; }
  throw new Error("SSE에 JSON-RPC 결과가 없습니다.");
}

export class PublicMcpClient {
  constructor(options, fetcher = globalThis.fetch, dispatcher = undefined) {
    this.options = options; this.fetcher = fetcher; this.dispatcher = dispatcher;
    this.nextAt = 0; this.blockedUntil = 0; this.rpcId = 0; this.calls = 0; this.stop = new AbortController();
  }
  async waitSlot() {
    const at = Math.max(Date.now(), this.nextAt, this.blockedUntil);
    this.nextAt = at + this.options.minIntervalMs;
    let left = at - Date.now();
    while (left > 0) {
      if (this.stop.signal.aborted) throw new Error("실행 중단");
      await sleep(Math.min(30_000, left));
      left = Math.max(at, this.blockedUntil) - Date.now();
    }
  }
  async rpc(method, params) {
    if (method !== "initialize" && (method !== "tools/call" || !["search", "fetch", "get_dataset_status", "get_integration_status"].includes(params?.name))) throw new Error("평가기의 읽기 전용 도구 허용목록 밖 요청입니다.");
    const attempts = [];
    for (let attempt = 0; attempt <= this.options.retries; attempt += 1) {
      try { await this.waitSlot(); } catch (error) { return { error: formatError(error), attempts }; }
      const started = Date.now(); let status = null;
      try {
        this.calls += 1;
        const response = await this.fetcher(this.options.endpoint, {
          method: "POST", headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
          body: JSON.stringify({ jsonrpc: "2.0", id: ++this.rpcId, method, params }),
          signal: AbortSignal.any([AbortSignal.timeout(this.options.timeoutMs), this.stop.signal]),
          ...(this.dispatcher ? { dispatcher: this.dispatcher } : {}),
          redirect: "error",
        });
        status = response.status;
        const text = await response.text();
        let body;
        try { body = parseResponse(text, response.headers.get("content-type") ?? ""); } catch { body = null; }
        const parsed = method === "tools/call" && body ? unwrapToolResult(body) : null;
        const rateLimited = status === 429 || parsed?.error?.code === "RATE_LIMITED";
        const transient = rateLimited || status >= 500;
        if (transient) {
          const header = response.headers.get("retry-after");
          const seconds = header && /^\d+$/.test(header) ? Number(header) : header ? Math.max(0, (Date.parse(header) - Date.now()) / 1000) : Number(parsed?.error?.retry_after_seconds ?? 0);
          const delay = Math.max(rateLimited ? 1_000 : 500, Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 + 500 : 1_000 * 2 ** attempt);
          attempts.push({ attempt: attempt + 1, at: new Date(started).toISOString(), http_status: status, latency_ms: Date.now() - started, error: parsed?.error ?? { code: "HTTP_" + status }, retry_delay_ms: delay });
          if (attempt < this.options.retries && delay <= 60_000) { this.blockedUntil = Math.max(this.blockedUntil, Date.now() + delay); continue; }
          return { error: { code: rateLimited ? "RATE_LIMITED" : "HTTP_" + status, http_status: status, message: delay > 60_000 ? "요청된 Retry-After가 평가기의 60초 대기 한도를 초과하여 재시도하지 않았습니다." : "제한된 재시도 횟수를 소진했습니다." }, attempts };
        }
        if (!response.ok || !body) return { error: { code: "HTTP_" + status, http_status: status, message: (!body ? text : body.error?.message ?? text).slice(0, 500) }, attempts: [...attempts, { attempt: attempt + 1, at: new Date(started).toISOString(), http_status: status, latency_ms: Date.now() - started }] };
        attempts.push({ attempt: attempt + 1, at: new Date(started).toISOString(), http_status: status, latency_ms: Date.now() - started });
        return { result: method === "tools/call" ? body.result : body, ...(body.error ? { error: body.error } : {}), attempts };
      } catch (error) {
        attempts.push({ attempt: attempt + 1, at: new Date(started).toISOString(), http_status: status, latency_ms: Date.now() - started, error: formatError(error) });
        if (this.stop.signal.aborted || attempt === this.options.retries) return { error: formatError(error), attempts };
        this.blockedUntil = Math.max(this.blockedUntil, Date.now() + 500 * 2 ** attempt);
      }
    }
    return { error: { code: "ATTEMPTS_EXHAUSTED" }, attempts };
  }
  tool(name, args = {}) { return this.rpc("tools/call", { name, arguments: args }); }
}

async function statusSnapshot(client, phase) {
  const initialize = await client.rpc("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "welfare-golden-qa", version: "1.0.0" } });
  // 401/403에서 다른 경로나 토큰으로 우회하지 않는다.
  if ([401, 403].includes(initialize.error?.http_status)) return { kind: "status", phase, at: iso(), initialize, dataset_status: { error: initialize.error }, integration_status: { error: initialize.error } };
  const dataset = await client.tool("get_dataset_status");
  const integration = await client.tool("get_integration_status");
  return { kind: "status", phase, at: iso(), initialize: initialize.result ?? initialize, dataset_status: dataset.result ?? dataset, integration_status: integration.result ?? integration };
}

async function atomicJson(filename, value) {
  await writeFile(filename + ".tmp", JSON.stringify(value, null, 2) + "\n");
  await rename(filename + ".tmp", filename);
}

export async function readNativeRecords(filename) {
  const text = await readFile(filename, "utf8");
  const lines = text.trim().startsWith("[") ? JSON.parse(text) : text.split(/\r?\n/).filter((line) => line.trim()).map((line, index) => { try { return JSON.parse(line); } catch { throw new Error(`입력 JSONL ${index + 1}행 파싱 실패`); } });
  const statuses = lines.filter((row) => row.kind === "status");
  const rows = lines.filter((row) => row.kind !== "status");
  const duplicate = rows.find((row, index) => rows.findIndex((other) => other.id === row.id) !== index);
  if (duplicate) throw new Error("입력에 문항 ID가 중복되어 있습니다: " + duplicate.id);
  return { rows, start: statuses.find((row) => row.phase === "start") ?? null, end: statuses.findLast((row) => row.phase === "end") ?? null };
}

export async function main(argv = process.argv.slice(2), dependencies = {}) {
  const options = parseArgs(argv); if (options.help) { help(); return; }
  const benchmark = await loadBenchmark(options), golden = benchmark.golden;
  const items = options.limit ? golden.items.slice(0, options.limit) : golden.items;
  await mkdir(options.output, { recursive: true });
  const recordsFile = path.join(options.output, "records.jsonl");
  try { await stat(recordsFile); throw new Error("기존 records.jsonl을 덮어쓰지 않습니다. 새 --output을 지정하세요."); } catch (error) { if (error.code !== "ENOENT") throw error; }
  const runId = "golden-qa-" + iso().replace(/[:.]/g, "-");
  const records = []; let start = null, end = null, interrupted = false, client = null, dispatcher = null, journal = Promise.resolve();
  const persist = async (item, raw) => { validateInputQuestion(item, raw, benchmark.profile); const evaluated = evaluateRecord(item, raw, { evaluation_profile: benchmark.profile }); records.push(evaluated); journal = journal.then(() => appendFile(recordsFile, JSON.stringify(evaluated) + "\n")); await journal; return evaluated; };
  if (options.recordsInput) {
    const input = await readNativeRecords(options.recordsInput); start = input.start; end = input.end;
    const allowed = new Set(golden.items.map((item) => item.id));
    if (input.rows.some((row) => !allowed.has(row.id))) throw new Error("골든셋에 없는 문항 ID가 입력에 있습니다.");
    for (const item of items) {
      const raw = input.rows.find((row) => row.id === item.id);
      if (raw?.dataset_id && raw.dataset_id !== golden.dataset_id) throw new Error("테스트셋 ID와 원 응답 데이터셋이 다릅니다: " + item.id);
      await persist(item, raw ?? { id: item.id, status: "NOT_RUN", search: { error: { code: "MISSING_INPUT_RECORD" } }, fetched: [] });
    }
    await writeFile(path.join(options.output, "input-records.jsonl"), await readFile(options.recordsInput));
  } else {
    let fetcher = dependencies.fetcher ?? globalThis.fetch;
    if (!dependencies.fetcher && (process.env.HTTPS_PROXY || process.env.https_proxy || process.env.HTTP_PROXY || process.env.http_proxy)) {
      const undici = await import("undici"); dispatcher = new undici.EnvHttpProxyAgent(); fetcher = undici.fetch;
    }
    client = new PublicMcpClient(options, fetcher, dispatcher);
    const stop = () => { interrupted = true; client.stop.abort(); };
    process.once("SIGINT", stop); process.once("SIGTERM", stop);
    try {
      start = await statusSnapshot(client, "start");
      await atomicJson(path.join(options.output, "status-start.json"), start);
      const check = unwrapToolResult(start.dataset_status);
      if (!check.ok) {
        for (const item of items) await persist(item, { id: item.id, question: item.question, status: "BLOCKED_PRECHECK", search: { error: check.error }, fetched: [] });
      } else {
        let index = 0; const fetchCache = new Map();
        const fetchId = (id) => { if (!fetchCache.has(id)) fetchCache.set(id, client.tool("fetch", { id })); return fetchCache.get(id); };
        await Promise.all(Array.from({ length: options.concurrency }, async () => {
          while (!interrupted) {
            const item = items[index++]; if (!item) break;
            const began = Date.now(); const search = await client.tool("search", { query: item.question });
            const parsed = unwrapToolResult(search.result ?? search);
            const candidates = parsed.ok && Array.isArray(parsed.data?.results) ? parsed.data.results.slice(0, 5).map((hit, index) => ({ hit, rank: index + 1 })).filter(({ hit }) => benchmark.profile !== FAQ_PROFILE || isAdmissibleCandidate(hit)) : [];
            const fetched = [];
            for (const { hit, rank } of candidates) {
              const cached = fetchCache.has(hit.id); const detail = await fetchId(hit.id);
              fetched.push({ rank, id: hit.id, ...detail, from_cache: cached });
            }
            await persist(item, { kind: "record", id: item.id, question: item.question, transport: "http", started_at: new Date(began).toISOString(), completed_at: iso(), search: { tool: "search", arguments: { query: item.question }, ...search }, fetched, latency_ms: Date.now() - began });
            if (records.length % 10 === 0) console.log(JSON.stringify({ progress: records.length, total: items.length, http_requests: client.calls, at: iso() }));
          }
        }));
      }
      for (const item of items.filter((item) => !records.some((record) => record.id === item.id))) await persist(item, { id: item.id, question: item.question, status: "NOT_RUN", search: { error: { code: "INTERRUPTED" } }, fetched: [] });
      end = interrupted ? { kind: "status", phase: "end", at: iso(), interrupted: true } : await statusSnapshot(client, "end");
      await atomicJson(path.join(options.output, "status-end.json"), end);
    } finally {
      process.removeListener("SIGINT", stop); process.removeListener("SIGTERM", stop);
      if (dispatcher) await dispatcher.close();
    }
  }
  records.sort((a, b) => a.id.localeCompare(b.id));
  const summary = summarize(records, { run_id: runId, transport: options.recordsInput ? "native_records_import" : "http", endpoint: options.endpoint, total_golden_items: golden.items.length, evaluation_profile: benchmark.profile, expected_ids: golden.items.map((item) => item.id), start, end });
  summary.golden = { version: golden.version, sha256: benchmark.sha256, filename: benchmark.filename };
  summary.benchmark = { dataset_id: golden.dataset_id ?? "welfare_golden_qa_v" + golden.version, version: golden.version, evaluation_profile: benchmark.profile, sha256: benchmark.sha256, filename: benchmark.filename, selection: benchmark.selection, source_workbook_sha256: golden.source_workbook?.sha256 ?? null };
  if (golden.source_suite) summary.benchmark.source_suite = golden.source_suite;
  summary.interrupted = interrupted;
  summary.records_input = options.recordsInput;
  summary.records_input_copy = options.recordsInput ? "input-records.jsonl" : null;
  await atomicJson(path.join(options.output, "summary.json"), summary);
  await writeFile(path.join(options.output, "results.csv"), recordsCsv(records));
  await writeFile(path.join(options.output, "REPORT.md"), renderReport(summary, records));
  await atomicJson(path.join(options.output, "latest.json"), { run_id: runId, completed_at: summary.completed_at, benchmark: summary.benchmark, records: "records.jsonl", summary: "summary.json", csv: "results.csv", report: "REPORT.md", selected_items: records.length, answer_correctness: "NOT_EVALUATED", human_review: "PENDING" });
  console.log(JSON.stringify({ output: options.output, benchmark: summary.benchmark, total: records.length, search_success: summary.search_execution.count, nonempty: summary.nonempty_search.count, program_recall_at_5: summary.program_recall_at[5], ...(benchmark.profile === FAQ_PROFILE ? { manual_section_at_5: summary.faq_observation.manual_section_at[5], full_collection_complete: summary.full_collection_complete } : {}), answer_correctness: summary.answer_correctness, consistency: summary.consistency.status }));
  if (interrupted || summary.search_execution.count < records.length || (benchmark.profile === FAQ_PROFILE && !summary.selected_collection_complete)) process.exitCode = 2;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch((error) => { console.error("골든 QA 평가 실패: " + String(error?.message ?? error)); process.exitCode = 1; });
