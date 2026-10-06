// 격리 문서 파싱 워커(작업지시서 v5 §5.10, 2026-10-05 kordoc 4.18.13 다형식 개편). 부모(run-job.mjs)가 네트워크 차단 모듈을 먼저 불러 실행한다.
// 구조화 결과는 모두 kordoc 공식 파서 함수에서만 얻는다(형식별 함수로 명시 라우팅, 다른 파서로 대체하지 않음).
// stdout에는 결과 요약 한 줄만, stderr에는 본문·절대경로 없는 진단만 쓴다. 결과는 임시 폴더에 쓴 뒤 원자적으로 확정한다.
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { confirmWithKordoc, JobError, readVerifiedInput, validateJob } from "./input.mjs";
import { hwp5Protection } from "./protection.mjs";
import { verifyOcrModels } from "./models.mjs";
import { buildDocument, extractionPlan } from "./normalize.mjs";
import { ADAPTER_VERSION, BASE_OPTIONS, canonicalJson, CONTRACT, CONTRACT_VERSION, FORMAT_OPTIONS, OCR_POLICY, OPTIONS_HASH, optionsFor, PROFILE_ID, PROFILE_VERSION, sha256Hex } from "./profile.mjs";
import { assessQuality, failureStatus } from "./quality.mjs";
import { hwpxTableCoverage } from "./xml-check.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const PIN = JSON.parse(readFileSync(path.join(here, "..", "parser-pin.json"), "utf8"));
const MB = 1024 * 1024;

/** 형식 → kordoc 공식 파서 함수와 결과 fileType. */
const ROUTES = Object.freeze({
  hwp: { fn: "parseHwp", fileType: "hwp" },
  hwp3: { fn: "parseHwp3", fileType: "hwp3" },
  hwpx: { fn: "parseHwpx", fileType: "hwpx" },
  hwpml: { fn: "parseHwpml", fileType: "hwpml" },
  pdf: { fn: "parsePdf", fileType: "pdf" },
  docx: { fn: "parseDocx", fileType: "docx" },
  xlsx: { fn: "parseXlsx", fileType: "xlsx" },
  xls: { fn: "parseXls", fileType: "xls" },
  pptx: { fn: "parsePptx", fileType: "pptx" },
  image: { fn: "parseImage", fileType: "image" },
});

/** 설치된 kordoc이 고정값(버전·lockfile 무결성)과 같은지 확인한다. 다르면 파싱하지 않는다. */
export function verifyParserPin() {
  const installed = JSON.parse(readFileSync(path.join(here, "..", "node_modules", "kordoc", "package.json"), "utf8"));
  const lock = JSON.parse(readFileSync(path.join(here, "..", "package-lock.json"), "utf8"));
  const locked = lock.packages?.["node_modules/kordoc"];
  if (installed.version !== PIN.package_version || locked?.version !== PIN.package_version || locked?.integrity !== PIN.package_integrity) {
    throw new JobError("PARSER_PIN_MISMATCH", "설치된 kordoc이 고정 버전·무결성과 다릅니다.");
  }
  for (const [name, pinned] of Object.entries(PIN.runtime_dependencies ?? {})) {
    const entry = lock.packages?.["node_modules/" + name];
    if (!entry || entry.version !== pinned.version || entry.integrity !== pinned.integrity) throw new JobError("PARSER_PIN_MISMATCH", "kordoc 실행 의존성 " + name + "이 고정값과 다릅니다.");
  }
  return { name: PIN.name, package_version: PIN.package_version, package_integrity: PIN.package_integrity, source_commit: PIN.source_commit, source_commit_verification: PIN.source_commit_verification, runtime_dependencies: PIN.runtime_dependencies ?? {}, runtime_version: process.version, platform: process.platform + "-" + process.arch };
}

function parseIdOf(rawSha256, parser, format, ocrModelsDigest, pageRange = null) {
  return "p_" + sha256Hex(canonicalJson({
    raw_sha256: rawSha256, parser: { name: parser.name, version: parser.package_version, integrity: parser.package_integrity },
    options_hash: OPTIONS_HASH, adapter_version: ADAPTER_VERSION, contract_version: CONTRACT_VERSION, route: format, ocr_models: ocrModelsDigest,
    // 쪽 범위를 지정한 결과는 같은 원문의 다른 결과다(범위 없는 기존 parse_id는 그대로).
    ...(pageRange ? { page_range: pageRange } : {}),
  })).slice(0, 32);
}

