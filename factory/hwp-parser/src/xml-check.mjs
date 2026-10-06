import { inflateRawSync } from "node:zlib";

// HWPX 원본 XML의 표 목록과 파서 결과 표를 대조한다(작업지시서 v5 T57·T76: 누락 구간 일치).
// kordoc을 쓰지 않고 Contents/section*.xml의 hp:tbl id만 센다. 캡션·글상자 안 표처럼 파서가 내보내지 않은 표를 찾아 검토로 돌린다.
const MAX_SECTION_BYTES = 64 * 1024 * 1024;

function sectionXmls(bytes) {
  let eocd = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i -= 1) if (bytes.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) return null;
  const count = bytes.readUInt16LE(eocd + 10);
  let offset = bytes.readUInt32LE(eocd + 16);
  const out = [];
  for (let n = 0; n < count; n += 1) {
    if (bytes.readUInt32LE(offset) !== 0x02014b50) return null;
    const method = bytes.readUInt16LE(offset + 10);
    const compressed = bytes.readUInt32LE(offset + 20);
    const uncompressed = bytes.readUInt32LE(offset + 24);
    const nameLength = bytes.readUInt16LE(offset + 28);
    const extra = bytes.readUInt16LE(offset + 30);
    const comment = bytes.readUInt16LE(offset + 32);
    const local = bytes.readUInt32LE(offset + 42);
    const name = bytes.subarray(offset + 46, offset + 46 + nameLength).toString("utf8");
    offset += 46 + nameLength + extra + comment;
    if (!/^Contents\/section\d+\.xml$/.test(name) || uncompressed > MAX_SECTION_BYTES) continue;
    const start = local + 30 + bytes.readUInt16LE(local + 26) + bytes.readUInt16LE(local + 28);
    const raw = bytes.subarray(start, start + compressed);
    out.push(method === 0 ? raw.toString("utf8") : inflateRawSync(raw, { maxOutputLength: MAX_SECTION_BYTES }).toString("utf8"));
  }
  return out;
}

/** { source_tables, parsed_tables, missing_ids, in_caption_ids } 또는 판독 불가면 null. */
export function hwpxTableCoverage(bytes, parsedSourceIds) {
  const sections = sectionXmls(bytes);
  if (!sections) return null;
  const ids = [];
  const inCaption = new Set();
  for (const xml of sections) {
    let captionDepth = 0;
    for (const match of xml.matchAll(/<hp:caption[\s>]|<\/hp:caption>|<hp:tbl\s[^>]*?id="(\d+)"/g)) {
      if (match[0].startsWith("<hp:caption")) captionDepth += 1;
      else if (match[0] === "</hp:caption>") captionDepth = Math.max(0, captionDepth - 1);
      else { ids.push(match[1]); if (captionDepth > 0) inCaption.add(match[1]); }
    }
  }
  const parsed = new Set(parsedSourceIds.filter(Boolean));
  const missing = ids.filter((id) => !parsed.has(id));
  return { source_tables: ids.length, parsed_tables: parsed.size, missing_ids: missing, in_caption_ids: missing.filter((id) => inCaption.has(id)) };
}
