// 복지제도100의 복지톡 DB 연결은 39종 합본 Markdown의 줄 번호로 만들어진다.
// 원본 PDF를 쪽 단위로 파싱한 코퍼스와 본문을 맞대어, 각 연결이 어느 원본 파일의 몇 쪽인지 찾고 그 쪽의 문장을 그대로 발췌한다.
// 두 파싱본은 띄어쓰기·표 기호가 달라 글자와 숫자만 남긴 16자 조각으로 대조한다.
import fs from "node:fs";
import path from "node:path";

const REVISIONS = JSON.parse(fs.readFileSync(new URL("../../data/welfare100/manual-corpus-revisions.json", import.meta.url), "utf8"));
export const COMBINED_REVISION = REVISIONS.combined;
export const ORIGINALS_REVISION = REVISIONS.original;
const GRAM = 16;
const SEPARATOR = "\u0001";
const MODULUS = 2147483647;
const BASE = 131;
const SLOT = 33554432;
// 제목 연결은 제목 아래 본문을, 본문 속 언급은 일치한 줄 가까이만 옮긴다.
const HEADING_QUOTE = { chars: 420, lines: 12 };
const MENTION_QUOTE = { chars: 220, lines: 4 };
const QUOTE_MAX_CHARS = 600;
// 원본 파일의 쪽 조각 가운데 이 비율 이상이 한 합본 매뉴얼에 들어 있어야 그 매뉴얼의 원본으로 본다.
const ORIGINAL_SHARE_MIN = 0.3;

const keepOnly = (text) => text.normalize("NFKC").replace(/[ㆍᆞ]/g, "").replace(/[^\p{L}\p{N}]+/gu, "").toLowerCase();
export const normalizeForMatch = (text) => keepOnly(String(text ?? "").replace(/!\[[^\]]*\]\([^)]*\)/g, "").replace(/<[^>]+>/g, ""));

export function readCorpus(root, revision) {
  const dir = path.join(root, revision);
  const documents = new Map();
  const sections = [];
  for (const file of fs.readdirSync(dir).filter((name) => /^batch-\d+\.json$/.test(name)).sort()) {
    const batch = JSON.parse(fs.readFileSync(path.join(dir, file), "utf8"));
    for (const document of batch.documents) documents.set(document.document_id, document);
    sections.push(...batch.sections);
  }
  return { documents, sections };
}

/** 합본 코퍼스의 절을 줄 번호 순서로 되살린다. 키는 파일 이름 앞 두 자리(01~39)다. */
export function combinedManualLines(corpus) {
  const byDocument = new Map();
  for (const section of corpus.sections) {
    const list = byDocument.get(section.document_id) ?? [];
    list.push(section);
    byDocument.set(section.document_id, list);
  }
  const manuals = new Map();
  for (const [documentId, sections] of byDocument) {
    const key = corpus.documents.get(documentId).source_name.slice(0, 2);
    const lines = [];
    for (const section of sections) {
      const parts = section.content.split("\n");
      for (let offset = 0; offset <= section.end_line - section.start_line; offset += 1) lines[section.start_line - 1 + offset] = (parts[offset] ?? "").replace(/\r$/, "");
    }
    manuals.set(key, lines);
  }
  return manuals;
}

export function originalPages(corpus) {
  const pages = [];
  for (const section of corpus.sections) {
    const match = section.heading_path.match(/> (PDF 물리 쪽|HWPX 구역\/부분) (\d+)$/);
    if (!match || section.content.startsWith("# 원본 파일:")) continue;
    pages.push({
      documentId: section.document_id,
      file: corpus.documents.get(section.document_id).source_name,
      format: match[1] === "PDF 물리 쪽" ? "PDF" : "HWPX",
      page: Number(match[2]),
      raw: section.content,
      ocr: section.content.includes("OCR 자동 추출 후보 쪽"),
    });
  }
  return pages.sort((a, b) => a.documentId.localeCompare(b.documentId) || a.page - b.page);
}

