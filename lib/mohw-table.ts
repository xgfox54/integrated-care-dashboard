import type { OfficialService } from "./official-source.ts";
import {
  columnGlyphs,
  detectMohwLayout,
  glyphBlocks,
  groupGlyphLines,
  glyphText,
  parseMohwGlyphs,
  type MohwGlyph,
  type MohwLayout,
} from "./mohw-glyphs.ts";

export interface SynapPreviewLocation {
  readonly indexUrl: string;
  readonly pageUrl: (page: number) => string;
}

export interface SynapTableContext {
  readonly documentId: string;
  readonly sido: string;
  readonly sigungu: string;
  readonly detailUrl: string;
  readonly updatedDate: string;
  readonly pageNumber: number;
}

interface RowBand {
  readonly serial: string;
  readonly center: number;
  readonly top: number;
  readonly bottom: number;
}

export function parseSynapPreviewLocation(value: string): SynapPreviewLocation {
  const url = new URL(value);
  const fileName = url.searchParams.get("fn") ?? "";
  const resultPath = url.searchParams.get("rs") ?? "";
  if (url.hostname !== "www.mohw.go.kr" || !/^[A-Za-z0-9._-]+\.pdf$/i.test(fileName)) {
    throw new Error("보건복지부 미리보기 파일 주소가 올바르지 않습니다.");
  }
  if (!/^\/upload\/result\/[A-Za-z0-9/_-]+\/$/.test(resultPath)) {
    throw new Error("보건복지부 미리보기 결과 경로가 올바르지 않습니다.");
  }
  const base = new URL(resultPath, "https://www.mohw.go.kr").toString();
  return {
    indexUrl: `${base}${fileName}.xml`,
    pageUrl: (page) => `${base}${fileName}.files/${fileName}_${page}.xml`,
  };
}

export function synapPageCount(xml: string): number {
  const count = Number(xml.match(/<pdf_cnt>\s*(\d+)\s*<\/pdf_cnt>/i)?.[1] ?? "0");
  if (!Number.isInteger(count) || count < 1 || count > 100) {
    throw new Error("보건복지부 미리보기 쪽수를 확인하지 못했습니다.");
  }
  return count;
}

function centerOf(glyphs: readonly MohwGlyph[]): number {
  const top = Math.min(...glyphs.map((glyph) => glyph.y));
  const bottom = Math.max(...glyphs.map((glyph) => glyph.y + glyph.height));
  return (top + bottom) / 2;
}

function rowBands(layout: MohwLayout, glyphs: readonly MohwGlyph[]): readonly RowBand[] {
  const serialGlyphs = columnGlyphs(layout, glyphs, "serial").filter(
    (glyph) => glyph.y > layout.headerBottom && glyph.y < layout.pageHeight - 25,
  );
  const serialBlocks: MohwGlyph[][] = [];
  for (const glyph of serialGlyphs.filter((entry) => /^[\d-]+$/.test(entry.text)).sort(
    (left, right) => left.y - right.y || left.x - right.x,
  )) {
    const previous = serialBlocks.at(-1);
    const previousY = previous ? Math.max(...previous.map((entry) => entry.y)) : 0;
    if (previous && glyph.y - previousY <= 15) previous.push(glyph);
    else serialBlocks.push([glyph]);
  }
  let anchors = serialBlocks.flatMap((block) => {
    const serial = [...block].sort((left, right) => left.x - right.x || left.y - right.y)
      .map((glyph) => glyph.text).join("").replace(/[^\d-]/g, "");
    return /^\d+(?:-\d+)*$/.test(serial) ? [{ serial, center: centerOf(block) }] : [];
  });
  if (anchors.length === 0) {
    const source = columnGlyphs(layout, glyphs, "sourceType").filter(
      (glyph) => glyph.y > layout.headerBottom && glyph.y < layout.pageHeight - 25,
    );
    anchors = glyphBlocks(source).filter((block) => glyphText(block)).map((block) => ({
      serial: "",
      center: centerOf(block),
    }));
  }
  if (anchors.length === 0) {
    const names = columnGlyphs(layout, glyphs, "name").filter(
      (glyph) => glyph.y > layout.headerBottom && glyph.y < layout.pageHeight - 25,
    );
    anchors = glyphBlocks(names).filter((block) => glyphText(block)).map((block) => ({
      serial: "",
      center: centerOf(block),
    }));
  }
  return anchors.map((anchor, index) => ({
    ...anchor,
    top: index === 0 ? layout.headerBottom : ((anchors[index - 1]?.center ?? anchor.center) + anchor.center) / 2,
    bottom: index === anchors.length - 1
      ? layout.pageHeight - 20
      : (anchor.center + (anchors[index + 1]?.center ?? anchor.center)) / 2,
  }));
}

