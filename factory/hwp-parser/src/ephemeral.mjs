// 공식 보도자료 첨부(HWP/HWPX) 일시 판독 실행기(작업지시서 v5 §23.12, T154·T155). 로컬 전용·기본 꺼짐.
// 1) 허가 판정(서버와 같은 규칙) 2) 보존 경로 사전점검(스왑·동기화 폴더) 3) 만료 표시가 있는 임시 폴더에서 격리 kordoc 워커 실행
// 4) 허가된 출력(지문·처리영수증)만 돌려주고 5) 성공·실패와 상관없이 임시 폴더를 지운다. 남은 폴더는 sweep이 만료 기준으로 지운다.
// 본문·조각·raw IR은 영수증에 넣지 않는다. 지문은 내부 중복 보조용이며 사실 근거가 아니다.
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";

import { decideEphemeral } from "../../../lib/press/ephemeral.ts";
import { LIMITS } from "./limits.mjs";
import { runJob } from "./run-job.mjs";

export const FINGERPRINT_ALGORITHM = "sha256-nfc-ws-collapse-v1";
const PREFIX = "eph-";
const EXPIRES_FILE = ".expires_at";
const SYNC_MARKERS = [/onedrive/i, /google ?drive/i, /my drive/i, /dropbox/i, /icloud/i, /box sync/i, /내 드라이브/];

/**
 * 제어할 수 없는 보존 경로 점검. 하나라도 있으면 이 기능을 켜지 않는다(§23.12).
 * probe는 시험에서 환경을 바꿔 넣기 위한 것이고, 기본은 실제 환경을 읽는다.
 */
/** 시스템이 잠근 파일(pagefile.sys 등)은 존재 확인이 접근 거부로 실패하므로, '없음(ENOENT)'일 때만 없다고 본다. */
function systemFileExists(file) {
  try {
    statSync(file);
    return true;
  } catch (error) {
    return !(error && error.code === "ENOENT");
  }
}

export function preflight(ephemeralRoot, probe = {}) {
  const platform = probe.platform ?? process.platform;
  const exists = probe.exists ?? systemFileExists;
  const readText = probe.readText ?? ((file) => (existsSync(file) ? readFileSync(file, "utf8") : ""));
  const blockers = [];
  if (platform === "win32") {
    // Windows는 가상 메모리·최대 절전·오류 덤프를 이 도구가 끌 수 없으므로 언제나 막는다. 페이지 파일이 보이면 그 사실을 사유로 남긴다.
    const drive = (probe.systemDrive ?? process.env.SystemDrive ?? "C:") + "\\";
    blockers.push(exists(drive + "pagefile.sys") || exists(drive + "swapfile.sys") ? "OS_SWAP_UNCONTROLLED" : "OS_RETENTION_UNVERIFIED");
  } else if (platform === "linux") {
    if (readText("/proc/swaps").trim().split("\n").length > 1) blockers.push("OS_SWAP_UNCONTROLLED");
    const core = readText("/proc/sys/kernel/core_pattern").trim();
    if (core && core !== "core" && !core.startsWith("|/bin/false")) blockers.push("CORE_DUMP_HANDLER_PRESENT");
  } else {
    blockers.push("OS_RETENTION_UNVERIFIED");
  }
  if (SYNC_MARKERS.some((pattern) => pattern.test(path.resolve(ephemeralRoot)))) blockers.push("SYNC_FOLDER");
  return { ok: blockers.length === 0, blockers };
}

function sniffFormat(bytes) {
  if (bytes.length >= 4 && bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04) return "hwpx";
  if (bytes.length >= 8 && bytes[0] === 0xd0 && bytes[1] === 0xcf && bytes[2] === 0x11 && bytes[3] === 0xe0) return "hwp";
  return null;
}

/** 문단·표 셀 글자를 NFC·공백 정리해 이은 뒤 SHA-256. 같은 내용의 다른 형식(HWP/HWPX)은 같은 지문이 나올 수 있으나 동일성 확정은 아니다. */
export function fingerprintOf(document, tables) {
  const parts = [];
  for (const block of document.blocks) if (block.parsed_text_verbatim) parts.push(block.parsed_text_verbatim);
  for (const table of tables) for (const cell of table.cells) parts.push(cell.normalized_text);
  const text = parts.join("\n").normalize("NFC").replace(/\s+/g, " ").trim();
  return createHash("sha256").update(text).digest("hex");
}