/** 이미지 바이트·data URI가 남았는지 검사한다(images:false라도 확인). */
function assertNoBinary(serialized) {
  if (/data:[a-z]+\/[a-z0-9.+-]+;base64,/i.test(serialized) || serialized.includes("\"imageData\"")) {
    throw new JobError("OUTPUT_CONTAINS_BINARY", "결과에 이미지 바이트·data URI가 남았습니다.");
  }
}

/**
 * 그림 바이트(imageData)를 모든 깊이(표 셀·캡션·중첩 표)에서 뗀다. kordoc 4.18.13은 images:false여도 표 셀 안 그림 블록의 imageData를
 * 남긴다(4.18.8에서는 같은 문서가 통과, 공식 설명은 "블록의 imageData도 뗀다"). 그림 자리 표시(type:image, 파일 이름)는 그대로 둔다.
 */
export function stripImageData(blocks) {
  let removed = 0;
  const visit = (list) => {
    for (const block of list ?? []) {
      if (block && typeof block === "object" && "imageData" in block) {
        delete block.imageData;
        removed += 1;
      }
      if (block?.table) {
        for (const row of block.table.cells ?? []) for (const cell of row ?? []) visit(cell?.blocks);
        visit(block.table.captionBlocks);
      }
    }
  };
  visit(blocks);
  return removed;
}

function writeOutputs(outputRoot, parseId, files, manifestBase, limits) {
  mkdirSync(outputRoot, { recursive: true });
  const finalDir = path.join(outputRoot, parseId);
  const tmpDir = path.join(outputRoot, ".tmp-" + parseId + "-" + process.pid);
  rmSync(tmpDir, { recursive: true, force: true });
  mkdirSync(tmpDir);
  const declared = [];
  let total = 0;
  for (const [name, content, records] of files) {
    const bytes = Buffer.from(content, "utf8");
    total += bytes.length;
    if (total > limits.maxOutputBytes) {
      rmSync(tmpDir, { recursive: true, force: true });
      throw new JobError("OUTPUT_TOO_LARGE", "구조화 산출물이 상한을 넘습니다(묵시 절단하지 않음).");
    }
    writeFileSync(path.join(tmpDir, name), bytes);
    declared.push({ name, sha256: sha256Hex(bytes), size: bytes.length, records });
  }
  const contentDigest = sha256Hex(canonicalJson(declared));
  const manifest = { ...manifestBase, files: declared, content_digest: contentDigest, created_at: new Date().toISOString() };
  writeFileSync(path.join(tmpDir, "manifest.json"), JSON.stringify(manifest, null, 2));
  if (existsSync(finalDir)) {
    // 같은 원문·파서·프로필·OCR 모델이면 parse_id가 같다. 내용이 같으면 기존 산출물을 그대로 쓰고, 다르면 덮어쓰지 않는다.
    const existing = JSON.parse(readFileSync(path.join(finalDir, "manifest.json"), "utf8"));
    rmSync(tmpDir, { recursive: true, force: true });
    if (existing.content_digest !== contentDigest) throw new JobError("PARSE_ID_CONFLICT", "같은 parse_id의 기존 산출물과 내용이 다릅니다. 덮어쓰지 않습니다.");
    return { manifest: existing, reused: true, dir: finalDir };
  }
  renameSync(tmpDir, finalDir);
  return { manifest, reused: false, dir: finalDir };
}

/** 워커 RSS(네이티브 메모리 포함) 감시. 상한을 넘으면 결과를 쓰지 않고 스스로 끝낸다. */
function watchMemory(limitMb) {
  let peak = process.memoryUsage.rss();
  const timer = setInterval(() => {
    const rss = process.memoryUsage.rss();
    if (rss > peak) peak = rss;
    if (rss > limitMb * MB) {
      process.stdout.write(JSON.stringify({ ok: false, error_code: "RSS_LIMIT", peak_rss_mb: Math.round(rss / MB) }) + "\n");
      process.exit(3);
    }
  }, 100);
  timer.unref();
  return () => {
    clearInterval(timer);
    return Math.round(Math.max(peak, process.memoryUsage.rss()) / MB);
  };
}

/** PDF 1차 결과에서 OCR이 필요한 쪽: 텍스트층 없음·글자 깨짐(NEEDS_OCR)과 글이 없는 그림 영역(SKIPPED_IMAGE). */
export function pdfOcrTargets(result, maxPages, pageRange = null) {
  const pages = new Set();
  const first = pageRange?.first ?? 1;
  const last = pageRange ? Math.min(pageRange.last, result.pageCount ?? pageRange.last) : Math.min(result.pageCount ?? 0, maxPages);
  if (result.isImageBased) for (let page = first; page <= last; page += 1) pages.add(page);
  for (const quality of result.pageQuality ?? []) if (quality.needsOcr) pages.add(quality.page);
  for (const warning of result.warnings ?? []) if ((warning.code === "NEEDS_OCR" || warning.code === "SKIPPED_IMAGE") && Number.isInteger(warning.page)) pages.add(warning.page);
  return [...pages].filter((page) => (pageRange ? page >= pageRange.first && page <= pageRange.last : page >= 1 && page <= maxPages)).sort((a, b) => a - b);
}

