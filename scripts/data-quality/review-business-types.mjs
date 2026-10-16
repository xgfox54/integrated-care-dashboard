// 사업구분 미분류 전수 검토(작업지시서 2026-10-14 §1-2). 보건복지부 미리보기 원문 쪽에서 '구분' 칸의 글자를
// 행 단위로 직접 읽어 원문 표기를 기록하고, 승인된 규칙으로만 공식 사업구분에 대응시킨다.
// 실행: node scripts/data-quality/review-business-types.mts [--limit N] [--out docs/data-quality/business-type-review-20261014.json]
import { writeFileSync, existsSync, readFileSync } from "node:fs";
import { readMohwSeed } from "../../lib/mohw-seed.ts";
import { readRepositoryBaseline } from "../../lib/repository-baseline.ts";
import { fetchOfficialHtml } from "../../lib/official-http.ts";
import { parseSynapPreviewLocation } from "../../lib/mohw-table.ts";
import { parseMohwGlyphs } from "../../lib/mohw-glyphs.ts";
import { classifySourceTypeLabel } from "../../lib/business-type.ts";
import { repairKnownExtractionFragments, removeExtractedContinuationFragments, correctFromRepositoryBaseline, alignToRepositoryTaxonomy } from "../../lib/official-correction.ts";
import { repairExtractionSpacing } from "../../lib/official-spacing.ts";
import { restoreVerifiedSourceDistinctions } from "../../lib/official-source-restoration.ts";

const args = process.argv.slice(2);
const limit = Number(args[args.indexOf("--limit") + 1]) || Infinity;
const onlyDocument = args.includes("--doc") ? args[args.indexOf("--doc") + 1] : "";
const out = args.includes("--out") ? args[args.indexOf("--out") + 1] : "docs/data-quality/business-type-review-20261014.json";
const cachePath = out.replace(/\.json$/, ".pages-cache.json");
const pageCache = existsSync(cachePath) ? JSON.parse(readFileSync(cachePath, "utf8")) : {};

const seed = readMohwSeed();
const baseline = readRepositoryBaseline();
const raw = seed.documents.flatMap((entry) => entry.services);
const documentOf = new Map(seed.documents.flatMap((entry) => entry.services.map((service) => [service.serviceId, entry.document])));
const rawById = new Map(raw.map((service) => [service.serviceId, service]));
const identity = (service) => [service.sido, service.sigungu, service.name].map((value) => value.toLowerCase().replace(/[^0-9가-힣a-z]/g, "")).join("|");
const baselineByIdentity = new Map();
for (const service of baseline) { const key = identity(service); baselineByIdentity.set(key, baselineByIdentity.has(key) ? null : service); }
const kept = removeExtractedContinuationFragments(repairKnownExtractionFragments(raw));
const production = alignToRepositoryTaxonomy(correctFromRepositoryBaseline(repairExtractionSpacing(kept), baseline), baseline).map(restoreVerifiedSourceDistinctions);
const targets = production.filter((service) => service.type === "미분류" && (!onlyDocument || service.serviceId.startsWith(onlyDocument + ":"))).slice(0, limit);

