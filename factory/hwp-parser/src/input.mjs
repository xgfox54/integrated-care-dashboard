// 작업 명세·입력 원문 검증(작업지시서 v5 §5.10·§5.16). 외부에서 경로·옵션을 고르지 못하게 허용 루트 안의 상대 참조만 받는다.
// 형식은 확장자가 아니라 파일 시그니처·컨테이너 내부 구조로 정하고, kordoc 판별 결과와 다르면 파싱하지 않는다(2026-10-05 다형식 개편).
import { readFileSync, realpathSync, statSync } from "node:fs";
import path from "node:path";

import { LIMITS } from "./limits.mjs";
import { LEGACY_PROFILE_IDS, PROFILE_ID, sha256Hex } from "./profile.mjs";

export class JobError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

const JOB_KEYS = new Set(["job_id", "source_version_id", "input_ref", "expected_sha256", "profile_id", "output_root", "limits", "page_range"]);
const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;

/** 작업 명세를 검증한다. root는 부모 프로세스가 정한 작업공간 루트(사용자 입력 아님). */
export function validateJob(job, root) {
  if (!job || typeof job !== "object" || Array.isArray(job)) throw new JobError("JOB_INVALID", "작업 명세가 객체가 아닙니다.");
  for (const key of Object.keys(job)) if (!JOB_KEYS.has(key)) throw new JobError("JOB_INVALID", "허용되지 않은 작업 항목: " + key);
  for (const key of ["job_id", "source_version_id"]) if (typeof job[key] !== "string" || !ID.test(job[key])) throw new JobError("JOB_INVALID", key + " 형식 오류");
  if (job.profile_id !== PROFILE_ID && !LEGACY_PROFILE_IDS.includes(job.profile_id)) throw new JobError("PROFILE_UNKNOWN", "허용된 파싱 프로필이 아닙니다.");
  if (typeof job.expected_sha256 !== "string" || !/^[0-9a-f]{64}$/.test(job.expected_sha256)) throw new JobError("JOB_INVALID", "expected_sha256 형식 오류");
  const rootReal = realpathSync(root);
  const resolveInside = (relative, label) => {
    if (typeof relative !== "string" || !relative || path.isAbsolute(relative) || relative.split(/[\\/]/).includes("..")) {
      throw new JobError("PATH_REJECTED", label + "는 작업공간 안의 상대 경로여야 합니다.");
    }
    return path.join(rootReal, relative);
  };
  const inputPath = resolveInside(job.input_ref, "input_ref");
  const outputRoot = resolveInside(job.output_root, "output_root");
  let inputReal;
  try {
    inputReal = realpathSync(inputPath);
  } catch {
    throw new JobError("INPUT_MISSING", "입력 원문이 없습니다.");
  }
  if (!inputReal.startsWith(rootReal + path.sep)) throw new JobError("PATH_REJECTED", "입력 원문이 작업공간 밖을 가리킵니다(링크 포함).");
  const limits = { ...LIMITS };
  if (job.limits !== undefined) {
    if (!job.limits || typeof job.limits !== "object") throw new JobError("JOB_INVALID", "limits 형식 오류");
    for (const [key, value] of Object.entries(job.limits)) {
      if (!(key in LIMITS) || !Number.isInteger(value) || value <= 0 || value > LIMITS[key]) throw new JobError("JOB_INVALID", "limits는 기본 상한 이하로만 줄일 수 있습니다: " + key);
      limits[key] = value;
    }
  }
  // 쪽 범위(PDF): 긴 문서에서 필요한 부분(예: 예산서 한 국의 사업명세서)만 읽는다. 범위 길이도 쪽 수 상한을 넘지 못하고,
  // 결과는 「선언한 범위만 처리」로 남아 전체 문서로 표시되지 않는다. 원문 해시는 전체 파일 그대로다.
  let pageRange = null;
  if (job.page_range !== undefined) {
    const range = job.page_range;
    const ok = range && typeof range === "object" && Object.keys(range).length === 2 && Number.isInteger(range.first) && Number.isInteger(range.last) && range.first >= 1 && range.last >= range.first && range.last <= 100_000;
    if (!ok) throw new JobError("JOB_INVALID", "page_range는 { first, last } 정수(1 이상, first ≤ last)여야 합니다.");
    if (range.last - range.first + 1 > limits.maxPages) throw new JobError("JOB_INVALID", "page_range 길이가 쪽 수 상한(" + limits.maxPages + "쪽)을 넘습니다.");
    pageRange = { first: range.first, last: range.last };
  }
  return { job, rootReal, inputReal, outputRoot, limits, pageRange };
}

