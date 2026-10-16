// 복지제도100 사업 상세(public/data/welfare100/items)의 복지톡 DB 연결에 원본 파일·PDF 쪽·원문 발췌를 붙인다.
// 주요 제도 100은 설명을 정리한 근거 매뉴얼(record.src)이 연결에 없으면 그 매뉴얼의 원본에서 제도 자리를 찾아 '편집 근거'로 앞에 더한다(줄 번호 0).
// 실행: node scripts/welfare100/attach-manual-pages.mjs [--check] [--report 경로.json]
// --check는 파일을 고치지 않고 결과만 센다. build-catalog.mjs가 끝에서 이 스크립트를 부른다.
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";

import { COMBINED_REVISION, ORIGINALS_REVISION, combinedManualLines, createManualPageLocator, originalPages, readCorpus } from "./manual-pages.mjs";
import { listRowMismatch, listRowRegion, MANUAL_LINK_REVIEWS, manualLinkAllowed, manualLinkReview, manualLinkReviewState, REGION_LIST_MANUALS, talkSourceKeys } from "./manual-link-scope.mjs";
import { writeSplitIndex } from "./split-index.mjs";
import { resolveManualSourceOverride } from "./manual-source-overrides.mjs";
import { replacePrivateSymbolsDeep } from "../../lib/text-symbols.mjs";

const argv = process.argv.slice(2);
const check = argv.includes("--check");
const allowStale = argv.includes("--allow-stale");
const reportPath = argv.includes("--report") ? argv[argv.indexOf("--report") + 1] : null;
const SITE = process.cwd();
const CORPUS = path.join(SITE, "data/manual-corpus/assets/__manual_corpus");
const ITEMS = path.join(path.resolve(SITE, argv.includes("--out") ? argv[argv.indexOf("--out") + 1] : "public/data/welfare100"), "items");
const manualTitles = JSON.parse(fs.readFileSync(path.join(SITE, "data/welfare100/manuals.json"), "utf8"));
const sourceOverrides = JSON.parse(fs.readFileSync(path.join(SITE, "data/welfare100/manual-source-overrides.json"), "utf8"));

const manualLines = combinedManualLines(readCorpus(CORPUS, COMBINED_REVISION));
const pages = originalPages(readCorpus(CORPUS, ORIGINALS_REVISION));
const { locate, locateProgram, documentsByManual } = createManualPageLocator({ manualLines, pages });
const ocrChecks = new Map(JSON.parse(fs.readFileSync(path.join(SITE, "data/welfare100/ocr-page-checks.json"), "utf8")).checks.map((check) => [check.file + "#" + check.page, check]));
const pageHash = new Map(pages.filter((page) => ocrChecks.has(page.file + "#" + page.page)).map((page) => [page.file + "#" + page.page, createHash("sha256").update(page.raw).digest("hex")]));
function withOcrCheck(original) {
  if (!original?.ocr) return original;
  const key = original.file + "#" + original.page;
  const check = ocrChecks.get(key);
  const { ocrCheckedAt: _previous, ...rest } = original;
  return check && pageHash.get(key) === check.page_sha256 ? { ...rest, ocrCheckedAt: check.checked_at } : rest;
}

const counts = {};
const report = [];
const removed = [];
const sourceCounts = new Map();
const reviewCounts = {};
const staleReviews = [];
let changedFiles = 0;
const pendingWrites = [];

