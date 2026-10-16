// 원문 행 매핑 미해결(중분류·사업구분을 기준 분류표에 맞추지 못한 행) 전수 원인 분류(작업지시서 2026-10-14 §1-3).
// 정정 전 규칙(번호 접두어 미처리)과 현재 규칙을 함께 돌려 원인·처리 결과를 기록하고, 원장 검산(추출 = 저장 + 제외)을 다시 계산한다.
// 실행: node scripts/data-quality/review-unresolved-rows.mjs [--migration drizzle/0128_subcategory_numbering_fix.sql]
import { readFileSync, writeFileSync } from "node:fs";
import { readMohwSeed } from "../../lib/mohw-seed.ts";
import { readRepositoryBaseline } from "../../lib/repository-baseline.ts";
import { repairKnownExtractionFragments, removeExtractedContinuationFragments, correctFromRepositoryBaseline, alignToRepositoryTaxonomy } from "../../lib/official-correction.ts";
import { repairExtractionSpacing } from "../../lib/official-spacing.ts";
import { restoreVerifiedSourceDistinctions } from "../../lib/official-source-restoration.ts";
import { buildSourceRowLedger, isUnresolved, ledgerTotals } from "../../lib/official-ledger.ts";

const args = process.argv.slice(2);
const seed = readMohwSeed();
const baseline = readRepositoryBaseline();
const raw = seed.documents.flatMap((entry) => entry.services);
const order = new Map(raw.map((service, index) => [service.serviceId, index]));
const rawById = new Map(raw.map((service) => [service.serviceId, service]));
const documentOf = new Map(seed.documents.flatMap((entry) => entry.services.map((service) => [service.serviceId, entry.document])));
const taxonomy = new Set(baseline.map((service) => service.subcategory));
const repaired = repairKnownExtractionFragments(raw);
const kept = removeExtractedContinuationFragments(repaired);
const keptSet = new Set(kept);
const finalRows = alignToRepositoryTaxonomy(correctFromRepositoryBaseline(repairExtractionSpacing(kept), baseline), baseline).map(restoreVerifiedSourceDistinctions);
const finalById = new Map(finalRows.map((service) => [service.serviceId, service]));
const unnumbered = (value) => value.replace(/^\s*\d{1,2}[.)]?\s*/, "");
const changeLog = JSON.parse(readFileSync("docs/data-quality/pipeline-change-diff-20261014.json", "utf8"));
const newlyResolved = new Set(changeLog.filter((change) => change.field === "subcategory" && change.before === "").map((change) => change.service_id));
const previouslyUnresolved = finalRows.filter((service) => isUnresolved(service) || newlyResolved.has(service.serviceId));

function cause(service) {
  const source = rawById.get(service.serviceId);
  const value = (source?.subcategory ?? "").trim();
  if (!value) {
    const index = order.get(service.serviceId) ?? -1;
    const previous = raw[index - 1];
    const sameSection = previous && previous.serviceId.split(":").slice(0, 4).join(":") === service.serviceId.split(":").slice(0, 4).join(":");
    return sameSection && previous.subcategory.trim()
      ? { code: "MERGED_CELL_CANDIDATE", note: "같은 표의 바로 위 행에는 중분류가 있어 병합 셀이 전파되지 않았을 가능성. 원문 확인 전 채우지 않음" }
      : { code: "SOURCE_CELL_EMPTY", note: "원문 추출값에 중분류가 없음. 원문 확인 전 채우지 않음" };
  }
  if (value !== unnumbered(value) && taxonomy.has(unnumbered(value))) return { code: "NUMBERING_PREFIX", note: "중분류 앞에 목록 번호가 붙어 매핑되지 않던 값. 번호를 떼면 기준 분류표와 정확히 일치" };
  if ([...taxonomy].filter((entry) => entry.length >= 2 && value.includes(entry)).length >= 2) return { code: "COMBINED_CELL", note: "여러 중분류가 한 칸에 이어져 추출됨. 어느 하나로 정하지 않음" };
  return { code: "NOT_IN_TAXONOMY", note: "원문 값이 기준 분류표에 없음(신규 중분류 후보). 승인 전 매핑하지 않음" };
}

const rows = previouslyUnresolved.map((service) => {
  const reason = cause(service);
  const current = finalById.get(service.serviceId);
  const document = documentOf.get(service.serviceId);
  return {
    service_id: service.serviceId, sido: service.sido, sigungu: service.sigungu, name: service.name, category: service.category,
    source_subcategory: rawById.get(service.serviceId)?.subcategory ?? "", resolved_subcategory: current?.subcategory ?? "",
    status: current && !isUnresolved(current) ? "RESOLVED" : "UNRESOLVED_KEPT", cause: reason.code, note: reason.note,
    document_title: document?.title ?? "", document_url: document?.detailUrl ?? "",
  };
});
const ledger = ledgerTotals(buildSourceRowLedger({
  documents: seed.documents.map((entry) => ({ documentId: entry.document.documentId, extracted: entry.services.length, parsed: entry.services.length })),
  removedFragments: repaired.filter((service) => !keptSet.has(service)),
  finalServices: finalRows,
}));
const count = (pick) => rows.reduce((map, row) => { const key = pick(row); map[key] = (map[key] ?? 0) + 1; return map; }, {});
const summary = { generated_at: new Date().toISOString(), reviewed: rows.length, by_cause: count((row) => row.cause), by_status: count((row) => row.status), ledger_after: ledger };
writeFileSync("docs/data-quality/unresolved-rows-review-20261014.json", JSON.stringify({ summary, rows }, null, 1) + "\n");
const csv = ["service_id,sido,sigungu,name,category,source_subcategory,resolved_subcategory,status,cause,note,document_title,document_url"]
  .concat(rows.map((row) => [row.service_id, row.sido, row.sigungu, row.name, row.category, row.source_subcategory, row.resolved_subcategory, row.status, row.cause, row.note, row.document_title, row.document_url]
    .map((value) => '"' + String(value).replace(/"/g, '""').replace(/^([=+\-@])/, "'$1") + '"').join(",")));
writeFileSync("docs/data-quality/unresolved-rows-review-20261014.csv", "\uFEFF" + csv.join("\r\n") + "\r\n");
if (args.includes("--migration")) {
  const path = args[args.indexOf("--migration") + 1];
  const quote = (value) => "'" + value.replace(/'/g, "''") + "'";
  const fixes = rows.filter((row) => row.status === "RESOLVED" && row.cause === "NUMBERING_PREFIX");
  const sql = ["-- 2026-10-14 중분류 목록 번호 접두어 정정(docs/data-quality/unresolved-rows-review-20261014.json) " + fixes.length + "건. 되돌리기: 같은 service_id의 subcategory를 ''로 되돌린다."]
    .concat(fixes.map((row) => "UPDATE official_service_snapshot SET subcategory = " + quote(row.resolved_subcategory) + " WHERE subcategory = '' AND service_id = " + quote(row.service_id) + ";").join("\n--> statement-breakpoint\n"))
    .join("\n");
  writeFileSync(path, sql + "\n");
}
console.log(JSON.stringify(summary, null, 1));