function gramIndex(text) {
  let power = 1;
  for (let index = 0; index < GRAM - 1; index += 1) power = (power * BASE) % MODULUS;
  const keys = new Float64Array(text.length);
  let count = 0;
  let hash = 0;
  let run = 0;
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index);
    if (index >= GRAM) hash = (hash - ((text.charCodeAt(index - GRAM) * power) % MODULUS) + MODULUS) % MODULUS;
    hash = (hash * BASE + code) % MODULUS;
    run = code === 1 ? 0 : run + 1;
    if (run >= GRAM) keys[count++] = (hash & 0x0fffffff) * SLOT + (index - GRAM + 1);
  }
  const sorted = keys.subarray(0, count).sort();
  const lowerBound = (value) => {
    let low = 0;
    let high = sorted.length;
    while (low < high) {
      const middle = (low + high) >> 1;
      if (sorted[middle] < value) low = middle + 1;
      else high = middle;
    }
    return low;
  };
  return (gram) => {
    if (gram.length !== GRAM) return [];
    let hash = 0;
    for (let index = 0; index < GRAM; index += 1) hash = (hash * BASE + gram.charCodeAt(index)) % MODULUS;
    const bucket = (hash & 0x0fffffff) * SLOT;
    const positions = [];
    for (let index = lowerBound(bucket); index < sorted.length && sorted[index] < bucket + SLOT; index += 1) {
      const position = sorted[index] - bucket;
      if (text.startsWith(gram, position)) positions.push(position);
    }
    return positions;
  };
}

function concatenate(texts) {
  const starts = new Uint32Array(texts.length);
  let offset = 0;
  texts.forEach((value, index) => {
    starts[index] = offset;
    offset += value.length + 1;
  });
  if (offset >= SLOT) throw new Error("대조용 본문이 색인 한도를 넘었습니다.");
  const owner = (position) => {
    let low = 0;
    let high = starts.length - 1;
    while (low < high) {
      const middle = (low + high + 1) >> 1;
      if (starts[middle] <= position) low = middle;
      else high = middle - 1;
    }
    return low;
  };
  return { text: texts.join(SEPARATOR) + SEPARATOR, owner, start: (index) => starts[index] };
}

/** 원본 쪽 텍스트를 화면 줄로 바꾼다. 표는 칸을 " | "로 잇고 이미지·파서 표지·글자 한 개짜리 OCR 잡음 줄만 뺀다. 낱말은 바꾸지 않는다. */
export function displayLines(raw) {
  const lines = [];
  for (const sourceLine of raw.split("\n")) {
    const line = sourceLine.replace(/\r$/, "");
    if (/^#{1,6}\s*(PDF 물리 쪽|HWPX XML 구역)/.test(line) || /^\[kordoc [^\]]*\]$/.test(line.trim())) continue;
    const withoutImages = line.replace(/!\[[^\]]*\]\([^)]*\)/g, "");
    const rows = /<t[rdh][\s>]/i.test(withoutImages) ? withoutImages.split(/<\/tr>/i) : [withoutImages];
    for (const row of rows) {
      // 표 칸 안의 <br>은 원본의 줄바꿈이라 화면 줄로 살린다.
      for (const part of row.replace(/<br\s*\/?>/gi, "\n").replace(/<\/t[dh]>/gi, " | ").replace(/<[^>]+>/g, "").split("\n")) {
        let text = part;
        if (/^\s*\|?\s*:?-{3,}/.test(text)) continue;
        if (/^\s*\|.*\|\s*$/.test(text)) text = text.trim().slice(1, -1);
        text = text.replace(/^#{1,6}\s+/, "").replace(/\*\*/g, "").replace(/\\([*_|#.\-[\]()~\\])/g, "$1");
        text = text.split("|").map((cell) => cell.replace(/\s+/g, " ").trim()).filter(Boolean).join(" | ");
        if (keepOnly(text).length >= 2) lines.push(text);
      }
    }
  }
  return lines;
}

function pageLines(page) {
  const lines = displayLines(page.raw);
  let flat = "";
  const lineOf = [];
  const charOf = [];
  lines.forEach((line, lineIndex) => {
    let charIndex = 0;
    for (const character of line) {
      const kept = keepOnly(character);
      for (let index = 0; index < kept.length; index += 1) {
        lineOf.push(lineIndex);
        charOf.push(charIndex);
      }
      flat += kept;
      charIndex += character.length;
    }
  });
  return { lines, flat, lineOf, charOf };
}