const cleanManualLine = (line) => (line ?? "")
  .replace(/!\[[^\]]*\]\([^)]*\)/g, "").replace(/<br\s*\/?>/gi, " ").replace(/<\/t[dh]>/gi, " · ").replace(/<\/tr>/gi, " / ").replace(/<[^>]+>/g, "")
  .replace(/^#{1,6}\s*/, "").replace(/\*\*/g, "").replace(/\|/g, " · ").replace(/(\s·\s)+/g, " · ").replace(/^[\s·]+|[\s·]+$/g, "").replace(/\s+/g, " ").trim();
function sectionAt(key, line) {
  const lines = manualLines.get(key);
  const row = cleanManualLine(lines[line - 1]);
  if (/^\s*(?:<tr>|\|)/.test(lines[line - 1]) || row.length > 120) return { heading: undefined, excerpt: row.slice(0, 560) };
  const heading = cleanManualLine(lines[line - 1]).replace(/^원본 파일:\s*\d+\.\s*/, "").replace(/\.md$/, "").replace(/\+/g, " ");
  const parts = [];
  for (let index = line; index < lines.length && index < line + 40 && parts.join(" ").length < 560; index++) {
    if (lines[index] === undefined) continue;
    if (/^#{1,6}\s/.test(lines[index]) && parts.join(" ").length > 80) break;
    const text = cleanManualLine(lines[index]);
    if (text && !/^[-:|\s·]+$/.test(text) && !/^\d+$/.test(text)) parts.push(text);
  }
  return { heading: heading.slice(0, 80), excerpt: parts.join(" ").slice(0, 560) };
}
// 검수 판정을 연결에 반영한다. 옮김 판정은 그 제도를 다루는 절로 줄을 바꾸고 제목·발췌를 다시 만든다.
// 검수한 줄과 지금 줄의 내용 지문이 다르면 판정을 적용하지 않고 재검수 표시만 남긴다.
function applyReviews(refs, itemId) {
  const seen = new Set();
  return refs.filter((ref) => {
    if (ref.curatedSource) return true;
    const lineAt = (key, line) => manualLines.get(key)?.[line - 1];
    const review = manualLinkReview(itemId, ref.key, ref.line);
    const state = review ? manualLinkReviewState(review, lineAt(ref.key, ref.line), review.to_line ? lineAt(review.to_key, review.to_line) : undefined) : null;
    if (review && state !== "OK") staleReviews.push({ item: itemId, key: ref.key, line: ref.line, decision: review.decision, state, text: String(lineAt(ref.key, ref.line) ?? "").slice(0, 120) });
    if (state === "OK" && review.to_line && (review.to_key !== ref.key || review.to_line !== ref.line)) {
      Object.assign(ref, { key: review.to_key, title: manualTitles[review.to_key] ?? ref.title, line: review.to_line, match: "제도명 일치" }, sectionAt(review.to_key, review.to_line));
    }
    const position = ref.key + "#" + ref.line;
    if (seen.has(position)) return false;
    seen.add(position);
    if (review && state !== "OK") ref.review = { decision: "RECHECK", checkedAt: MANUAL_LINK_REVIEWS.checked_at, source: "review" };
    else if (review) ref.review = { decision: review.decision, checkedAt: MANUAL_LINK_REVIEWS.checked_at, source: "review" };
    else if (REGION_LIST_MANUALS.has(ref.key) && listRowRegion(manualLines.get(ref.key)?.[ref.line - 1])) ref.review = { decision: "LIST_ENTRY", checkedAt: MANUAL_LINK_REVIEWS.checked_at, source: "rule" };
    else delete ref.review;
    if (ref.review) reviewCounts[ref.review.source + ":" + ref.review.decision] = (reviewCounts[ref.review.source + ":" + ref.review.decision] ?? 0) + 1;
    return true;
  });
}
for (const file of fs.readdirSync(ITEMS).filter((name) => name.endsWith(".json")).sort()) {
  const target = path.join(ITEMS, file);
  const before = fs.readFileSync(target, "utf8");
  const payload = JSON.parse(before);
  if (payload.kind !== "curated" && payload.kind !== "auto") continue;
  const name = payload.kind === "curated" ? payload.meta.name : payload.raw.name;
  const itemId = file.replace(/\.json$/, "");
  const inScope = (ref, sido, sigungu, id) => manualLinkAllowed(ref.key, sido, id, ref.line, manualLines.get(ref.key)?.[ref.line - 1]) && !listRowMismatch(ref.key, manualLines.get(ref.key)?.[ref.line - 1], sido, sigungu);
  if (payload.kind === "auto") {
    const kept = payload.raw.talkRefs.filter((ref) => inScope(ref, payload.raw.sido, payload.raw.sigungu, payload.raw.id));
    for (const ref of payload.raw.talkRefs.filter((item) => !kept.includes(item))) removed.push({ item: file.replace(/\.json$/, ""), name, sido: payload.raw.sido, sigungu: payload.raw.sigungu, key: ref.key, title: ref.title, match: ref.match, excerpt: ref.excerpt });
    payload.raw.talkRefs = applyReviews(kept, itemId);
    sourceCounts.set(payload.raw.id, talkSourceKeys(payload.raw));
  }
  const names = payload.kind === "curated" ? [payload.meta.name, payload.extra.bokjiro?.name] : [payload.raw.name, payload.raw.edit?.previousName];
  if (payload.kind === "curated") {
    const kept = applyReviews(payload.extra.talkRefs.filter((ref) => !ref.curatedSource && inScope(ref, "", "", itemId)), itemId);
    for (const ref of payload.extra.talkRefs.filter((item) => !item.curatedSource && !kept.includes(item))) removed.push({ item: file.replace(/\.json$/, ""), name, sido: "", sigungu: "", key: ref.key, title: ref.title, match: ref.match, excerpt: ref.excerpt });
    const present = new Set(kept.map((ref) => ref.key));
    const added = [];
    for (const key of payload.record.src.filter((key) => !present.has(key))) {
      const override = sourceOverrides.overrides.find((row) => row.item === itemId && row.source_key === key);
      const sourceKey = override?.key ?? key;
      const found = override ? resolveManualSourceOverride(override, { manualLines, pages, locate, fallback: () => locateProgram(key, names) }) : locateProgram(key, names);
      const result = { ...found, original: withOcrCheck(found.original) };
      const outcome = "SOURCE_" + (result.original ? result.status : "NOT_FOUND");
      counts[outcome] = (counts[outcome] ?? 0) + 1;
      report.push({ item: file.replace(/\.json$/, ""), name, key: sourceKey, sourceKey: key, sectionLine: override?.section_line ?? null, title: manualTitles[sourceKey], line: 0, match: "제도명 일치", curatedSource: true, outcome, file: result.original?.file ?? null, page: result.original?.page ?? null, pageEnd: result.original?.pageEnd ?? null, basis: result.original?.basis ?? null, ocr: result.original?.ocr ?? null, expectedPage: null, quote: result.original?.quote ?? null, previousExcerpt: null, heading: null });
      if (!result.original) continue;
      const heading = result.original.quote?.split("\n")[0];
      added.push({ key: sourceKey, title: manualTitles[sourceKey] ?? "복지톡 DB", line: 0, ...(heading ? { heading } : {}), match: "제도명 일치", count: 1, excerpt: result.original.quote ?? result.original.file, curatedSource: true, ...(override ? { sourceKey: key, sectionLine: override.section_line ?? null, review: { decision: override.decision, checkedAt: sourceOverrides.checked_at, source: "review" } } : {}), original: result.original });
    }
    payload.extra.talkRefs = [...added, ...kept];
    // 목록의 매뉴얼 수(k)는 lib/welfare100/bokjiro.ts talkSourceCount와 같이 연결 매뉴얼과 정리 근거 매뉴얼(record.src)을 함께 센다.
    sourceCounts.set(itemId, new Set([...payload.extra.talkRefs.map((ref) => ref.key), ...payload.record.src]).size);
  }
  const refs = payload.kind === "curated" ? payload.extra.talkRefs : payload.raw.talkRefs;
  for (const ref of refs.filter((item) => !item.curatedSource)) {
    const located = locate(ref.key, ref.line, names);
    const result = { ...located, original: withOcrCheck(located.original) };
    const outcome = (ref.curatedSource ? "SOURCE_" : "") + (result.original ? result.status + (result.original.quote ? "" : "_NO_QUOTE") + (result.original.ocr ? (result.original.ocrCheckedAt ? "_OCR_CHECKED" : "_OCR") : "") : result.status);
    counts[outcome] = (counts[outcome] ?? 0) + 1;
    if (result.original) ref.original = result.original;
    else delete ref.original;
    report.push({ item: file.replace(/\.json$/, ""), name, key: ref.key, title: ref.title, line: ref.line, match: ref.match, curatedSource: Boolean(ref.curatedSource), outcome, file: result.original?.file ?? null, page: result.original?.page ?? null, pageEnd: result.original?.pageEnd ?? null, basis: result.original?.basis ?? null, ocr: result.original?.ocr ?? null, ocrCheckedAt: result.original?.ocrCheckedAt ?? null, expectedPage: result.expectedPage ?? null, quote: result.original?.quote ?? null, previousExcerpt: ref.excerpt, heading: ref.heading ?? null });
  }
  const after = JSON.stringify(replacePrivateSymbolsDeep(payload));
  if (after !== before) {
    changedFiles += 1;
    pendingWrites.push([target, after]);
  }
}
const blocked = staleReviews.length > 0 && !allowStale;
if (!check && !blocked) for (const [target, after] of pendingWrites) {
  const latest = JSON.parse(fs.readFileSync(target, "utf8"));
  const reviewed = JSON.parse(after);
  if (latest.kind === "curated") latest.extra.talkRefs = reviewed.extra.talkRefs;
  else latest.raw.talkRefs = reviewed.raw.talkRefs;
  fs.writeFileSync(target, JSON.stringify(latest));
}
const refs = report;
const located = refs.filter((row) => row.page !== null).length;
const indexPath = path.join(ITEMS, "..", "index.json");
const index = JSON.parse(fs.readFileSync(indexPath, "utf8"));
const indexRowsChanged = index.items.filter((row) => sourceCounts.has(row.s) && row.k !== sourceCounts.get(row.s));
for (const row of indexRowsChanged) row.k = sourceCounts.get(row.s);
if (indexRowsChanged.length && !check && !blocked) {
  fs.writeFileSync(indexPath, JSON.stringify(index));
  const defaultOut = path.dirname(indexPath) === path.join(SITE, "public/data/welfare100");
  writeSplitIndex(path.dirname(indexPath), index, defaultOut ? path.join(SITE, "data/welfare100/usage-registry.json") : path.join(path.dirname(indexPath), "usage-registry.json"));
}
console.log(JSON.stringify({ mode: check ? "check" : "write", written: !check && !blocked, refs: refs.length, located, unlocated: refs.length - located, changedFiles, indexRowsChanged: indexRowsChanged.length, removedOutOfScope: removed.length, counts, reviews: reviewCounts, staleReviews: staleReviews.length, originalsMatched: [...documentsByManual.values()].reduce((sum, set) => sum + set.size, 0) }, null, 1));
if (reportPath) fs.writeFileSync(reportPath, JSON.stringify(report, null, 1));
if (reportPath && removed.length) fs.writeFileSync(reportPath.replace(/\.json$/, "") + "-removed.json", JSON.stringify(removed, null, 1));
if (staleReviews.length) {
  if (reportPath) fs.writeFileSync(reportPath.replace(/\.json$/, "") + "-stale-reviews.json", JSON.stringify(staleReviews, null, 1));
  console.error("원문이 검수 때와 달라졌거나 지문이 없는 판정 " + staleReviews.length + "건: " + staleReviews.slice(0, 5).map((row) => row.item + " " + row.key + ":" + row.line + " " + row.state).join(", ") + (blocked ? " — 파일을 고치지 않았습니다. 재검수 후 다시 실행하거나 --allow-stale로 재검수 표시만 남기세요." : ""));
  process.exitCode = 2;
}