/** kordoc 공식 함수로만 파싱한다. PDF는 텍스트 1차 → 필요할 때만 내장 OCR 2차. */
async function parseRouted(kordoc, format, buffer, limits, models, pageRange = null) {
  const route = ROUTES[format];
  const call = (options) => kordoc[route.fn](buffer, options);
  if (format === "pdf") {
    const first = await call(optionsFor("pdf", { maxPages: limits.maxPages, ocr: false, pageRange }));
    if (!first.success) return { result: first, passes: 1, ocr: { requested: false, reason: "TEXT_PASS_FAILED", candidate_pages: [] } };
    const pages = pdfOcrTargets(first, limits.maxPages, pageRange);
    if (!pages.length) return { result: first, passes: 1, ocr: { requested: false, reason: "TEXT_LAYER_SUFFICIENT", candidate_pages: [] } };
    if (pages.length > limits.maxOcrPages) return { result: first, passes: 1, ocr: { requested: false, reason: "OCR_PAGE_LIMIT", candidate_pages: pages } };
    if (!models.ready) return { result: first, passes: 1, ocr: { requested: false, reason: models.reason, candidate_pages: pages } };
    const second = await call(optionsFor("pdf", { maxPages: limits.maxPages, ocr: true, pageRange }));
    if (!second.success) return { result: first, passes: 2, ocr: { requested: false, reason: "OCR_PASS_FAILED", candidate_pages: pages } };
    return { result: second, passes: 2, ocr: { requested: true, reason: "OCR_NEEDED", candidate_pages: pages } };
  }
  if (format === "image") {
    if (!models.ready) return { result: { success: false, fileType: "image", code: "OCR_MODELS_NOT_PREPARED", error: "OCR 모델 미준비" }, passes: 0, ocr: { requested: false, reason: models.reason, candidate_pages: [1] } };
    return { result: await call(optionsFor("image")), passes: 1, ocr: { requested: true, reason: "IMAGE_INPUT", candidate_pages: [1] } };
  }
  return { result: await call(optionsFor(format)), passes: 1, ocr: null };
}