/** ZIP 중앙 디렉터리를 읽어 항목 수·누적 해제 크기·경로 탈출·중복을 검사한다(해제 전 단계). 항목 이름 목록도 돌려준다. */
export function inspectZip(bytes, limits) {
  const view = Buffer.from(bytes);
  let end = -1;
  for (let index = view.length - 22; index >= Math.max(0, view.length - 65_557); index -= 1) {
    if (view.readUInt32LE(index) === 0x06054b50) {
      end = index;
      break;
    }
  }
  if (end < 0) throw new JobError("ZIP_INVALID", "ZIP 끝 레코드를 찾지 못했습니다.");
  const entries = view.readUInt16LE(end + 10);
  let offset = view.readUInt32LE(end + 16);
  if (entries > limits.maxZipEntries) throw new JobError("ZIP_LIMIT", "ZIP 항목 수가 상한을 넘습니다.");
  // ZIP64(항목 수·오프셋을 0xFFFF·0xFFFFFFFF로 두고 확장 레코드에 적음)는 이 검사를 우회할 수 있어 받지 않는다.
  if (entries === 0xffff || offset === 0xffffffff) throw new JobError("ZIP_LIMIT", "ZIP64 형식은 받지 않습니다.");
  const names = new Set();
  let expanded = 0;
  let mimetype = null;
  for (let index = 0; index < entries; index += 1) {
    if (offset + 46 > view.length || view.readUInt32LE(offset) !== 0x02014b50) throw new JobError("ZIP_INVALID", "ZIP 중앙 디렉터리가 손상되었습니다.");
    const uncompressed = view.readUInt32LE(offset + 24);
    if (uncompressed === 0xffffffff) throw new JobError("ZIP_LIMIT", "ZIP64 항목은 받지 않습니다.");
    const nameLength = view.readUInt16LE(offset + 28);
    const extraLength = view.readUInt16LE(offset + 30);
    const commentLength = view.readUInt16LE(offset + 32);
    const name = view.subarray(offset + 46, offset + 46 + nameLength).toString("utf8");
    if (name.startsWith("/") || name.includes("\\") || name.split("/").includes("..") || /^[A-Za-z]:/.test(name)) throw new JobError("ZIP_PATH_REJECTED", "ZIP 항목 경로가 허용되지 않습니다.");
    if (names.has(name)) throw new JobError("ZIP_DUPLICATE", "ZIP 항목 이름이 중복됩니다.");
    names.add(name);
    expanded += uncompressed;
    if (expanded > limits.maxZipExpandedBytes) throw new JobError("ZIP_LIMIT", "ZIP 누적 해제 크기가 상한을 넘습니다.");
    if (name === "mimetype") mimetype = { localHeader: view.readUInt32LE(offset + 42), size: uncompressed };
    offset += 46 + nameLength + extraLength + commentLength;
  }
  return { entries, expanded, hasMimetype: mimetype !== null, names: [...names] };
}

const CFB_SIGNATURE = Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
// HWP 3.x 파일 머리(30바이트 중 앞 23바이트). 작업지시서 v5 §5.9: 별도 정답 시험 전까지 EXPERIMENTAL.
const HWP3_SIGNATURE = Buffer.from("HWP Document File V3.00", "latin1");
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** OLE2(CFB) 디렉터리 항목 이름(UTF-16LE)이 있는지 본다. 최종 판정은 kordoc 판별과 대조한다. */
function cfbStreams(bytes) {
  const has = (name) => bytes.indexOf(Buffer.from(name, "utf16le")) >= 0;
  return { fileHeader: has("FileHeader"), workbook: has("Workbook"), word: has("WordDocument"), powerpoint: has("PowerPoint Document") };
}

/** 확장자로 기대하는 형식(대조·기록용). 확장자는 판정에 쓰지 않는다. */
const EXTENSION_FORMATS = { hwp: ["hwp", "hwp3"], hwpx: ["hwpx"], hml: ["hwpml"], hwpml: ["hwpml"], pdf: ["pdf"], docx: ["docx"], xlsx: ["xlsx"], xls: ["xls"], pptx: ["pptx"], png: ["image"], jpg: ["image"], jpeg: ["image"], webp: ["image"] };

export function extensionCheck(inputRef, format) {
  const extension = path.extname(inputRef).slice(1).toLowerCase();
  const expected = EXTENSION_FORMATS[extension];
  return { extension: extension || null, matches: expected ? expected.includes(format) : null };
}