function columnBlocks(glyphs: readonly MohwGlyph[], bands: readonly RowBand[]): readonly (readonly MohwGlyph[])[] {
  const gaps = bands.slice(1).map((band, index) => band.center - (bands[index]?.center ?? band.center));
  const sortedGaps = [...gaps].sort((left, right) => left - right);
  const middleGap = sortedGaps[Math.floor(sortedGaps.length / 2)] ?? 40;
  const threshold = Math.min(25, Math.max(14, middleGap * 0.45));
  const blocks: MohwGlyph[][] = [];
  for (const line of groupGlyphLines(glyphs)) {
    const previous = blocks.at(-1);
    const previousY = previous ? Math.max(...previous.map((glyph) => glyph.y)) : 0;
    if (previous && line.y - previousY <= threshold) previous.push(...line.glyphs);
    else blocks.push([...line.glyphs]);
  }
  return blocks;
}

function mergedColumnValues(
  layout: MohwLayout,
  glyphs: readonly MohwGlyph[],
  key: string,
  bands: readonly RowBand[],
): readonly string[] {
  const blocks = columnBlocks(columnGlyphs(layout, glyphs, key).filter(
    (glyph) => glyph.y > layout.headerBottom && glyph.y < layout.pageHeight - 20,
  ), bands).filter((block) => glyphText(block));
  if (blocks.length === 0) return bands.map(() => "");
  const boundaries = bands.slice(0, -1).map((band) => band.bottom);
  const result = bands.map(() => "");
  let start = layout.headerBottom;
  blocks.forEach((block, index) => {
    const center = centerOf(block);
    const idealEnd = 2 * center - start;
    const end = index === blocks.length - 1
      ? layout.pageHeight
      : boundaries.filter((value) => value > start).sort(
        (left, right) => Math.abs(left - idealEnd) - Math.abs(right - idealEnd),
      )[0] ?? layout.pageHeight;
    const value = glyphText(block).replace(/\s+/g, "");
    bands.forEach((band, rowIndex) => {
      if (band.center >= start && band.center < end) result[rowIndex] = value;
    });
    start = end;
  });
  return result;
}

function cellValue(
  layout: MohwLayout,
  glyphs: readonly MohwGlyph[],
  key: string,
  band: RowBand,
): string {
  return glyphText(columnGlyphs(layout, glyphs, key).filter(
    (glyph) => glyph.y + glyph.height / 2 >= band.top && glyph.y + glyph.height / 2 < band.bottom,
  ));
}

export function parseSynapTablePage(xml: string, context: SynapTableContext): readonly OfficialService[] {
  const parsed = parseMohwGlyphs(xml);
  const layout = detectMohwLayout(parsed.glyphs, parsed.height);
  const bands = rowBands(layout, parsed.glyphs);
  const categories = mergedColumnValues(layout, parsed.glyphs, "category", bands);
  const subcategories = mergedColumnValues(layout, parsed.glyphs, "subcategory", bands);
  return bands.flatMap((band, index) => {
    const name = cellValue(layout, parsed.glyphs, "name", band);
    if (!name) return [];
    const sourceType = cellValue(layout, parsed.glyphs, "sourceType", band).replace(/\s+/g, "");
    const type = cellValue(layout, parsed.glyphs, "type", band).replace(/\s+/g, "") || sourceType;
    return [{
      serviceId: `${context.documentId}:${context.pageNumber}:${band.serial || index + 1}`,
      sido: context.sido,
      sigungu: context.sigungu,
      category: categories[index] ?? "",
      subcategory: subcategories[index] ?? "",
      name,
      description: cellValue(layout, parsed.glyphs, "description", band),
      target: cellValue(layout, parsed.glyphs, "target", band),
      detailTarget: cellValue(layout, parsed.glyphs, "detailTarget", band),
      provider: cellValue(layout, parsed.glyphs, "provider", band),
      type,
      serial: band.serial,
      detailUrl: context.detailUrl,
      updatedDate: context.updatedDate,
    }];
  });
}