function quoteAt(view, at, limit) {
  const first = view.lines[view.lineOf[at]];
  if (first.length > QUOTE_MAX_CHARS) {
    const start = Math.max(0, view.charOf[at] - 140);
    const end = Math.min(first.length, view.charOf[at] + limit.chars);
    return (start > 0 ? "… " : "") + first.slice(start, end).trim() + (end < first.length ? " …" : "");
  }
  const picked = [];
  let size = 0;
  for (let index = view.lineOf[at]; index < view.lines.length && size < limit.chars && picked.length < limit.lines; index += 1) {
    const line = view.lines[index];
    if (size + line.length > QUOTE_MAX_CHARS) {
      picked.push(line.slice(0, Math.max(0, QUOTE_MAX_CHARS - size)).trimEnd() + " …");
      break;
    }
    picked.push(line);
    size += line.length;
  }
  return picked.join("\n");
}

const REGION_HEAD = /^(서울|부산|대구|인천|광주|대전|울산|세종|경기|강원|충북|충남|충청|전북|전남|전라|경북|경남|경상|제주)|(특별자치도|특별자치시|광역시|특별시|도|시|군|구)$|^[가-힣]{1,4}형$/;
const NAME_TAIL = /(지원사업|사업|지원|지급|운영|서비스)$/;
/** 사업명에서 원본 쪽 안에서 찾을 이름 후보(긴 것부터). 괄호를 뺀 이름, '·'로 나뉜 각 이름, 지역명 머리말과 '지원사업·사업·지원' 같은 꼬리를 뗀 이름도 쓴다. */
export function nameVariants(names, { tails = true } = {}) {
  const out = new Set();
  const bases = names.filter(Boolean).flatMap((name) => [name, name.replace(/\([^)]*\)/g, " "), ...name.split(/[·ㆍ,]/)]);
  for (const name of bases.map((base) => base.trim()).filter(Boolean)) {
    const tokens = String(name).replace(/^[\[(【][^\])】]*[\])】]\s*/, "").trim().split(/\s+/);
    const core = tokens.length > 1 && REGION_HEAD.test(tokens[0]) ? tokens.slice(1).join(" ") : tokens.join(" ");
    for (const start of [keepOnly(name), keepOnly(core)]) {
      for (let value = start, step = 0; step < (tails ? 3 : 1) && value.length >= 4; step += 1) {
        out.add(value);
        const shorter = value.replace(NAME_TAIL, "");
        if (shorter === value) break;
        value = shorter;
      }
    }
  }
  return [...out].sort((a, b) => b.length - a.length);
}

const MARKER = /^#{1,3}\s*원본 파일:\s*(.+?)\s*$/;
const TITLE_TAILS = new Set(["", "제도", "사업", "지원", "지원사업", "서비스", "서비스사업", "이용", "지급", "운영", "안내", "국민행복카드", "맞춤형급여"]);
/** 원본 파일 이름 비교용. 확장자, 앞 번호, (원본), [분류] 머리말을 떼고 글자만 남긴다. */
const titleKey = (name) => keepOnly(String(name).replace(/\.(md|pdf|hwpx|hwp)$/i, "").replace(/^\(원본\)/, "").replace(/^\d+\./, "").replace(/^\[[^\]]*\]\s*/, ""));

/**
 * manualLines: 합본 매뉴얼 키(01~39)별 줄 배열. pages: originalPages() 결과.
 * locate(key, line, names)는 그 줄이 들어 있는 원본 파일·쪽과 발췌문을 돌려준다.
 */