/** 파일 시그니처·컨테이너 구조만으로 형식을 정한다. 확장자·Content-Type을 믿지 않는다(HTML 오류 페이지·위장 파일 거절). */
export function sniffFormat(bytes, limits) {
  if (bytes.length === 0) throw new JobError("INPUT_EMPTY", "입력 원문이 비었습니다.");
  if (bytes.length > limits.maxInputBytes) throw new JobError("INPUT_TOO_LARGE", "입력 원문이 상한을 넘습니다.");
  if (bytes.subarray(0, HWP3_SIGNATURE.length).equals(HWP3_SIGNATURE)) return { format: "hwp3", zip: null, signature: "hwp3-header" };
  if (bytes.subarray(0, 8).equals(CFB_SIGNATURE)) {
    const streams = cfbStreams(bytes);
    if (streams.word) throw new JobError("UNSUPPORTED_FORMAT", "Word 97-2003(.doc) 문서는 kordoc이 지원하지 않습니다.");
    if (streams.powerpoint) throw new JobError("UNSUPPORTED_FORMAT", "PowerPoint 97-2003(.ppt) 문서는 kordoc이 지원하지 않습니다.");
    if (streams.workbook) return { format: "xls", zip: null, signature: "cfb:Workbook" };
    if (streams.fileHeader) return { format: "hwp", zip: null, signature: "cfb:FileHeader" };
    throw new JobError("UNSUPPORTED_FORMAT", "알 수 없는 OLE2 문서입니다.");
  }
  if (bytes.length >= 4 && bytes.readUInt32LE(0) === 0x04034b50) {
    const zip = inspectZip(bytes, limits);
    const head = bytes.subarray(0, 200).toString("latin1");
    const names = new Set(zip.names);
    const summary = { entries: zip.entries, expanded: zip.expanded, hasMimetype: zip.hasMimetype };
    if (zip.hasMimetype && head.includes("application/hwp+zip")) return { format: "hwpx", zip: summary, signature: "zip:mimetype=application/hwp+zip" };
    if (names.has("[Content_Types].xml")) {
      if (names.has("word/document.xml")) return { format: "docx", zip: summary, signature: "zip:word/document.xml" };
      if (names.has("xl/workbook.xml")) return { format: "xlsx", zip: summary, signature: "zip:xl/workbook.xml" };
      if (names.has("ppt/presentation.xml")) return { format: "pptx", zip: summary, signature: "zip:ppt/presentation.xml" };
    }
    throw new JobError("UNSUPPORTED_FORMAT", "지원하는 문서 구조가 아닌 ZIP입니다(첨부 묶음 ZIP은 풀어서 각각 처리).");
  }
  if (bytes.subarray(0, 5).toString("latin1") === "%PDF-") return { format: "pdf", zip: null, signature: "%PDF-" };
  if (bytes.subarray(0, 8).equals(PNG_SIGNATURE)) return { format: "image", zip: null, signature: "png" };
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return { format: "image", zip: null, signature: "jpeg" };
  if (bytes.length >= 12 && bytes.subarray(0, 4).toString("latin1") === "RIFF" && bytes.subarray(8, 12).toString("latin1") === "WEBP") return { format: "image", zip: null, signature: "webp" };
  const text = bytes.subarray(0, 4096).toString("utf8").replace(/^\uFEFF/, "").trimStart();
  if (/^<\?xml[^>]*>\s*(<!--[\s\S]*?-->\s*)*<HWPML[\s>]/i.test(text)) return { format: "hwpml", zip: null, signature: "xml:HWPML" };
  if (/^<(!doctype\s+html|html[\s>]|head[\s>]|body[\s>])/i.test(text)) throw new JobError("INPUT_IS_HTML", "원문 대신 HTML 화면(오류·로그인 페이지 등)이 저장되었습니다.");
  throw new JobError("UNSUPPORTED_FORMAT", "지원하는 문서 시그니처가 아닙니다.");
}

/** kordoc의 형식 판별과 대조한다. 둘이 다르면 어느 쪽도 믿지 않고 거절한다(확장자 위장·손상 의심). */
export async function confirmWithKordoc(bytes, sniffed, kordoc) {
  const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  let reported;
  if (["hwpx", "docx", "xlsx", "pptx"].includes(sniffed.format)) reported = await kordoc.detectZipFormat(buffer);
  else if (["hwp", "xls"].includes(sniffed.format)) reported = kordoc.detectOle2Format(buffer);
  else reported = kordoc.detectFormat(buffer);
  if (reported !== sniffed.format) throw new JobError("FORMAT_AMBIGUOUS", "파일 시그니처 판별(" + sniffed.format + ")과 kordoc 판별(" + reported + ")이 다릅니다.");
  return reported;
}

/** 하위 호환 이름(시그니처 판별만). */
export function detectInput(bytes, limits) {
  return sniffFormat(bytes, limits);
}

/** 원문 바이트를 한 번 읽어 해시를 대조한다. 이후 파서에는 이 Buffer만 넘긴다(파일 경로·filePath 미전달). */
export function readVerifiedInput(validated) {
  const size = statSync(validated.inputReal).size;
  if (size > validated.limits.maxInputBytes) throw new JobError("INPUT_TOO_LARGE", "입력 원문이 상한을 넘습니다.");
  const bytes = readFileSync(validated.inputReal);
  const digest = sha256Hex(bytes);
  if (digest !== validated.job.expected_sha256) throw new JobError("HASH_MISMATCH", "입력 원문 해시가 작업 명세와 다릅니다.");
  const sniffed = sniffFormat(bytes, validated.limits);
  return { bytes, digest, ...sniffed, extension: extensionCheck(validated.job.input_ref, sniffed.format) };
}
