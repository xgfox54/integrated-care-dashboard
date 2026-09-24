export interface MohwGlyph {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly text: string;
}

export interface MohwColumn {
  readonly key: string;
  readonly center: number;
}

export interface MohwLayout {
  readonly columns: readonly MohwColumn[];
  readonly boundaries: readonly number[];
  readonly headerBottom: number;
  readonly pageHeight: number;
}

interface GlyphLine {
  readonly y: number;
  readonly glyphs: readonly MohwGlyph[];
}

const HEADER_LABELS = [
  ["category", "대분류"],
  ["category", "대"],
  ["subcategory", "중분류"],
  ["subcategory", "중"],
  ["serial", "연번"],
  ["serial", "번호"],
  ["serial", "연"],
  ["ignoreSubject", "사업주체"],
  ["ignoreMethod", "방식"],
  ["type", "유형"],
  ["name", "서비스명"],
  ["name", "사업명"],
  ["description", "서비스내용"],
  ["description", "사업내용"],
  ["description", "내용"],
  ["detailTarget", "지원대상(상세)"],
  ["target", "세부대상자"],
  ["target", "지원대상"],
  ["target", "대상자범주"],
  ["provider", "서비스제공기관"],
  ["provider", "제공기관"],
  ["provider", "제공주체"],
  ["provider", "기관"],
  ["ignoreCost", "서비스비용"],
  ["ignoreNote", "비고"],
  ["ignorePage", "페이지"],
  ["kind", "구분"],
] as const;

function decodeXml(value: string): string {
  return value.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (entity, code: string) => {
    const normalized = code.toLowerCase();
    if (normalized === "amp") return "&";
    if (normalized === "lt") return "<";
    if (normalized === "gt") return ">";
    if (normalized === "quot") return '"';
    if (normalized === "apos") return "'";
    const radix = normalized.startsWith("#x") ? 16 : 10;
    const offset = radix === 16 ? 2 : 1;
    const point = Number.parseInt(normalized.slice(offset), radix);
    return Number.isFinite(point) ? String.fromCodePoint(point) : entity;
  });
}

function numberAttribute(source: string, name: string): number {
  const match = source.match(new RegExp(`\\b${name}=['\"]([^'\"]+)['\"]`, "i"));
  const value = Number(match?.[1] ?? "0");
  return Number.isFinite(value) ? value : 0;
}

