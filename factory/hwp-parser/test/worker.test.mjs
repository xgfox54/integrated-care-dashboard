// HWP/HWPX 워커 시험. 합성 fixture는 시험 중에 kordoc markdownToHwpx로 만들며 운영 데이터로 반입하지 않는다.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

import { Validator } from "@cfworker/json-schema";
import CFB from "cfb";
import { markdownToHwpx } from "kordoc";

import { multiplyDecimal } from "../src/normalize.mjs";
import { sha256Hex } from "../src/profile.mjs";
import { runJob } from "../src/run-job.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const packageRoot = path.join(here, "..");
const schema = (name) => new Validator(JSON.parse(readFileSync(path.join(packageRoot, "schema", name), "utf8")), "2020-12", false);

const SYNTHETIC = [
  "# 합성 시험 문서(운영 자료 아님)",
  "",
  "<table><tr><th rowspan=\"2\">구분</th><th colspan=\"2\">월 한도(천원)</th></tr><tr><th>기본</th><th>추가</th></tr>" +
    "<tr><td>가 사업</td><td>30</td><td></td></tr><tr><td>나 사업</td><td>1,200.5</td><td>-</td></tr><tr><td>합계</td><td>1,230.5</td><td>0</td></tr></table>",
  "",
  "※ 예외: 가 사업은 연 1회 지급",
  "",
].join("\n");

function workspace() {
  const root = mkdtempSync(path.join(tmpdir(), "wf-"));
  mkdirSync(path.join(root, "raw"));
  return root;
}

function writeJob(root, name, bytes, overrides = {}) {
  writeFileSync(path.join(root, "raw", name), bytes);
  const job = { job_id: "job-" + name.replace(/[^A-Za-z0-9]/g, ""), source_version_id: "sv-" + sha256Hex(bytes).slice(0, 12), input_ref: "raw/" + name, expected_sha256: sha256Hex(bytes), profile_id: "hwp-ingest", output_root: "parsed", ...overrides };
  const jobPath = path.join(root, "job-" + name + ".json");
  writeFileSync(jobPath, JSON.stringify(job));
  return jobPath;
}

function readJsonl(file) {
  return readFileSync(file, "utf8").split("\n").filter(Boolean).map((line) => JSON.parse(line));
}

test("합성 HWPX: 병합 머리행·단위 정규화·각주 행 범위·빈칸 상태를 계약대로 만든다", async () => {
  const root = workspace();
  const bytes = Buffer.from(await markdownToHwpx(SYNTHETIC));
  const outcome = await runJob({ jobPath: writeJob(root, "synthetic.hwpx", bytes), root });
  assert.equal(outcome.ok, true, JSON.stringify(outcome));
  assert.equal(outcome.status, "STRUCTURE_VALIDATED");
  const manifestCheck = schema("manifest.schema.json").validate(outcome.manifest);
  assert.ok(manifestCheck.valid, JSON.stringify(manifestCheck.errors.slice(0, 3)));
  assert.equal(outcome.manifest.parser.package_version, JSON.parse(readFileSync(path.join(packageRoot, "parser-pin.json"), "utf8")).package_version);
  assert.equal(outcome.manifest.detected_format, "hwpx");
  const dir = path.dirname(outcome.manifest_path);
  const tables = readJsonl(path.join(dir, "tables.jsonl"));
  assert.equal(tables.length, 1);
  const table = tables[0];
  const tableCheck = schema("table.schema.json").validate(table);
  assert.ok(tableCheck.valid, JSON.stringify(tableCheck.errors.slice(0, 3)));
  assert.equal(table.header_rows, 2);
  assert.equal(table.header_basis, "cell_header_marks_with_span_continuation");
  assert.deepEqual(table.header_paths[1].labels, ["월 한도(천원)", "기본"]);
  const cell = (row, col) => table.cells.find((item) => item.anchor_row === row && item.anchor_col === col);
  assert.equal(cell(0, 2), undefined, "병합으로 가려진 칸은 소유 셀이 아니다");
  assert.equal(cell(0, 1).col_span, 2);
  assert.equal(cell(2, 1).normalized_value.value, "30000");
  assert.equal(cell(2, 1).normalized_value.unit, "KRW");
  assert.equal(cell(2, 1).normalized_value.period, "month");
  assert.equal(cell(2, 1).normalized_value.display, "30000 KRW/month");
  assert.deepEqual(cell(2, 1).normalized_value.trace[1].header_cell_ids, [cell(0, 1).cell_id, cell(1, 1).cell_id]);
  assert.equal(cell(2, 1).parsed_text_verbatim, "30", "원래 문자열을 보존한다");
  assert.equal(cell(3, 1).normalized_value.value, "1200500");
  assert.equal(cell(2, 2).value_state, "empty");
  assert.equal(cell(3, 2).value_state, "unknown", "'-'는 0이나 해당없음으로 단정하지 않는다");
  assert.equal(cell(4, 2).value_state, "zero");
  assert.equal(table.row_roles.find((role) => role.row === 4).role, "total");
  assert.equal(table.footnote_refs[0].scope, "rows");
  assert.deepEqual(table.footnote_refs[0].rows, [2]);
  assert.ok(cell(2, 1).normalized_value.footnote_refs.length === 1);
  assert.equal(cell(3, 1).normalized_value.footnote_refs, undefined, "각주는 해당 행에만 연결한다");
  const quality = JSON.parse(readFileSync(path.join(dir, "quality.json"), "utf8"));
  assert.equal(quality.network_attempts, 0);
  assert.equal(quality.counts.covered_slots, 2);
  assert.equal(quality.promotion.auto_publish_allowed, false);
  const raw = readFileSync(path.join(dir, "raw-ir.json"), "utf8");
  assert.ok(!/data:image|imageData/.test(raw));
  const sourceMap = readJsonl(path.join(dir, "source-map.jsonl"));
  assert.ok(sourceMap.every((entry) => entry.locator_precision === "parsed_structural" && entry.physical_page_verified === false));
});

