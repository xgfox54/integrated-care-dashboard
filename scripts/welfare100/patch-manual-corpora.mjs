// 복지톡 매뉴얼 교체를 복지제도100 연결용 말뭉치(39종 병합본 줄, 원본 PDF 쪽)에 반영한다.
// 바뀐 병합본만 새 판으로 바꾸고, 그대로인 문서의 줄은 이동표로 옮긴다. 검수 판정은 같은 내용 지문의 줄로만 옮긴다.
// 실행: node scripts/welfare100/patch-manual-corpora.mjs --changes <changes.json> --suffix <복지톡 커밋 앞 12자리>
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import { COMBINED_REVISION, ORIGINALS_REVISION, combinedManualLines, readCorpus } from "./manual-pages.mjs";
import { lineFingerprint } from "./manual-link-scope.mjs";

const SECTION_LINES = 300;
const BATCH_SECTIONS = 200;
const MARKER = /^#{1,6}\s+원본\s+파일\s*:\s*(.+?)\s*$/;
const sha = (value) => createHash("sha256").update(value).digest("hex");
const nameKey = (name) => String(name).normalize("NFKC").replace(/^\d{2}[._]/, "").replace(/\.(md|pdf|hwpx)$/i, "").replace(/[+_★\s]/g, "").toLowerCase();

function componentRanges(lines) {
  const markers = [];
  lines.forEach((line, index) => { const match = MARKER.exec(line ?? ""); if (match) markers.push({ index, name: match[1] }); });
  return markers.map((marker, position) => {
    const next = markers[position + 1];
    let end = next ? next.index - 1 : lines.length;
    while (end > marker.index + 2 && (lines[end - 1] === "---" || lines[end - 1] === "")) end -= 1;
    return { name: marker.name, marker: marker.index, start: marker.index + 2, end };
  });
}

/** 병합본 한 개에 교체를 적용한다. shifts는 그대로 남은 줄 범위(1부터 세는 줄 번호)의 이동량이다. */
export function replaceInMerged(oldLines, change, newText) {
  const newContent = newText.replace(/\r\n/g, "\n").replace(/\n$/, "").split("\n");
  const components = componentRanges(oldLines);
  if (!components.length) return { lines: newContent, shifts: [], replaced: { oldStart: 1, oldEnd: oldLines.length, newStart: 1, newEnd: newContent.length }, single: true };
  const wanted = nameKey(change.old_marker ?? change.old_source_name);
  const matched = components.filter((component) => nameKey(component.name) === wanted || nameKey(component.name).endsWith(nameKey(change.old_source_name)));
  if (matched.length !== 1) throw new Error("병합본 " + change.key + "에서 교체할 원본 표지를 하나로 찾지 못했습니다: " + change.old_source_name + " (" + matched.length + "개)");
  const target = matched[0];
  const lines = [...oldLines.slice(0, target.marker), "## 원본 파일: " + change.key + "." + change.new_source_name, oldLines[target.marker + 1] ?? "", ...newContent, ...oldLines.slice(target.end)];
  const delta = newContent.length - (target.end - target.start);
  return {
    lines,
    shifts: [{ oldStart: 1, oldEnd: target.marker, delta: 0 }, { oldStart: target.end + 1, oldEnd: oldLines.length, delta }],
    replaced: { oldStart: target.start + 1, oldEnd: target.end, newStart: target.start + 1, newEnd: target.start + newContent.length },
    single: false,
  };
}

function chunkSections(document, lines) {
  const sections = [];
  for (let start = 0, ordinal = 0; start < lines.length; start += SECTION_LINES, ordinal += 1) {
    const content = lines.slice(start, start + SECTION_LINES).join("\n");
    sections.push({ section_id: document.document_id + "-w" + String(ordinal).padStart(5, "0"), document_id: document.document_id, ordinal, node_id: "", title: document.source_name, heading_path: document.source_name, service_names: "", original_name: document.source_name, upstream_original_name: document.source_name, original_name_basis: "welfare100_patch", original_name_line: null, start_line: start + 1, end_line: Math.min(lines.length, start + SECTION_LINES), content, content_hash: sha(content) });
  }
  return sections;
}

const cellText = (cell) => String(cell?.text ?? "").replace(/\n/g, "<br>");
/** Kordoc JSON 블록을 쪽별 Markdown으로 되돌린다. 표는 HTML 표, 제목은 ###로 쓴다. */
export function pagesFromKordoc(json, pageCount) {
  const pages = new Map();
  for (const block of json.blocks ?? []) {
    const page = block.pageNumber ?? block.bbox?.page;
    if (!page) continue;
    let text = "";
    if (block.type === "table" && block.table?.cells) text = "<table>\n" + block.table.cells.map((row) => "<tr>" + row.map((cell) => "<td>" + cellText(cell) + "</td>").join("") + "</tr>").join("\n") + "\n</table>";
    else if (block.text) text = (block.type === "heading" ? "### " : "") + String(block.text).trim();
    if (!text.trim()) continue;
    if (!pages.has(page)) pages.set(page, []);
    pages.get(page).push(text);
  }
  const count = pageCount ?? Math.max(0, ...pages.keys());
  return Array.from({ length: count }, (_, index) => ({ page: index + 1, text: (pages.get(index + 1) ?? []).join("\n\n") }));
}