export function parseMohwGlyphs(xml: string): { readonly glyphs: readonly MohwGlyph[]; readonly height: number } {
  const page = xml.match(/<page\b([^>]*)>/i)?.[1] ?? "";
  const glyphs: MohwGlyph[] = [];
  for (const match of xml.matchAll(/<text\b([^>]*)>([\s\S]*?)<\/text>/gi)) {
    const attributes = match[1] ?? "";
    const value = decodeXml((match[2] ?? "").replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1"));
    const text = value.replace(/[\uE000-\uF8FF\u200B-\u200D\uFEFF]/g, "").trim();
    if (!text) continue;
    glyphs.push({
      x: numberAttribute(attributes, "l"),
      y: numberAttribute(attributes, "t"),
      width: numberAttribute(attributes, "w"),
      height: numberAttribute(attributes, "h"),
      text,
    });
  }
  return { glyphs, height: numberAttribute(page, "h") };
}

export function groupGlyphLines(glyphs: readonly MohwGlyph[], tolerance = 3): readonly GlyphLine[] {
  const lines: { y: number; glyphs: MohwGlyph[] }[] = [];
  for (const glyph of [...glyphs].sort((left, right) => left.y - right.y || left.x - right.x)) {
    const line = lines.findLast((candidate) => Math.abs(candidate.y - glyph.y) <= tolerance);
    if (line) {
      line.glyphs.push(glyph);
      line.y = (line.y * (line.glyphs.length - 1) + glyph.y) / line.glyphs.length;
    } else {
      lines.push({ y: glyph.y, glyphs: [glyph] });
    }
  }
  return lines.map((line) => ({ y: line.y, glyphs: line.glyphs.sort((a, b) => a.x - b.x) }));
}

function labelHit(line: GlyphLine, label: string): { readonly center: number; readonly bottom: number } | null {
  const characters = line.glyphs.flatMap((glyph) => [...glyph.text].map((text) => ({ glyph, text })));
  const joined = characters.map((entry) => entry.text).join("");
  const index = joined.indexOf(label);
  if (index < 0) return null;
  const matched = characters.slice(index, index + [...label].length).map((entry) => entry.glyph);
  const left = Math.min(...matched.map((glyph) => glyph.x));
  const right = Math.max(...matched.map((glyph) => glyph.x + glyph.width));
  return { center: (left + right) / 2, bottom: Math.max(...matched.map((glyph) => glyph.y + glyph.height)) };
}

export function detectMohwLayout(glyphs: readonly MohwGlyph[], pageHeight: number): MohwLayout {
  const hits = groupGlyphLines(glyphs.filter((glyph) => glyph.y < pageHeight * 0.35)).flatMap((line) =>
    HEADER_LABELS.flatMap(([key, label]) => {
      const hit = labelHit(line, label);
      return hit ? [{ key, center: hit.center, bottom: hit.bottom, y: line.y, specificity: label.length }] : [];
    }),
  );
  const candidates = hits.map((hit) => ({
    hit,
    score: new Set(hits.filter((other) => Math.abs(other.y - hit.y) <= 25).map((other) => other.key)).size,
  }));
  const best = candidates.sort((left, right) => right.score - left.score)[0];
  if (!best || best.score < 5) throw new Error("보건복지부 문서의 사업 표 머리글을 찾지 못했습니다.");
  const band = hits.filter((hit) => Math.abs(hit.y - best.hit.y) <= 25);
  const plain = new Map<string, MohwColumn & { readonly specificity: number }>();
  for (const hit of band.filter((entry) => entry.key !== "kind")) {
    const current = plain.get(hit.key);
    if (!current || hit.specificity > current.specificity) {
      plain.set(hit.key, { key: hit.key, center: hit.center, specificity: hit.specificity });
    }
  }
  const category = plain.get("category")?.center ?? 0;
  const provider = plain.get("provider")?.center ?? pageHeight;
  for (const hit of band.filter((entry) => entry.key === "kind")) {
    if (hit.center < category) plain.set("sourceType", { key: "sourceType", center: hit.center, specificity: 2 });
    if (hit.center > provider) plain.set("type", { key: "type", center: hit.center, specificity: 2 });
  }
  const columns = [...plain.values()].map(({ key, center }) => ({ key, center })).sort(
    (left, right) => left.center - right.center,
  );
  const required = ["name", "description"];
  if (!required.every((key) => columns.some((column) => column.key === key))) {
    throw new Error("보건복지부 문서의 필수 사업 열을 찾지 못했습니다.");
  }
  const headerBottom = Math.max(...band.map((hit) => hit.bottom)) + 8;
  const content = glyphs.filter((glyph) => glyph.y > headerBottom && glyph.y < pageHeight - 20);
  const boundaries = columns.slice(0, -1).map((column, index) => {
    const next = columns[index + 1];
    if (!next) return column.center;
    const gap = next.center - column.center;
    if (column.key === "serial" && next.key === "name") return column.center + gap * 0.25;
    const low = Math.ceil(column.center + gap * 0.2);
    const high = Math.floor(next.center - gap * 0.2);
    const midpoint = (column.center + next.center) / 2;
    const candidates = Array.from({ length: Math.max(1, high - low + 1) }, (_, offset) => low + offset);
    return candidates.sort((left, right) => {
      const leftScore = content.filter((glyph) => glyph.x < left && glyph.x + glyph.width > left).length;
      const rightScore = content.filter((glyph) => glyph.x < right && glyph.x + glyph.width > right).length;
      return leftScore - rightScore || Math.abs(left - midpoint) - Math.abs(right - midpoint);
    })[0] ?? midpoint;
  });
  return {
    columns,
    boundaries,
    headerBottom,
    pageHeight,
  };
}

export function columnGlyphs(layout: MohwLayout, glyphs: readonly MohwGlyph[], key: string): readonly MohwGlyph[] {
  const index = layout.columns.findIndex((column) => column.key === key);
  if (index < 0) return [];
  const left = index === 0 ? 0 : layout.boundaries[index - 1] ?? 0;
  const right = index === layout.columns.length - 1 ? Number.POSITIVE_INFINITY : layout.boundaries[index];
  return glyphs.filter((glyph) => glyph.x + glyph.width / 2 >= left && glyph.x + glyph.width / 2 < right);
}

function median(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.floor(sorted.length / 2)] ?? 0;
}

export function glyphText(glyphs: readonly MohwGlyph[]): string {
  return groupGlyphLines(glyphs).map((line) => {
    const widths = line.glyphs.map((glyph) => glyph.width / Math.max(1, [...glyph.text].length));
    const spaceAt = Math.max(2, median(widths) * 0.45);
    let result = "";
    let right = 0;
    for (const glyph of line.glyphs) {
      if (result && glyph.x - right > spaceAt) result += " ";
      result += glyph.text;
      right = glyph.x + glyph.width;
    }
    return result.trim();
  }).filter(Boolean).join(" ").replace(/\s+/g, " ").trim();
}

function splitThreshold(values: readonly number[]): number {
  const gaps = values.slice(1).map((value, index) => value - (values[index] ?? value)).filter((gap) => gap > 4);
  if (gaps.length < 2) return 24;
  let low = Math.min(...gaps);
  let high = Math.max(...gaps);
  for (let pass = 0; pass < 6; pass += 1) {
    const lowGroup = gaps.filter((gap) => Math.abs(gap - low) <= Math.abs(gap - high));
    const highGroup = gaps.filter((gap) => Math.abs(gap - low) > Math.abs(gap - high));
    if (lowGroup.length) low = lowGroup.reduce((sum, gap) => sum + gap, 0) / lowGroup.length;
    if (highGroup.length) high = highGroup.reduce((sum, gap) => sum + gap, 0) / highGroup.length;
  }
  return Math.max(12, (low + high) / 2);
}

export function glyphBlocks(glyphs: readonly MohwGlyph[]): readonly (readonly MohwGlyph[])[] {
  const lines = groupGlyphLines(glyphs);
  const threshold = splitThreshold(lines.map((line) => line.y));
  const blocks: MohwGlyph[][] = [];
  for (const line of lines) {
    const previous = blocks.at(-1);
    const previousY = previous ? Math.max(...previous.map((glyph) => glyph.y)) : 0;
    if (previous && line.y - previousY <= threshold) previous.push(...line.glyphs);
    else blocks.push([...line.glyphs]);
  }
  return blocks;
}