async function pageGlyphs(documentId, page) {
  const key = documentId + ":" + page;
  if (!pageCache[key]) {
    const [bid, listNo, seq] = documentId.split(":");
    const preview = await fetchOfficialHtml("https://www.mohw.go.kr/attachPreview.es?" + new URLSearchParams({ bid, list_no: listNo, seq }));
    const xml = (await fetchOfficialHtml(parseSynapPreviewLocation(preview.finalUrl).pageUrl(Number(page)))).text;
    pageCache[key] = parseMohwGlyphs(xml);
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  return pageCache[key];
}
function locateName(glyphs, name) {
  const head = [...name.replace(/[\s·ㆍ]/g, "")].slice(0, 5).join("");
  if (head.length < 2) return null;
  const sorted = [...glyphs].sort((a, b) => a.y - b.y || a.x - b.x);
  for (const start of sorted) {
    if (start.text[0] !== head[0]) continue;
    const line = sorted.filter((g) => Math.abs(g.y - start.y) <= 3 && g.x >= start.x).sort((a, b) => a.x - b.x);
    const textValue = line.map((g) => g.text).join("").replace(/\s+/g, "");
    if (textValue.startsWith(head)) return start;
  }
  return null;
}
function typeColumns(glyphs, firstRowY) {
  const header = glyphs.filter((g) => g.y < firstRowY);
  const columns = [];
  for (const g of header) if (g.text.endsWith("구")) {
    const beside = header.find((h) => Math.abs(h.y - g.y) <= 4 && h.x > g.x && h.x - g.x < 40 && h.text.startsWith("분"));
    if (beside) columns.push((g.x + beside.x + beside.width) / 2);
    const below = header.find((h) => Math.abs(h.x - g.x) <= 8 && h.y > g.y && h.y - g.y < 30 && h.text.startsWith("분"));
    if (below) columns.push(g.x + g.width / 2);
  }
  return columns;
}
const LABEL_TOKEN = /공통[·ㆍ_]?연계|연계서비스|지역특화(?:\(자체\))?|지자체|국가|전국|광역|도특화|경기도|\(?자체\)?|미분류/g;
function columnTokens(glyphs, center, fromY) {
  const column = glyphs.filter((g) => Math.abs(g.x + g.width / 2 - center) <= 24 && g.y > fromY)
    .sort((a, b) => a.y - b.y || a.x - b.x)
    .flatMap((g) => [...g.text.replace(/\s+/g, "")].map((character) => ({ character, y: g.y + g.height / 2 })));
  const joined = column.map((entry) => entry.character).join("");
  const tokens = [];
  for (const match of joined.matchAll(LABEL_TOKEN)) {
    const span = column.slice(match.index, match.index + match[0].length);
    tokens.push({ text: match[0], y: span.reduce((sum, entry) => sum + entry.y, 0) / span.length });
  }
  return tokens;
}
function labelForRow(tokens, top, bottom, nameY) {
  const inside = tokens.filter((token) => token.y >= top && token.y < bottom);
  if (inside.length === 0) return "";
  return inside.sort((a, b) => Math.abs(a.y - nameY) - Math.abs(b.y - nameY))[0].text;
}
const documentColumns = new Map();
async function documentColumn(documentId) {
  if (documentColumns.has(documentId)) return documentColumns.get(documentId);
  let found = null;
  try {
    const glyphs = (await pageGlyphs(documentId, 1)).glyphs;
    const firstServices = raw.filter((service) => service.serviceId.startsWith(documentId + ":1:"));
    const located = firstServices.map((service) => locateName(glyphs, service.name)).filter(Boolean).sort((a, b) => a.y - b.y);
    if (located.length) found = bestColumn(glyphs, typeColumns(glyphs, located[0].y - 4), located[0].y);
  } catch { found = null; }
  documentColumns.set(documentId, found);
  return found;
}
function bestColumn(glyphs, candidates, firstRowY) {
  const scored = candidates.map((center) => ({ center, score: columnTokens(glyphs, center, firstRowY - 10).length })).sort((a, b) => b.score - a.score);
  return scored[0]?.score > 0 ? scored[0].center : null;
}

const groups = new Map();
for (const service of targets) {
  const [bid, listNo, seq, page] = service.serviceId.split(":");
  const key = [bid, listNo, seq].join(":") + "|" + page;
  if (!groups.has(key)) groups.set(key, []);
  groups.get(key).push(service);
}
const rows = [];
let done = 0;
for (const [key, services] of groups) {
  const [documentId, page] = key.split("|");
  const document = documentOf.get(services[0].serviceId);
  let glyphs = null; let error = "";
  try { glyphs = (await pageGlyphs(documentId, page)).glyphs; } catch (failure) { error = String(failure?.message ?? failure).slice(0, 160); }
  const pageServices = raw.filter((service) => service.serviceId.startsWith(documentId + ":" + page + ":"));
  const located = glyphs ? pageServices.map((service) => ({ service, at: locateName(glyphs, service.name) })).filter((entry) => entry.at).sort((a, b) => a.at.y - b.at.y) : [];
  let column = glyphs && located.length ? bestColumn(glyphs, typeColumns(glyphs, located[0].at.y - 4), located[0].at.y) : null;
  if (column === null && glyphs && located.length) {
    const inherited = await documentColumn(documentId);
    if (inherited !== null && columnTokens(glyphs, inherited, located[0].at.y - 10).length > 0) column = inherited;
  }
  const tokens = column === null ? [] : columnTokens(glyphs, column, located[0].at.y - 10);
  if (process.env.REVIEW_DEBUG) console.log(key, "located", located.length, "/", pageServices.length, "column", column, "tokens", tokens.length);
  for (const service of services) {
    const source = rawById.get(service.serviceId);
    const base = baselineByIdentity.get(identity(source ?? service));
    let literal = ""; let located_ = false;
    const index = located.findIndex((entry) => entry.service.serviceId === service.serviceId);
    if (index >= 0 && column !== null) {
      located_ = true;
      const y = located[index].at.y;
      const top = index > 0 ? (located[index - 1].at.y + y) / 2 : y - 30;
      const bottom = index < located.length - 1 ? (located[index + 1].at.y + y) / 2 : y + 40;
      literal = labelForRow(tokens, top, bottom, y);
    }
    const mapping = classifySourceTypeLabel(literal);
    const parserValue = source?.type ?? "";
    let status;
    if (error) status = "SOURCE_FETCH_FAILED";
    else if (!located_ && column === null) status = "TYPE_COLUMN_NOT_FOUND";
    else if (!located_) status = "ROW_NOT_LOCATED";
    else if (!literal) status = "SOURCE_CELL_EMPTY_OR_MERGED";
    else if (mapping.rule === "approved" && mapping.value === "미분류") status = "SOURCE_UNCLASSIFIED";
    else if (mapping.rule === "approved") status = mapping.value === (parserValue === "경기도" ? "광역" : parserValue) ? "VERIFIED_RESTORE" : "CONFLICT_REVIEW_NEEDED";
    else if (mapping.rule === "proposed") status = "MAPPING_RULE_PENDING_APPROVAL";
    else status = "SOURCE_LABEL_UNRECOGNIZED";
    rows.push({
      service_id: service.serviceId, document_id: documentId, page: Number(page), document_title: document?.title ?? "",
      document_url: document?.detailUrl ?? "", data_as_of: document?.dataAsOf ?? "",
      sido: service.sido, sigungu: service.sigungu, name: service.name, category: service.category,
      current_type: service.type, parser_recorded_type: parserValue, baseline_type: base ? base.type : null,
      source_label: literal, mapped_type: mapping.value, mapping_rule: mapping.rule, mapping_basis: mapping.basis,
      status, proposed_type: status === "VERIFIED_RESTORE" ? mapping.value : "미분류",
      error: error || undefined,
    });
  }
  done += services.length;
  if (done % 200 < services.length) { process.stdout.write("." + done); writeFileSync(cachePath, JSON.stringify(pageCache)); }
}
writeFileSync(cachePath, JSON.stringify(pageCache));
const count = (list, pick) => list.reduce((map, row) => { const key = pick(row); map[key] = (map[key] ?? 0) + 1; return map; }, {});
const summary = {
  generated_at: new Date().toISOString(), scope: "현재 운영 산출 규칙으로 사업구분이 '미분류'인 사업 전체", total: rows.length,
  by_status: count(rows, (row) => row.status), restore_by_type: count(rows.filter((row) => row.status === "VERIFIED_RESTORE"), (row) => row.proposed_type),
  pending_labels: count(rows.filter((row) => row.status === "MAPPING_RULE_PENDING_APPROVAL"), (row) => row.source_label),
  unrecognized_labels: count(rows.filter((row) => row.status === "SOURCE_LABEL_UNRECOGNIZED"), (row) => row.source_label),
};
writeFileSync(out, JSON.stringify({ summary, rows }, null, 1));
if (args.includes("--write-restorations")) {
  const restored = Object.fromEntries(rows.filter((row) => row.status === "VERIFIED_RESTORE").map((row) => [row.service_id, { type: row.proposed_type, label: row.source_label, page: row.page }]));
  writeFileSync("data/business-type-restorations.json", JSON.stringify({
    revision: "btr-" + summary.generated_at.slice(0, 10) + "-" + Object.keys(restored).length,
    note: "보건복지부 미리보기 원문 '구분' 칸의 표기를 승인 규칙으로 대응시켰고, 2026-09-20 시드 파서 기록값과도 일치한 행만 넣었습니다. 생성: scripts/data-quality/review-business-types.mjs --write-restorations",
    rows: restored,
  }, null, 1) + "\n");
  const csv = [["service_id", "sido", "sigungu", "name", "category", "current_type", "parser_recorded_type", "baseline_type", "source_label", "mapping_rule", "status", "proposed_type", "document_title", "page", "document_url"].join(",")]
    .concat(rows.map((row) => [row.service_id, row.sido, row.sigungu, row.name, row.category, row.current_type, row.parser_recorded_type, row.baseline_type ?? "", row.source_label, row.mapping_rule, row.status, row.proposed_type, row.document_title, row.page, row.document_url]
      .map((value) => '"' + String(value).replace(/"/g, '""').replace(/^([=+\-@])/, "'$1") + '"').join(",")));
  writeFileSync(out.replace(/\.json$/, ".csv"), "\uFEFF" + csv.join("\r\n") + "\r\n");
}
console.log("\n" + JSON.stringify(summary, null, 1));