/**
 * 한 건 판독. 허가·사전점검·크기·형식 중 하나라도 맞지 않으면 아무것도 쓰지 않고 거절한다.
 * @returns {Promise<{ok: true, receipt: object} | {ok: false, code: string, blockers?: string[]}>}
 */
export async function runEphemeral({ request, bytes, itemId, sourceVersion, ephemeralRoot, now = Date.now(), probe, runner = runJob }) {
  const decision = decideEphemeral(request);
  if (!decision.allowed) return { ok: false, code: decision.code };
  const check = preflight(ephemeralRoot, probe);
  if (!check.ok) return { ok: false, code: "PREFLIGHT_BLOCKED", blockers: check.blockers };
  if (bytes.length > decision.maxBytes) return { ok: false, code: "TOO_LARGE" };
  const format = sniffFormat(bytes);
  if (!format) return { ok: false, code: "FORMAT_NOT_ALLOWED" };
  mkdirSync(ephemeralRoot, { recursive: true });
  const work = mkdtempSync(path.join(ephemeralRoot, PREFIX));
  try {
    writeFileSync(path.join(work, EXPIRES_FILE), String(now + decision.ttlSeconds * 1000));
    mkdirSync(path.join(work, "raw"));
    const name = "attachment." + format;
    writeFileSync(path.join(work, "raw", name), bytes);
    const sha = createHash("sha256").update(bytes).digest("hex");
    const jobPath = path.join(work, "job.json");
    writeFileSync(jobPath, JSON.stringify({ job_id: "eph-" + sha.slice(0, 12), source_version_id: "sv-" + sha.slice(0, 12), input_ref: "raw/" + name, expected_sha256: sha, profile_id: "hwp-ingest", output_root: "parsed" }));
    const outcome = await runner({ jobPath, root: work, timeoutMs: Math.min(decision.maxSeconds * 1000, LIMITS.timeoutMs) });
    if (!outcome.ok) return { ok: false, code: "PARSE_FAILED:" + outcome.error_code };
    const out = path.dirname(outcome.manifest_path);
    const document = JSON.parse(readFileSync(path.join(out, "document.json"), "utf8"));
    const tables = readFileSync(path.join(out, "tables.jsonl"), "utf8").split("\n").filter(Boolean).map((line) => JSON.parse(line));
    const receipt = {
      item_id: itemId, source_id: request.source.sourceId, operation: request.operation, policy_version: decision.policyVersion,
      processed_at: new Date(now).toISOString(), parse_status: outcome.status, block_count: document.blocks.length, table_count: tables.length,
      source_version: sourceVersion, raw_sha256: sha, temp_removed: false,
      ...(decision.outputs.includes("fingerprint") ? { algorithm: FINGERPRINT_ALGORITHM, fingerprint: fingerprintOf(document, tables), extraction_scope: "paragraph_text+table_cell_text" } : {}),
    };
    return { ok: true, receipt };
  } finally {
    rmSync(work, { recursive: true, force: true, maxRetries: 3 });
    if (existsSync(work)) throw new Error("EPHEMERAL_CLEANUP_FAILED");
  }
}

/** 만료됐거나 만료 표시가 없는 임시 폴더를 지운다(실패·재시작 뒤 잔여물 정리). */
export function sweepEphemeral(ephemeralRoot, now = Date.now()) {
  const removed = [];
  const failed = [];
  if (!existsSync(ephemeralRoot)) return { removed, failed };
  for (const name of readdirSync(ephemeralRoot)) {
    if (!name.startsWith(PREFIX)) continue;
    const folder = path.join(ephemeralRoot, name);
    const marker = path.join(folder, EXPIRES_FILE);
    const expires = existsSync(marker) ? Number.parseInt(readFileSync(marker, "utf8"), 10) : 0;
    if (Number.isFinite(expires) && expires > now) continue;
    rmSync(folder, { recursive: true, force: true, maxRetries: 3 });
    (existsSync(folder) ? failed : removed).push(name);
  }
  return { removed, failed };
}