test("같은 원문·프로필은 같은 parse_id를 재사용하고 덮어쓰지 않는다", async () => {
  const root = workspace();
  const bytes = Buffer.from(await markdownToHwpx(SYNTHETIC));
  const jobPath = writeJob(root, "again.hwpx", bytes);
  const first = await runJob({ jobPath, root });
  const second = await runJob({ jobPath, root });
  assert.equal(first.parse_id, second.parse_id);
  assert.equal(second.reused, true);
  assert.equal(first.manifest.content_digest, second.manifest.content_digest);
  assert.deepEqual(readdirSync(path.join(root, "parsed")).filter((name) => name.startsWith(".tmp")), [], "임시 폴더가 남지 않는다");
});

test("작업 명세·입력 검증: 경로 탈출·해시 불일치·HTML 위장·상한 상향을 거절한다", async () => {
  const root = workspace();
  const bytes = Buffer.from(await markdownToHwpx(SYNTHETIC));
  const cases = [
    [writeJob(root, "a.hwpx", bytes, { input_ref: "../outside.hwpx" }), "PATH_REJECTED"],
    [writeJob(root, "b.hwpx", bytes, { expected_sha256: "0".repeat(64) }), "HASH_MISMATCH"],
    [writeJob(root, "c.hwpx", Buffer.from("<script>alert('파일이 없습니다');history.back();</script>")), "UNSUPPORTED_FORMAT"],
    [writeJob(root, "d.hwpx", bytes, { limits: { maxInputBytes: 999 * 1024 * 1024 } }), "JOB_INVALID"],
    [writeJob(root, "e.hwpx", bytes, { filePath: "C:/Windows/x.hwp" }), "JOB_INVALID"],
    [writeJob(root, "f.hwpx", bytes, { profile_id: "custom" }), "PROFILE_UNKNOWN"],
    // 쪽 범위: 상한(300쪽)보다 긴 범위·잘못된 모양은 거절한다(상한 우회 금지).
    [writeJob(root, "g.hwpx", bytes, { page_range: { first: 1, last: 301 } }), "JOB_INVALID"],
    [writeJob(root, "h.hwpx", bytes, { page_range: { first: 5, last: 4 } }), "JOB_INVALID"],
    [writeJob(root, "i.hwpx", bytes, { page_range: { first: 1, last: 2, extra: 1 } }), "JOB_INVALID"],
  ];
  for (const [jobPath, code] of cases) {
    const outcome = await runJob({ jobPath, root });
    assert.equal(outcome.ok, false);
    assert.equal(outcome.error_code, code, jobPath);
  }
});