export async function runWorker(jobPath, root) {
  const started = Date.now();
  const stopWatch = watchMemory(Number(process.env.WF_MAX_RSS_MB) || 3072);
  const parser = verifyParserPin();
  const job = JSON.parse(readFileSync(jobPath, "utf8"));
  const validated = validateJob(job, root);
  const input = readVerifiedInput(validated);
  const kordoc = await import("kordoc");
  const reported = await confirmWithKordoc(input.bytes, input, kordoc);
  const models = verifyOcrModels(validated.rootReal);
  const buffer = input.bytes.buffer.slice(input.bytes.byteOffset, input.bytes.byteOffset + input.bytes.byteLength);
  // 원문 경로·filePath·password·OCR 함수를 넘기지 않고 검증한 바이트만 넘긴다(COM 재시도·외부 OCR 경로 차단).
  const pageRange = input.format === "pdf" ? validated.pageRange : null;
  if (validated.pageRange && input.format !== "pdf") throw new JobError("JOB_INVALID", "page_range는 PDF에만 쓸 수 있습니다.");
  // 암호·DRM·인증서 보호 문서는 파서에 넘기지 않는다. 배포용(복사·편집 제한) 문서만 있는 공개 자료는 운영자 허용(2026-10-05)에 따라
  // kordoc으로 읽되, 보호 사실을 manifest·품질 경고에 남겨 원 게시 기관 출처를 밝히고 원문 그대로 재배포하지 않도록 한다.
  const protection = input.format === "hwp" ? hwp5Protection(input.bytes) : null;
  const distributionOnly = protection !== null && protection.flags.length > 0 && protection.flags.every((flag) => flag === "distribution");
  const blocked = protection !== null && !distributionOnly;
  const { result, passes, ocr } = blocked
    ? { result: { success: false, fileType: "hwp", code: protection.code, error: "보호 문서(" + protection.flags.join(",") + ")" }, passes: 0, ocr: null }
    : await parseRouted(kordoc, input.format, buffer, validated.limits, models, pageRange);
  if (result.fileType && result.fileType !== ROUTES[input.format].fileType) throw new JobError("PARSER_ROUTE_MISMATCH", "kordoc 결과 형식이 판별 형식과 다릅니다.");
  const ocrUsed = ocr?.requested === true;
  const parseId = parseIdOf(input.digest, parser, input.format, ocrUsed ? models.digest : null, pageRange);
  const manifestBase = {
    contract: CONTRACT, contract_version: CONTRACT_VERSION, adapter_version: ADAPTER_VERSION,
    job_id: job.job_id, source_version_id: job.source_version_id, parse_id: parseId,
    raw_sha256: input.digest, raw_size: input.bytes.length, detected_format: input.format, format_signature: input.signature, kordoc_detected_format: reported,
    extension: input.extension, zip_inspection: input.zip,
    parser, profile: { profile_id: PROFILE_ID, requested_profile_id: job.profile_id, profile_version: PROFILE_VERSION, options: { base: BASE_OPTIONS, formats: FORMAT_OPTIONS, ocr_policy: OCR_POLICY }, effective_options: optionsFor(input.format, { maxPages: validated.limits.maxPages, ocr: ocrUsed, pageRange }), options_hash: OPTIONS_HASH },
    ...(pageRange ? { page_scope: { declared_range: pageRange, basis: "작업 명세 page_range(선언한 쪽만 처리)" } } : {}),
    route: { parser_function: ROUTES[input.format].fn, passes },
    ...(protection ? { protection: { flags: protection.flags, file_header_properties: protection.properties, basis: distributionOnly ? "HWP 5.0 FileHeader 속성 비트. 배포용 문서(공개 자료) 운영자 허용(2026-10-05)으로 파싱. 출처 기관 표시·사칭 재배포 금지" : "HWP 5.0 FileHeader 속성 비트. 보호를 풀지 않고 파싱 전에 보류", parsed: distributionOnly } } : {}),
    ...(ocr ? { ocr: { ...ocr, models: ocrUsed ? { engine: models.engine, digest: models.digest, files: models.files.map(({ filename, sha256, size_bytes, url }) => ({ filename, sha256, size_bytes, url })) } : null } } : {}),
  };
  const finish = () => ({ elapsed_ms: Date.now() - started, peak_rss_mb: stopWatch(), parse_passes: passes });
  if (!result.success) {
    const status = result.code === "OCR_MODELS_NOT_PREPARED" ? "FAILED" : failureStatus(result.code);
    const quality = { status, reasons: [result.code === "OCR_MODELS_NOT_PREPARED" ? "OCR 모델이 준비되지 않아 이미지를 읽지 않았습니다(prepare-models.mjs)." : "파서 실패: " + (result.code ?? "UNKNOWN")], upstream_error_code: result.code ?? null, warnings: [], network_attempts: globalThis.__wfNetworkAttempts ?? 0 };
    return { ...writeOutputs(validated.outputRoot, parseId, [["quality.json", JSON.stringify(quality, null, 2), 1]], { ...manifestBase, status, file_type: result.fileType, performance: finish() }, validated.limits), status, job_id: job.job_id };
  }
  const raw = {
    fileType: result.fileType, pageCount: result.pageCount ?? null, isImageBased: result.isImageBased ?? null, metadata: result.metadata ?? null, outline: result.outline ?? [], warnings: result.warnings ?? [],
    pageQuality: result.pageQuality ?? null, qualitySummary: result.qualitySummary ?? null, blocks: result.blocks,
  };
  const strippedImages = stripImageData(raw.blocks);
  const rawJson = JSON.stringify(raw);
  assertNoBinary(rawJson);
  const plan = extractionPlan(input.format, raw, ocrUsed);
  const { document, tables, sourceMap } = buildDocument(raw, parseId, validated.limits, plan);
  const totalPages = result.pageCount ?? null;
  const pageLimit = input.format === "pdf" ? (pageRange ? { maxPages: validated.limits.maxPages, totalPages, truncated: false, range: pageRange } : { maxPages: validated.limits.maxPages, totalPages, truncated: Number.isInteger(totalPages) && totalPages > validated.limits.maxPages }) : null;
  const quality = assessQuality(raw, tables, document.blocks, globalThis.__wfNetworkAttempts ?? 0, { format: input.format, ocr, ocrPages: plan.ocr_pages, extension: input.extension, pageLimit });
  if (input.format === "hwp3") {
    // HWP 3.x는 독립 정답 시험 전이라 결과를 검토 자료로만 남긴다. 자동 공개·구조 검증 통과로 올리지 않는다.
    quality.warnings.push({ upstream_code: null, upstream_message_internal: "", page: null, project_code: "WF_HWP3_EXPERIMENTAL", action: "block_auto_publish" });
    if (quality.status === "STRUCTURE_VALIDATED") quality.status = "NEEDS_REVIEW";
    quality.reasons.push("HWP 3.x 문서는 시험 단계(EXPERIMENTAL) 형식이라 사람이 원문과 대조해야 합니다.");
  }
  if (input.format === "hwpx") {
    const coverage = hwpxTableCoverage(input.bytes, tables.map((table) => table.source_table_id));
    quality.source_table_coverage = coverage ?? { status: "UNREADABLE" };
    if (coverage && coverage.missing_ids.length) {
      quality.warnings.push({ upstream_code: null, upstream_message_internal: "", page: null, project_code: "WF_SOURCE_TABLE_NOT_EXTRACTED", action: "review_omission", count: coverage.missing_ids.length });
      if (quality.status === "STRUCTURE_VALIDATED") quality.status = "NEEDS_REVIEW";
      quality.reasons.push("원본 XML에 있는 표 " + coverage.missing_ids.length + "개가 파서 결과에 없습니다" + (coverage.in_caption_ids.length ? "(캡션 안 표 " + coverage.in_caption_ids.length + "개)" : "") + ". 그 부분은 원문으로 확인해야 합니다.");
    }
  }
  if (distributionOnly) {
    quality.warnings.push({ upstream_code: null, upstream_message_internal: "", page: null, project_code: "WF_DISTRIBUTION_DOCUMENT", action: "attribute_source" });
    quality.reasons.push("배포용(복사·편집 제한) 문서입니다. 운영자 허용에 따라 읽었으며, 이용할 때 원 게시 기관을 출처로 밝히고 기관 명의로 재배포하지 않습니다.");
  }
  if (ocr) quality.ocr = { requested: ocr.requested, reason: ocr.reason, candidate_pages: ocr.candidate_pages, applied_pages: plan.ocr_pages, engine: ocrUsed ? models.engine : null, line_confidence: "not_provided_by_parser" };
  if (strippedImages) quality.upstream_image_bytes_stripped = { count: strippedImages, note: "kordoc이 images:false에서도 남긴 그림 바이트를 저장 전에 뗐습니다(그림 자리 표시는 유지)." };
  const files = [
    ["raw-ir.json", rawJson, raw.blocks.length],
    ["document.json", JSON.stringify(document), document.blocks.length],
    ["tables.jsonl", tables.map((table) => JSON.stringify(table)).join("\n") + (tables.length ? "\n" : ""), tables.length],
    ["source-map.jsonl", sourceMap.map((entry) => JSON.stringify(entry)).join("\n") + "\n", sourceMap.length],
    ["quality.json", JSON.stringify(quality, null, 2), 1],
    ["content.md", result.markdown ?? "", null],
  ];
  const manifestExtras = { status: quality.status, file_type: result.fileType, page_mode: document.page_mode, ...(ocr ? { ocr: { ...manifestBase.ocr, applied_pages: plan.ocr_pages } } : {}), performance: finish() };
  return { ...writeOutputs(validated.outputRoot, parseId, files, { ...manifestBase, ...manifestExtras }, validated.limits), status: quality.status, job_id: job.job_id };
}

function argument(name) {
  const index = process.argv.indexOf(name);
  return index > 0 ? process.argv[index + 1] : undefined;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const jobPath = argument("--job");
  const root = argument("--root");
  try {
    if (!jobPath || !root) throw new JobError("ARGS", "--job과 --root가 필요합니다.");
    const outcome = await runWorker(jobPath, root);
    const relative = path.relative(root, path.join(outcome.dir, "manifest.json")).split(path.sep).join("/");
    // 같은 원문을 다른 작업이 다시 맡으면 기존 산출물(처음 작업의 manifest)을 그대로 쓴다. 요약의 job_id는 이번 작업, manifest_job_id는 산출물을 만든 작업이다.
    process.stdout.write(JSON.stringify({ ok: true, job_id: outcome.job_id, manifest_job_id: outcome.manifest.job_id, parse_id: outcome.manifest.parse_id, status: outcome.status, reused: outcome.reused, manifest: relative }) + "\n");
  } catch (error) {
    const code = error instanceof JobError ? error.code : "WORKER_ERROR";
    process.stderr.write("worker failed: " + code + "\n");
    process.stdout.write(JSON.stringify({ ok: false, error_code: code }) + "\n");
    process.exitCode = 2;
  }
}
