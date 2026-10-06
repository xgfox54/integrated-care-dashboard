// 반입 ZIP 읽기(작업지시서 v5 §10.7). 풀기 전에 중앙 디렉터리로 경로·중복·암호화·symlink·크기·압축비를 검사하고,
// 푸는 동안에도 실제 크기가 선언값을 넘으면 멈춘다. ZIP64·암호화·stored/deflate 외 압축은 받지 않는다.
import { crc32 } from "../platform/zip-writer.ts";

export const ZIP_LIMITS = {
  archiveBytes: 25 * 1024 * 1024,
  totalUncompressed: 100 * 1024 * 1024,
  entries: 100,
  ratio: 100,
} as const;

export class ZipSafetyError extends Error {
  readonly code: string;
  readonly path: string;
  constructor(code: string, path = "") {
    super(code + (path ? " (" + path + ")" : ""));
    this.code = code;
    this.path = path;
  }
}

export interface ZipEntry {
  readonly path: string;
  readonly bytes: Uint8Array;
}

const utf8 = new TextDecoder("utf-8", { fatal: true });

/** 경로 이름 검사. 절대·상위·드라이브·역슬래시·빈 조각·NFC 아님을 거절한다. */
export function safeEntryPath(name: string): boolean {
  if (!name || name.length > 200 || name !== name.normalize("NFC")) return false;
  if (name.startsWith("/") || name.includes("\\") || name.includes(":") || /[\u0000-\u001f]/.test(name)) return false;
  return name.split("/").every((part) => part !== "" && part !== "." && part !== "..");
}

async function inflateRaw(data: Uint8Array, limit: number, path: string): Promise<Uint8Array> {
  const stream = new Blob([data as Uint8Array<ArrayBuffer>]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    if (total > limit) {
      await reader.cancel();
      throw new ZipSafetyError("ZIP_SIZE_MISMATCH", path);
    }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
}

/** ZIP을 검사하며 푼다. 하나라도 어기면 ZipSafetyError. 디렉터리 항목(이름이 /로 끝나고 0바이트)은 건너뛴다. */
export async function readZip(archive: Uint8Array): Promise<ZipEntry[]> {
  if (archive.length > ZIP_LIMITS.archiveBytes) throw new ZipSafetyError("ARCHIVE_TOO_LARGE");
  const view = new DataView(archive.buffer, archive.byteOffset, archive.byteLength);
  let end = -1;
  for (let index = archive.length - 22; index >= Math.max(0, archive.length - 22 - 65535); index -= 1) {
    if (view.getUint32(index, true) === 0x06054b50) {
      end = index;
      break;
    }
  }
  if (end < 0) throw new ZipSafetyError("NOT_A_ZIP");
  const count = view.getUint16(end + 10, true);
  const centralSize = view.getUint32(end + 12, true);
  const centralOffset = view.getUint32(end + 16, true);
  if (count === 0xffff || centralOffset === 0xffffffff) throw new ZipSafetyError("ZIP64_NOT_SUPPORTED");
  if (count > ZIP_LIMITS.entries) throw new ZipSafetyError("TOO_MANY_ENTRIES");
  if (centralOffset + centralSize > end) throw new ZipSafetyError("ZIP_STRUCTURE_INVALID");

  const seen = new Set<string>();
  const planned: { path: string; method: number; crc: number; compressed: number; size: number; local: number }[] = [];
  let declaredTotal = 0;
  let cursor = centralOffset;
  for (let index = 0; index < count; index += 1) {
    if (cursor + 46 > end || view.getUint32(cursor, true) !== 0x02014b50) throw new ZipSafetyError("ZIP_STRUCTURE_INVALID");
    const flags = view.getUint16(cursor + 8, true);
    const method = view.getUint16(cursor + 10, true);
    const crc = view.getUint32(cursor + 16, true);
    const compressed = view.getUint32(cursor + 20, true);
    const size = view.getUint32(cursor + 24, true);
    const nameLength = view.getUint16(cursor + 28, true);
    const extraLength = view.getUint16(cursor + 30, true);
    const commentLength = view.getUint16(cursor + 32, true);
    const external = view.getUint32(cursor + 38, true);
    const local = view.getUint32(cursor + 42, true);
    let path: string;
    try {
      path = utf8.decode(archive.subarray(cursor + 46, cursor + 46 + nameLength));
    } catch (error) {
      if (error instanceof TypeError) throw new ZipSafetyError("ENTRY_NAME_NOT_UTF8");
      throw error;
    }
    cursor += 46 + nameLength + extraLength + commentLength;
    if (path.endsWith("/") && size === 0) continue;
    if (flags & 0x1) throw new ZipSafetyError("ENCRYPTED_ENTRY", path);
    if (((external >>> 16) & 0xf000) === 0xa000) throw new ZipSafetyError("SYMLINK_ENTRY", path);
    if (!safeEntryPath(path)) throw new ZipSafetyError("UNSAFE_PATH", path);
    const key = path.toLowerCase();
    if (seen.has(key)) throw new ZipSafetyError("DUPLICATE_ENTRY", path);
    seen.add(key);
    if (method !== 0 && method !== 8) throw new ZipSafetyError("COMPRESSION_NOT_SUPPORTED", path);
    if (method === 0 && compressed !== size) throw new ZipSafetyError("ZIP_SIZE_MISMATCH", path);
    if (compressed > 0 && size / compressed > ZIP_LIMITS.ratio) throw new ZipSafetyError("COMPRESSION_RATIO_TOO_HIGH", path);
    if (compressed === 0 && size > 0) throw new ZipSafetyError("COMPRESSION_RATIO_TOO_HIGH", path);
    declaredTotal += size;
    if (declaredTotal > ZIP_LIMITS.totalUncompressed) throw new ZipSafetyError("UNCOMPRESSED_TOO_LARGE", path);
    planned.push({ path, method, crc, compressed, size, local });
  }

  const entries: ZipEntry[] = [];
  for (const entry of planned) {
    if (entry.local + 30 > archive.length || view.getUint32(entry.local, true) !== 0x04034b50) throw new ZipSafetyError("ZIP_STRUCTURE_INVALID", entry.path);
    const nameLength = view.getUint16(entry.local + 26, true);
    const extraLength = view.getUint16(entry.local + 28, true);
    const start = entry.local + 30 + nameLength + extraLength;
    if (start + entry.compressed > centralOffset) throw new ZipSafetyError("ZIP_STRUCTURE_INVALID", entry.path);
    const raw = archive.subarray(start, start + entry.compressed);
    const bytes = entry.method === 0 ? raw.slice() : await inflateRaw(raw, entry.size, entry.path);
    if (bytes.length !== entry.size) throw new ZipSafetyError("ZIP_SIZE_MISMATCH", entry.path);
    if (crc32(bytes) !== entry.crc) throw new ZipSafetyError("CRC_MISMATCH", entry.path);
    entries.push({ path: entry.path, bytes });
  }
  return entries;
}