test("HWP 3.x는 확장자와 무관하게 파일 머리 바이트로 hwp3로 판별하고 구조 검증 통과로 올리지 않는다(T52)", async () => {
  const root = workspace();
  const header = Buffer.concat([Buffer.from("HWP Document File V3.00 ", "latin1"), Buffer.from([0x1a, 1, 2, 3, 4, 5]), Buffer.alloc(4096)]);
  const outcome = await runJob({ jobPath: writeJob(root, "old.hwpx", header), root });
  assert.equal(outcome.ok, true);
  assert.equal(outcome.manifest.detected_format, "hwp3");
  assert.notEqual(outcome.status, "STRUCTURE_VALIDATED");
});

test("네트워크 차단 모듈은 fetch·DNS·TCP 접속을 모두 거절한다", () => {
  const guard = path.join(packageRoot, "src", "net-guard.mjs");
  const probe = "const net=require('node:net');const dns=require('node:dns');const out=[];" +
    "try{dns.lookup('example.com',()=>{});out.push('dns-leak')}catch(e){out.push(e.message)}" +
    "try{net.connect(80,'93.184.215.14');out.push('tcp-leak')}catch(e){out.push(e.message)}" +
    "fetch('https://example.com').then(()=>out.push('fetch-leak'),e=>out.push(e.message)).finally(()=>console.log(out.join('|')+'|attempts='+globalThis.__wfNetworkAttempts))";
  const result = spawnSync(process.execPath, ["--import", pathToFileURL(guard).href, "-e", probe], { encoding: "utf8", timeout: 20_000 });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /WF_NETWORK_BLOCKED:dns\.lookup/);
  assert.match(result.stdout, /WF_NETWORK_BLOCKED:net\.connect/);
  assert.match(result.stdout, /WF_NETWORK_BLOCKED:fetch/);
  assert.match(result.stdout, /attempts=3/);
  assert.doesNotMatch(result.stdout, /leak/);
});

test("시간 초과한 워커는 프로세스 트리를 끝내고 TIMEOUT을 돌려준다", async () => {
  const root = workspace();
  const bytes = Buffer.from(await markdownToHwpx(SYNTHETIC));
  const started = Date.now();
  const outcome = await runJob({ jobPath: writeJob(root, "slow.hwpx", bytes), root, timeoutMs: 1500, workerPath: path.join(here, "fixtures", "hang.mjs") });
  assert.equal(outcome.error_code, "TIMEOUT");
  assert.ok(Date.now() - started < 15_000);
});

// 실제 공개 문서 회귀표본: var/welfare-factory/raw/real/ 에 있을 때만 돈다(원문은 저장소에 올리지 않음).
const realDir = path.join(packageRoot, "..", "..", "var", "welfare-factory", "raw", "real");
const realFiles = existsSync(realDir) ? readdirSync(realDir).filter((name) => /\.hwpx?$/i.test(name)) : [];
test("실제 공개 HWP/HWPX 회귀표본은 네트워크 없이 구조 검증까지 마친다", { skip: realFiles.length === 0 ? "실제 표본 없음(var/welfare-factory/raw/real)" : false }, async () => {
  const root = workspace();
  for (const name of realFiles) {
    const bytes = readFileSync(path.join(realDir, name));
    const safe = sha256Hex(bytes).slice(0, 12) + path.extname(name).toLowerCase();
    copyFileSync(path.join(realDir, name), path.join(root, "raw", safe));
    const outcome = await runJob({ jobPath: writeJob(root, safe, bytes), root });
    assert.equal(outcome.ok, true, name + " " + JSON.stringify(outcome));
    assert.notEqual(outcome.status, "FAILED", name);
    const dir = path.dirname(outcome.manifest_path);
    const quality = JSON.parse(readFileSync(path.join(dir, "quality.json"), "utf8"));
    assert.equal(quality.network_attempts, 0);
    for (const table of readJsonl(path.join(dir, "tables.jsonl"))) {
      const check = schema("table.schema.json").validate(table);
      assert.ok(check.valid, name + " " + JSON.stringify(check.errors.slice(0, 2)));
    }
  }
});