function originalSections(document, original, pages) {
  const sections = [];
  let line = 1;
  const push = (title, headingPath, content) => {
    const count = content.split("\n").length;
    sections.push({ section_id: document.document_id + "-s" + String(sections.length).padStart(5, "0"), document_id: document.document_id, ordinal: sections.length, node_id: "", title, heading_path: headingPath, service_names: original.name, original_name: original.name, upstream_original_name: original.name, original_name_basis: "explicit_original_file_marker", original_name_line: 1, start_line: line, end_line: line + count - 1, content, content_hash: sha(content) });
    line += count;
  };
  push(original.name + " / 원본 파일 정보", original.name + " > 원본 파일 정보", "# 원본 파일: " + original.name + "\n\n원본 SHA-256: " + original.sha256 + "\n\n원본 형식: " + String(original.format).toUpperCase() + "\n\n쪽별 본문: kordoc " + (original.parser ?? "") + " JSON 블록\n");
  for (const page of pages) push(original.name + " / PDF 물리 쪽 " + page.page, original.name + " > PDF 물리 쪽 " + page.page, "## PDF 물리 쪽 " + page.page + "\n\n" + page.text + "\n");
  return sections;
}

function writeRevision(root, revision, documents, sections) {
  const dir = path.join(root, revision);
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  const batches = [{ documents, sections: [] }];
  for (let start = 0; start < sections.length; start += BATCH_SECTIONS) batches.push({ documents: [], sections: sections.slice(start, start + BATCH_SECTIONS) });
  batches.forEach((batch, index) => fs.writeFileSync(path.join(dir, "batch-" + String(index).padStart(4, "0") + ".json"), JSON.stringify({ schema_version: "manual-corpus-1", revision, batch_index: index, ...batch })));
  return batches.length;
}

function mapLine(line, result) {
  for (const shift of result.shifts) if (line >= shift.oldStart && line <= shift.oldEnd) return line + shift.delta;
  const { oldStart, oldEnd, newStart, newEnd } = result.replaced;
  const ratio = oldEnd > oldStart ? (line - oldStart) / (oldEnd - oldStart) : 0;
  return Math.round(newStart + ratio * (newEnd - newStart));
}

function relocate(line, fingerprint, result) {
  if (!line) return null;
  const estimate = mapLine(line, result);
  if (lineFingerprint(result.lines[estimate - 1]) === fingerprint) return estimate;
  let best = null;
  result.lines.forEach((text, index) => {
    if (lineFingerprint(text) !== fingerprint) return;
    if (best === null || Math.abs(index + 1 - estimate) < Math.abs(best - estimate)) best = index + 1;
  });
  return best;
}