export function createManualPageLocator({ manualLines, pages }) {
  const pageTexts = pages.map((page) => normalizeForMatch(page.raw));
  const pageCorpus = concatenate(pageTexts);
  const findInPages = gramIndex(pageCorpus.text);
  const manualKeys = [...manualLines.keys()].sort();
  const lineStarts = new Map();
  const manualCorpus = concatenate(manualKeys.map((key) => {
    const starts = [];
    let offset = 0;
    const text = manualLines.get(key).map((line) => {
      starts.push(offset);
      const kept = normalizeForMatch(line);
      offset += kept.length;
      return kept;
    }).join("");
    lineStarts.set(key, starts);
    return text;
  }));
  const findInManuals = gramIndex(manualCorpus.text);
  const manualStarts = manualKeys.map((_, index) => manualCorpus.start(index));
  const lineAt = (key, offset) => {
    const starts = lineStarts.get(key);
    let low = 0;
    let high = starts.length - 1;
    while (low < high) {
      const middle = (low + high + 1) >> 1;
      if (starts[middle] <= offset) low = middle;
      else high = middle - 1;
    }
    return low + 1;
  };

  // 원본 파일마다 쪽 조각이 가장 많이 들어 있는 합본 매뉴얼을 찾고, 합본 줄과 원본 쪽의 대응점을 모은다.
  const pagesByDocument = new Map();
  pages.forEach((page, index) => pagesByDocument.set(page.documentId, [...(pagesByDocument.get(page.documentId) ?? []), index]));
  const documentsByManual = new Map();
  const anchorsByDocument = new Map();
  for (const [documentId, indexes] of pagesByDocument) {
    const counts = new Map();
    const pairs = [];
    let samples = 0;
    for (const index of indexes) {
      const text = pageTexts[index];
      if (text.length < GRAM * 3) continue;
      for (const fraction of [0.25, 0.5, 0.75]) {
        const at = Math.floor(text.length * fraction);
        samples += 1;
        const positions = findInManuals(text.slice(at, at + GRAM));
        const keys = new Set(positions.map((position) => manualKeys[manualCorpus.owner(position)]));
        for (const key of keys) counts.set(key, (counts.get(key) ?? 0) + 1);
        if (positions.length === 1) {
          const owner = manualCorpus.owner(positions[0]);
          pairs.push({ key: manualKeys[owner], line: lineAt(manualKeys[owner], positions[0] - manualStarts[owner]), page: pages[index].page });
        }
      }
    }
    const [best] = [...counts].sort((a, b) => b[1] - a[1]);
    if (!best || best[1] < samples * ORIGINAL_SHARE_MIN) continue;
    documentsByManual.set(best[0], new Set([...(documentsByManual.get(best[0]) ?? []), documentId]));
    const own = pairs.filter((pair) => pair.key === best[0]).sort((a, b) => a.line - b.line);
    anchorsByDocument.set(documentId, own);
  }
  // 원본마다 합본 안에서 차지하는 줄 구간(대응점의 2~98% 범위)을 정한다. 구간 사이의 빈 줄(표지·목차)은 뒤에 오는 원본에 붙인다.
  const spans = new Map();
  for (const [key, documents] of documentsByManual) {
    spans.set(key, [...documents].map((documentId) => {
      const anchors = anchorsByDocument.get(documentId);
      if (anchors.length < 2) return null;
      return { documentId, from: anchors[Math.floor(anchors.length * 0.02)].line, to: anchors[Math.ceil(anchors.length * 0.98) - 1].line };
    }).filter(Boolean).sort((a, b) => a.from - b.from));
  }
  const documentsForLine = (key, line) => {
    const list = spans.get(key) ?? [];
    const covering = list.filter((span) => span.from - 50 <= line && line <= span.to + 50);
    if (covering.length) return covering.map((span) => span.documentId);
    const next = list.find((span) => span.from > line);
    if (next) return list.filter((span) => span.from === next.from).map((span) => span.documentId);
    return list.length ? [list[list.length - 1].documentId] : [];
  };
  // 대응점 사이를 직선으로 이어 합본 줄 번호가 원본 몇 쪽쯤인지 어림한다. 첫 대응점보다 앞(표지·목차)은 같은 기울기로 앞쪽을 어림한다.
  const expectedPage = (documentId, line) => {
    const anchors = anchorsByDocument.get(documentId) ?? [];
    if (anchors.length < 2) return null;
    const first = anchors[0];
    const last = anchors[anchors.length - 1];
    const slope = last.line > first.line ? (last.page - first.page) / (last.line - first.line) : 0;
    if (line <= first.line) return Math.max(1, first.page - (first.line - line) * slope);
    if (line >= last.line) return last.page + (line - last.line) * slope;
    let before = first;
    let after = last;
    for (const anchor of anchors) {
      if (anchor.line <= line) before = anchor;
      else { after = anchor; break; }
    }
    if (after.line === before.line) return before.page;
    return before.page + ((line - before.line) / (after.line - before.line)) * (after.page - before.page);
  };

  // 여러 원본을 합친 매뉴얼은 "## 원본 파일: …" 줄로 원본이 바뀐다. 이 표지가 있으면 통계 대응보다 표지를 따른다.
  const documentByTitle = new Map();
  for (const page of pages) documentByTitle.set(titleKey(page.file), page.documentId);
  const markersByManual = new Map();
  for (const [key, lines] of manualLines) {
    const markers = [];
    lines.forEach((text, index) => {
      const match = text.match(MARKER);
      if (match) markers.push({ line: index + 1, documentId: documentByTitle.get(titleKey(match[1])) ?? null });
    });
    if (markers.length) markersByManual.set(key, markers);
  }
  const markerAt = (key, line) => {
    const markers = markersByManual.get(key);
    if (!markers) return undefined;
    let current = markers[0];
    for (const marker of markers) if (marker.line <= line) current = marker;
    return current;
  };

  const wholeDocument = (documentId) => {
    const indexes = pagesByDocument.get(documentId);
    const first = pages[indexes[0]];
    const last = pages[indexes[indexes.length - 1]];
    return { status: "DOCUMENT", expectedPage: null, original: { file: first.file, format: first.format, page: first.page, ...(last.page > first.page ? { pageEnd: last.page } : {}), pages: indexes.length, basis: "document", ocr: false, quote: null } };
  };

  function locate(key, line, names = []) {
    const lines = manualLines.get(key);
    if (!lines || lines[line - 1] === undefined) return { status: "NO_MANUAL_LINE" };
    const assigned = documentsByManual.get(key) ?? new Set();
    if (!assigned.size && !markersByManual.has(key)) return { status: "NO_ORIGINAL" };
    const marker = markerAt(key, line);
    // 원본 파일 제목 줄("## 원본 파일: …")은 그 원본 전체가 이 제도의 안내라는 뜻이다.
    if (marker?.line === line && marker.documentId) return wholeDocument(marker.documentId);
    const covering = marker?.documentId ? [marker.documentId] : documentsForLine(key, line);
    const documents = new Set(covering.length ? covering : assigned);
    const variants = nameVariants(names);
    const heading = /^#{1,6}\s/.test(lines[line - 1]);
    if (heading) {
      // 제목 줄이 원본 파일 제목과 같으면 그 원본 전체를 가리킨다.
      const title = keepOnly(lines[line - 1].replace(/^#{1,6}\s*/, ""));
      const same = title.length >= 8 ? [...assigned].find((documentId) => titleKey(pages[pagesByDocument.get(documentId)[0]].file) === title) : undefined;
      if (same) return wholeDocument(same);
      // 합본 첫머리 제목에 사업명이 있으면, 파일 이름에 사업명이 들어 있는 원본 전체를 가리킨다.
      if (line <= 15) {
        const fileKey = (documentId) => titleKey(pages[pagesByDocument.get(documentId)[0]].file);
        // 같은 이름이 여러 원본 파일 제목에 있으면 제목이 가장 짧은(그 제도만 다루는) 원본을 고른다.
        const titled = [...(assigned.size ? assigned : documents)].filter((documentId) => variants.some((variant) => fileKey(documentId).includes(variant)));
        if (titled.length) return wholeDocument(titled.sort((a, b) => fileKey(a).length - fileKey(b).length || pagesByDocument.get(b).length - pagesByDocument.get(a).length)[0]);
      }
    }
    let stream = "";
    let ownLength = 0;
    for (let current = line; current <= Math.min(lines.length, line + 15) && stream.length < 360; current += 1) {
      const text = normalizeForMatch(lines[current - 1]);
      if (current === line) ownLength = text.length;
      stream += text;
    }
    const grams = [];
    for (let offset = 0; offset + GRAM <= stream.length && offset <= 240; offset += 3) grams.push({ text: stream.slice(offset, offset + GRAM), own: offset < Math.max(ownLength, 1) });
    const scores = new Map();
    const hitsByGram = grams.map((gram) => {
      const hits = new Set();
      for (const position of findInPages(gram.text)) {
        const index = pageCorpus.owner(position);
        if (documents.has(pages[index].documentId)) hits.add(index);
      }
      for (const index of hits) scores.set(index, (scores.get(index) ?? 0) + (gram.own ? 3 : 1));
      return hits;
    });
    let chosen = -1;
    let view = null;
    let at = -1;
    let basis = "context";
    if (scores.size) {
      const top = Math.max(...scores.values());
      const distance = (index) => {
        const expected = expectedPage(pages[index].documentId, line);
        return expected === null ? Number.MAX_SAFE_INTEGER : Math.abs(pages[index].page - expected);
      };
      // 점수가 같으면 합본 줄 위치로 어림한 쪽에 가까운 쪽, 그다음 쪽이 많은 원본(합본 PDF)을 고른다.
      chosen = [...scores].filter(([, score]) => score === top).map(([index]) => index)
        .sort((a, b) => distance(a) - distance(b) || pagesByDocument.get(pages[b].documentId).length - pagesByDocument.get(pages[a].documentId).length || a - b)[0];
      // 같은 문장이 본문과 부록 표에 함께 있으면, 합본 줄 위치로 어림한 쪽에 가까운(±3쪽) 쪽을 고른다.
      const expectedChosen = expectedPage(pages[chosen].documentId, line);
      if (expectedChosen !== null && Math.abs(pages[chosen].page - expectedChosen) > 10) {
        const ownPages = new Set(grams.flatMap((gram, index) => (gram.own ? [...hitsByGram[index]] : [])));
        const nearer = [...ownPages].filter((index) => {
          const expected = expectedPage(pages[index].documentId, line);
          return expected !== null && Math.abs(pages[index].page - expected) <= 3;
        }).sort((a, b) => scores.get(b) - scores.get(a));
        if (nearer.length) chosen = nearer[0];
      }
      view = pageLines(pages[chosen]);
      for (const gram of grams.filter((item) => item.own)) {
        at = view.flat.indexOf(gram.text);
        if (at >= 0) {
          basis = "line";
          break;
        }
      }
    }
    if (at < 0) {
      // 줄 자체를 찾지 못하면 사업명이 나오는 쪽을 찾는다. 고른 쪽과 앞뒤 쪽을 먼저, 대조가 전혀 안 맞았으면 어림한 쪽에 가까운 쪽부터 본다.
      const near = chosen >= 0
        ? [chosen, chosen - 1, chosen + 1].filter((index) => pages[index]?.documentId === pages[chosen].documentId)
        : [...documents].flatMap((documentId) => {
          const expected = expectedPage(documentId, line);
          return pagesByDocument.get(documentId)
            .filter((index) => expected === null || Math.abs(pages[index].page - expected) <= 10)
            .map((index) => ({ index, gap: expected === null ? 0 : Math.abs(pages[index].page - expected) }));
        }).sort((a, b) => a.gap - b.gap).map((item) => item.index);
      search: for (const index of near) {
        if (!variants.some((variant) => pageTexts[index].includes(variant))) continue;
        const candidate = index === chosen ? view : pageLines(pages[index]);
        for (const variant of variants) {
          const found = candidate.flat.indexOf(variant);
          if (found >= 0) {
            chosen = index;
            view = candidate;
            at = found;
            basis = "name";
            break search;
          }
        }
      }
    }
    if (chosen < 0) return { status: "NOT_FOUND" };
    if (basis === "context") {
      // 뒤 문장으로만 쪽을 정한 경우: 어림한 쪽과 멀면 버리고, 제목 줄일 때만 제목 아래 본문을 발췌한다.
      const expected = expectedPage(pages[chosen].documentId, line);
      if (expected !== null && Math.abs(pages[chosen].page - expected) > 3) return { status: "CONTEXT_FAR" };
      at = -1;
    }
    if (at >= 0 && basis !== "context" && !(heading && basis === "line") && variants.length) {
      // 발췌 구간에 사업명이 없고 같은 쪽 다른 줄에 있으면 사업명이 나오는 줄부터 옮긴다.
      const quoted = keepOnly(quoteAt(view, at, heading ? HEADING_QUOTE : MENTION_QUOTE));
      if (!variants.some((variant) => quoted.includes(variant))) {
        for (const variant of variants) {
          const found = view.flat.indexOf(variant);
          if (found >= 0) {
            at = found;
            break;
          }
        }
      }
    }
    const page = pages[chosen];
    let pageEnd = page.page;
    if (heading && basis !== "name") {
      // 제목 아래 본문이 이어지는 쪽만 따라간다. 반복되는 머리말이 다음 여러 쪽에 걸쳐 잡혀도 건너뛰지 않는다.
      for (const hits of hitsByGram) {
        const pagesHit = new Set([...hits].filter((index) => pages[index].documentId === page.documentId).map((index) => pages[index].page));
        if (!pagesHit.has(pageEnd) && pagesHit.has(pageEnd + 1)) pageEnd += 1;
      }
    }
    const expected = expectedPage(page.documentId, line);
    const sectionQuote = at >= 0 ? quoteAt(view, at, heading ? HEADING_QUOTE : MENTION_QUOTE) : null;
    const nextHeading = heading ? lines.slice(line).find(text => /^#{1,6}\s/.test(text)) : null;
    const quoteLines = sectionQuote?.split("\n") ?? [];
    const boundary = nextHeading ? quoteLines.findIndex(text => normalizeForMatch(text) === normalizeForMatch(nextHeading)) : -1;
    return {
      status: basis.toUpperCase(),
      expectedPage: expected === null ? null : Math.round(expected),
      original: {
        file: page.file,
        format: page.format,
        page: page.page,
        ...(pageEnd > page.page ? { pageEnd } : {}),
        pages: pagesByDocument.get(page.documentId).length,
        basis,
        ocr: page.ocr,
        quote: boundary >= 0 ? quoteLines.slice(0, boundary).join("\n") : sectionQuote,
      },
    };
  }

  // 주요 제도 설명의 근거 매뉴얼에서 제도 자리를 찾는다. 원본 파일 이름에 제도명이 있으면 그 원본 전체,
  // 아니면 제도명만 있는 제목 줄(앞 번호 허용) 바로 뒤에 본문이 이어지는 첫 쪽이다. 끝이 숫자인 줄은 목차로 보고 건너뛴다.
  function locateProgram(key, names) {
    const variants = nameVariants(names);
    const candidates = [...new Set([...(documentsByManual.get(key) ?? []), ...(markersByManual.get(key) ?? []).map((marker) => marker.documentId).filter(Boolean)])].sort();
    if (!candidates.length || !variants.length) return { status: "NO_ORIGINAL" };
    const fileKey = (documentId) => titleKey(pages[pagesByDocument.get(documentId)[0]].file);
    for (const variant of nameVariants(names, { tails: false })) {
      const titled = candidates.filter((documentId) => fileKey(documentId).includes(variant));
      if (titled.length) return wholeDocument(titled.sort((a, b) => fileKey(a).length - fileKey(b).length)[0]);
    }
    for (const variant of variants) {
      for (const documentId of candidates) {
        for (const index of pagesByDocument.get(documentId)) {
          if (!pageTexts[index].includes(variant)) continue;
          const view = pageLines(pages[index]);
          for (let lineIndex = 0; lineIndex < view.lines.length - 1; lineIndex += 1) {
            const raw = view.lines[lineIndex];
            const title = keepOnly(raw).replace(/^(제\d+[장절편부]|\d+|[ivx]+)/, "");
            const next = view.lines[lineIndex + 1];
            // 제목은 제도명 뒤에 '제도·사업·서비스' 같은 말만 붙는다. 표 행(번호 칸 하나와 제도명뿐인 행은 제목)·목록 줄과 표 칸 조각, 목차 줄은 뺀다.
            if (!title.startsWith(variant) || !TITLE_TAILS.has(title.slice(variant.length))) continue;
            const cells = raw.split(" | ");
            const numbered = cells.length === 2 && /^[\dⅠ-Ⅻ①-⑳]+\.?$/.test(cells[0].trim());
            if ((cells.length > 1 && !numbered) || next.includes(" | ") || /^[:\-–∙•※*·○◦▪]/.test(raw) || /[,·、]$/.test(raw.trim())) continue;
            if (/\d\s*$/.test(raw) || /\d\s*$/.test(next) || keepOnly(next).length < 5) continue;
            const page = pages[index];
            return { status: "NAME", expectedPage: null, original: { file: page.file, format: page.format, page: page.page, pages: pagesByDocument.get(documentId).length, basis: "name", ocr: page.ocr, quote: quoteAt(view, view.lineOf.indexOf(lineIndex), HEADING_QUOTE) } };
          }
        }
      }
    }
    return { status: "NOT_FOUND" };
  }

  return { locate, locateProgram, documentsByManual };
}