test("소수 금액 정규화는 부동소수점 없이 정확히 곱한다", () => {
  assert.equal(multiplyDecimal("1200.5", "1000"), "1200500");
  assert.equal(multiplyDecimal("0.07", "10000"), "700");
  assert.equal(multiplyDecimal("-3.5", "1000000"), "-3500000");
  assert.equal(multiplyDecimal("12.345", "10"), "123.45");
});


test("형식은 확장자가 아니라 시그니처로 정한다: PDF는 kordoc으로 읽고 빈 결과는 실패로 남기며, 문서 구조가 아닌 ZIP·HTML 화면은 파싱 결과 없이 거절한다", async () => {
  const root = workspace();
  const emptyPdf = (note) => Buffer.from("%PDF-1.6\n%" + note + "\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[]/Count 0>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n", "latin1");
  // 쪽이 없는 PDF: kordoc 경로로 읽되 빈 결과를 성공(STRUCTURE_VALIDATED)으로 두지 않는다.
  const report = await runJob({ jobPath: writeJob(root, "report.pdf", emptyPdf("a")), root });
  assert.equal(report.ok, true, JSON.stringify(report));
  assert.equal(report.manifest.detected_format, "pdf");
  assert.equal(report.manifest.kordoc_detected_format, "pdf");
  assert.notEqual(report.status, "STRUCTURE_VALIDATED", "빈 PDF는 성공이 아니다");
  // 확장자 위장(.hwp 이름의 PDF): 시그니처대로 PDF로 판정하고 확장자 불일치를 기록한다.
  const disguised = await runJob({ jobPath: writeJob(root, "disguised.hwp", emptyPdf("b")), root });
  assert.equal(disguised.ok, true, JSON.stringify(disguised));
  assert.equal(disguised.manifest.detected_format, "pdf");
  assert.deepEqual(disguised.manifest.extension, { extension: "hwp", matches: false });
  // 같은 바이트를 다른 작업이 다시 맡으면 기존 산출물을 그대로 쓴다(덮어쓰지 않음).
  const again = await runJob({ jobPath: writeJob(root, "again.pdf", emptyPdf("a")), root });
  assert.equal(again.ok, true, JSON.stringify(again));
  assert.equal(again.reused, true);
  assert.equal(again.parse_id, report.parse_id);
  // 문서 구조가 아닌 ZIP, 원문 대신 저장된 HTML 오류 화면은 파싱하지 않는다.
  const local = Buffer.alloc(30 + 19 + 4);
  local.writeUInt32LE(0x04034b50, 0);
  local.write("[Content_Types].xml", 30, "latin1");
  const brokenZip = Buffer.concat([local, Buffer.from("<x/>")]);
  const html = Buffer.from("<!DOCTYPE html><html><body>로그인이 필요합니다</body></html>");
  for (const [name, bytes, codes] of [["sheet.hwpx", brokenZip, ["ZIP_INVALID", "ZIP_LIMIT", "UNSUPPORTED_FORMAT"]], ["notice.pdf", html, ["INPUT_IS_HTML"]]]) {
    const outcome = await runJob({ jobPath: writeJob(root, name, bytes), root });
    assert.equal(outcome.ok, false, name);
    assert.ok(codes.includes(outcome.error_code), name + ": " + outcome.error_code);
  }
  const parsed = readdirSync(path.join(root, "parsed")).filter((entry) => !entry.startsWith("."));
  assert.equal(parsed.length, 2, "PDF 두 건(같은 바이트 재사용 포함)만 산출물을 남긴다: " + parsed.join(", "));
});