export function patchManualCorpora({ site, changes, suffix, checkedAt = new Date().toISOString() }) {
  const root = path.join(site, "data/manual-corpus/assets/__manual_corpus");
  const combined = readCorpus(root, COMBINED_REVISION);
  const originals = readCorpus(root, ORIGINALS_REVISION);
  const merged = combinedManualLines(combined);
  const byKey = new Map();
  for (const change of changes) byKey.set(change.key, [...(byKey.get(change.key) ?? []), change]);
  const results = new Map();
  const titles = JSON.parse(fs.readFileSync(path.join(site, "data/welfare100/manuals.json"), "utf8"));
  for (const [key, list] of byKey) {
    if (!merged.has(key)) throw new Error("복지제도100 병합본에 " + key + "번이 없습니다.");
    if (list.length !== 1) throw new Error(key + "번 병합본에 교체가 " + list.length + "건입니다. 한 번에 하나씩 반영하세요.");
    const step = replaceInMerged(merged.get(key).map((line) => line ?? ""), list[0], fs.readFileSync(list[0].new_text_path, "utf8"));
    results.set(key, step);
    if (step.single) titles[key] = list[0].new_source_name.replace(/\.md$/, "").replace(/★/g, "").trim();
  }
  const combinedDocuments = [];
  const combinedSections = [];
  for (const document of combined.documents.values()) {
    const key = document.source_name.slice(0, 2);
    const result = results.get(key);
    const own = combined.sections.filter((section) => section.document_id === document.document_id);
    if (!result) { combinedDocuments.push(document); combinedSections.push(...own); continue; }
    const text = result.lines.join("\n");
    const sourceName = result.single ? key + "." + byKey.get(key)[0].new_source_name : document.source_name;
    const updated = { ...document, source_name: sourceName, source_path: "welfare100-patch/" + sourceName, sha256: sha(text), byte_size: Buffer.byteLength(text), section_count: 0 };
    const sections = chunkSections(updated, result.lines);
    updated.section_count = sections.length;
    combinedDocuments.push(updated);
    combinedSections.push(...sections);
  }
  const removedOriginals = new Set(changes.map((change) => change.old_original_sha256).filter(Boolean).map((value) => "orig-" + value.slice(0, 20)));
  for (const id of removedOriginals) if (!originals.documents.has(id)) throw new Error("원본 쪽 말뭉치에 교체 전 원본이 없습니다: " + id);
  const originalDocuments = [...originals.documents.values()].filter((document) => !removedOriginals.has(document.document_id));
  const originalSectionsAll = originals.sections.filter((section) => !removedOriginals.has(section.document_id));
  for (const change of changes) {
    const original = change.new_original;
    const pages = pagesFromKordoc(JSON.parse(fs.readFileSync(original.kordoc_json, "utf8")), original.page_count);
    const document = { document_id: "orig-" + original.sha256.slice(0, 20), source_name: original.name, source_path: "welfare100-patch/" + original.name, sha256: "", byte_size: 0, document_year: (original.name.match(/20\d{2}/) ?? [null])[0], category: (change.new_source_name.match(/\[([^\]]+)\]/) ?? [null, ""])[1], document_type: "원본 PDF 추출본", publisher: "미표기", edition: "", effective_from: "", effective_to: "", topic: "", authority: "primary", source_role: "operational_manual", jurisdiction: "미확인", section_count: 0 };
    const sections = originalSections(document, original, pages);
    const text = sections.map((section) => section.content).join("\n");
    Object.assign(document, { sha256: sha(text), byte_size: Buffer.byteLength(text), section_count: sections.length });
    originalDocuments.push(document);
    originalSectionsAll.push(...sections);
  }
  const combinedRevision = "sgw-w100c-" + suffix + "-v1";
  const originalRevision = "sgw-w100o-" + suffix + "-v1";
  writeRevision(root, combinedRevision, combinedDocuments, combinedSections);
  writeRevision(root, originalRevision, originalDocuments, originalSectionsAll);

  const reviewsPath = path.join(site, "data/welfare100/manual-link-reviews.json");
  const reviews = JSON.parse(fs.readFileSync(reviewsPath, "utf8"));
  const retired = [];
  const kept = [];
  let migrated = 0;
  for (const decision of reviews.decisions) {
    const result = results.get(decision.key);
    const targetResult = decision.to_key ? results.get(decision.to_key) : null;
    if (!result && !targetResult) { kept.push(decision); continue; }
    const next = { ...decision };
    if (result) next.line = relocate(decision.line, decision.line_sha256, result);
    if (decision.to_line && targetResult) next.to_line = relocate(decision.to_line, decision.to_line_sha256, targetResult);
    if (!next.line || (decision.to_line && !next.to_line)) { retired.push({ ...decision, retired_reason: "MANUAL_REPLACED_LINE_NOT_FOUND", retired_at: checkedAt, retired_from_revision: COMBINED_REVISION }); continue; }
    if (next.line !== decision.line || next.to_line !== decision.to_line) {
      next.migrated = { from_revision: COMBINED_REVISION, line: decision.line, ...(decision.to_line ? { to_line: decision.to_line } : {}), basis: "same_line_fingerprint" };
      migrated += 1;
    }
    kept.push(next);
  }
  fs.writeFileSync(reviewsPath, JSON.stringify({ ...reviews, decisions: kept, corpus_revision: combinedRevision, retired_decisions: [...(reviews.retired_decisions ?? []), ...retired] }, null, 1) + "\n");
  fs.writeFileSync(path.join(site, "data/welfare100/manuals.json"), JSON.stringify(titles, null, 1) + "\n");
  fs.writeFileSync(path.join(site, "data/welfare100/manual-corpus-revisions.json"), JSON.stringify({ combined: combinedRevision, original: originalRevision, previous: { combined: COMBINED_REVISION, original: ORIGINALS_REVISION }, updated_at: checkedAt }, null, 1) + "\n");
  return { combinedRevision, originalRevision, keys: [...results.keys()], migratedReviews: migrated, retiredReviews: retired.length, keptReviews: kept.length };
}

if (process.argv[1]?.endsWith("patch-manual-corpora.mjs")) {
  const argv = process.argv.slice(2);
  const arg = (name) => { const index = argv.indexOf("--" + name); return index >= 0 ? argv[index + 1] : undefined; };
  if (!arg("changes") || !arg("suffix")) throw new Error("--changes <json>와 --suffix <커밋 앞 12자리>가 필요합니다.");
  console.log(JSON.stringify(patchManualCorpora({ site: process.cwd(), changes: JSON.parse(fs.readFileSync(arg("changes"), "utf8")), suffix: arg("suffix") }), null, 1));
}