test("PDF 쪽 범위를 지정하면 선언한 범위만 처리했다고 남기고, 같은 원문이라도 범위 없는 결과와 다른 parse_id를 쓴다", async () => {
  const root = workspace();
  const pdf = Buffer.from("%PDF-1.6\n%r\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[]/Count 0>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n", "latin1");
  const whole = await runJob({ jobPath: writeJob(root, "whole.pdf", pdf), root });
  const ranged = await runJob({ jobPath: writeJob(root, "ranged.pdf", pdf, { page_range: { first: 2, last: 3 } }), root });
  assert.equal(ranged.ok, true, JSON.stringify(ranged));
  assert.notEqual(ranged.parse_id, whole.parse_id);
  assert.deepEqual(ranged.manifest.page_scope.declared_range, { first: 2, last: 3 });
  assert.equal(ranged.manifest.profile.effective_options.pages, "2-3");
  assert.equal(ranged.manifest.raw_sha256, whole.manifest.raw_sha256, "원문 해시는 전체 파일 그대로");
  const hwpx = await runJob({ jobPath: writeJob(root, "x.hwpx", Buffer.from(await markdownToHwpx(SYNTHETIC)), { page_range: { first: 1, last: 1 } }), root });
  assert.equal(hwpx.ok, false, "쪽 범위는 PDF에만 쓴다");
});

test("HWPX 원본 XML에는 있는데 파서 결과에 없는 표(캡션 안 표 등)를 찾아 검토로 돌린다(T57·T76)", async () => {
  const { hwpxTableCoverage } = await import("../src/xml-check.mjs");
  const bytes = Buffer.from(await markdownToHwpx(SYNTHETIC));
  const zipNames = bytes.toString("latin1");
  assert.ok(zipNames.includes("Contents/section0.xml"));
  const all = hwpxTableCoverage(bytes, []);
  assert.ok(all && all.source_tables >= 1);
  assert.equal(all.missing_ids.length, all.source_tables, "파서 결과가 비면 모두 누락");
  const root = workspace();
  const outcome = await runJob({ jobPath: writeJob(root, "cov.hwpx", bytes), root });
  const quality = JSON.parse(readFileSync(path.join(path.dirname(outcome.manifest_path), "quality.json"), "utf8"));
  assert.equal(quality.source_table_coverage.missing_ids.length, 0, "정상 문서는 누락 없음");
  assert.equal(quality.source_table_coverage.source_tables, quality.counts.tables);
  assert.equal(hwpxTableCoverage(Buffer.from("not a zip"), []), null);
});

test("HWP5 암호·DRM 문서는 파서에 넘기지 않고 보류하고, 배포용 문서만 있는 공개 자료는 보호 사실을 남기고 파싱한다(T69, 운영자 허용 2026-10-05)", async () => {
  const root = workspace();
  const hwp5 = (properties) => {
    const header = Buffer.alloc(256);
    header.write("HWP Document File", 0, "latin1");
    header.writeUInt32LE(0x05000300, 32);
    header.writeUInt32LE(properties, 36);
    const container = CFB.utils.cfb_new();
    CFB.utils.cfb_add(container, "FileHeader", header);
    CFB.utils.cfb_add(container, "DocInfo", Buffer.alloc(16));
    return Buffer.from(CFB.write(container, { type: "buffer" }));
  };
  const dist = await runJob({ jobPath: writeJob(root, "dist.hwp", hwp5(0x5)), root });
  assert.equal(dist.ok, true, JSON.stringify(dist));
  assert.notEqual(dist.status, "REQUIRES_AUTHORIZED_COPY", "배포용 문서는 보류하지 않고 kordoc에 넘긴다");
  assert.deepEqual(dist.manifest.protection.flags, ["distribution"]);
  assert.equal(dist.manifest.protection.parsed, true);
  for (const [name, properties, flag] of [["pw.hwp", 0x3, "password"], ["drm.hwp", 0x11, "drm"], ["pw-dist.hwp", 0x7, "password"]]) {
    const outcome = await runJob({ jobPath: writeJob(root, name, hwp5(properties)), root });
    assert.equal(outcome.ok, true, JSON.stringify(outcome));
    assert.equal(outcome.status, "REQUIRES_AUTHORIZED_COPY", name);
    assert.equal(outcome.manifest.protection.flags[0], flag);
    assert.equal(outcome.manifest.protection.parsed, false);
    assert.equal(existsSync(path.join(root, "parsed", outcome.parse_id, "content.md")), false, "보호 문서 본문을 만들지 않는다");
  }
});
