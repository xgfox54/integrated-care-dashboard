// 원본 PDF 화면에서 사업구분 칸을 한 행씩 확인한 행만 보완한다. 표기 대응은 이전 검수에서 승인한 규칙(국가→전국, 지자체→지역특화,
// 전라남도→광역, 연계서비스→공통_연계)을 따르고, 오탈자·쪽 넘김으로 잘린 표기는 같은 문서의 다른 행 표기로 뜻을 확인했다.
// 원본 표에 해당 칸이 아예 없는 문서는 채우지 않고 보류 사유만 바꾼다.
// 실행: node scripts/data-quality/build-verified-classification-restorations.mjs <운영 데이터 스냅샷.json>
import { readFileSync, writeFileSync } from "node:fs";

const REVISION = "source-classifications-20261015-v6";
const PREVIOUS = "source-classifications-20261015-v5";
const VERIFIED = [
  ...["0091:1489707:1:1:1", "0091:1489707:1:3:2", "0091:1489707:1:3:3", "0091:1489707:1:3:6", "0091:1489707:1:3:8", "0091:1489707:1:4:1", "0091:1489707:1:4:4", "0091:1489707:1:4:5", "0091:1489707:1:8:4", "0091:1489707:1:8:5", "0091:1489707:1:8:6"].map((id) => ({ id, value: "전국", label: "국가", method: "visual_cell_check_document_scheme" })),
  ...["0091:1489707:1:1:2", "0091:1489707:1:1:4"].map((id) => ({ id, value: "지역특화", label: "지자체", method: "visual_cell_check_document_scheme" })),
  { id: "0078:1489567:1:1:6", value: "전국", label: "저국", method: "visual_cell_check_typo" },
  { id: "0089:1489688:1:4:1", value: "광역", label: "전나 남도", method: "visual_cell_check_typo" },
  ...["0080:1489580:1:4:12", "0080:1489581:1:4:12"].map((id) => ({ id, value: "공통_연계", label: "연계서비", method: "visual_cell_check_page_break" })),
];
const COLUMN_ABSENT = new Map([["0091:1489708:1", "subcategory"], ["0088:1489666:1", "type"]]);
const AMBIGUOUS_LABELS = new Map([["0091:1489707:1:3:4", "국가 및 지자체"]]);
const [snapshotPath] = process.argv.slice(2);
if (!snapshotPath) throw new Error("Expected production dataset snapshot");
const snapshot = new Map(JSON.parse(readFileSync(snapshotPath, "utf8")).rows.map((row) => [row.serviceId, row]));
const pending = JSON.parse(readFileSync("data/classification-pending-review.json", "utf8"));
const registry = JSON.parse(readFileSync("data/source-classification-restorations.json", "utf8"));
const documentOf = (id) => id.split(":").slice(0, 3).join(":");
const pendingType = new Map(pending.rows.filter((row) => row.field === "type").map((row) => [row.service_id, row]));
const changes = VERIFIED.map(({ id, value, label, method }) => {
  const row = pendingType.get(id);
  if (!row) throw new Error("Not pending: " + id);
  const current = snapshot.get(id);
  if (!current || current.name !== row.name || current.updatedDate !== row.updated_date || current.type !== row.before) throw new Error("Production row changed: " + id);
  return { ...row, value, source_label: label, method };
});
for (const row of changes) {
  const entry = registry.rows[row.service_id] ??= { name: row.name, updated_date: row.updated_date, fields: {} };
  if (entry.name !== row.name || entry.updated_date !== row.updated_date || entry.fields.type) throw new Error("Registry conflict: " + row.service_id);
  entry.fields.type = { before: row.before, value: row.value };
}
writeFileSync("data/source-classification-restorations.json", JSON.stringify({ ...registry, revision: REVISION }, null, 1) + "\n");
const resolved = new Set(changes.map((row) => row.service_id));
const rows = pending.rows
  .filter((row) => !(row.field === "type" && resolved.has(row.service_id)))
  .map((row) => COLUMN_ABSENT.get(documentOf(row.service_id)) === row.field && row.reason === "CLASSIFICATION_COLUMN_NOT_CONFIRMED" ? { ...row, reason: "SOURCE_COLUMN_ABSENT" } : row)
  .map((row) => row.field === "type" && AMBIGUOUS_LABELS.has(row.service_id) ? { ...row, reason: "SOURCE_LABEL_REQUIRES_SCOPE_REVIEW", source_label: AMBIGUOUS_LABELS.get(row.service_id) } : row);
writeFileSync("data/classification-pending-review.json", JSON.stringify({ ...pending, rows }, null, 1) + "\n");
const q = (value) => "'" + String(value).replace(/'/g, "''") + "'";
const values = changes.map((row) => "(" + [REVISION, row.service_id, "type", row.name, row.updated_date, row.before, row.value, row.source_label, row.source_url, row.page, "", row.original_sha256, row.method].map(q).join(",") + ")");
const sql = readFileSync("data/source-classification-backfill.sql", "utf8");
if (!sql.includes(PREVIOUS)) throw new Error("Previous revision missing from backfill SQL");
const tail = sql.slice(sql.lastIndexOf("UPDATE official_service_snapshot SET type =")).replaceAll(PREVIOUS, REVISION);
writeFileSync("data/source-classification-backfill.sql", sql.trimEnd() + "\n--> statement-breakpoint\nINSERT OR IGNORE INTO official_classification_restoration(revision,service_id,field,expected_name,expected_updated_date,before_value,after_value,source_label,source_url,physical_page,glyph_sha256,original_pdf_sha256,verification_method) VALUES " + values.join(",") + ";\n--> statement-breakpoint\n" + tail.trimEnd() + "\n");
const summary = { revision: REVISION, restored: changes.length, by_value: Object.fromEntries([...new Set(changes.map((row) => row.value))].map((value) => [value, changes.filter((row) => row.value === value).length])),
  pending_after: rows.length, source_column_absent: rows.filter((row) => row.reason === "SOURCE_COLUMN_ABSENT").length,
  rule: "거제시 메뉴판(사업구분: 국가/지자체)의 13행, 강화군 '저국', 전남 '전나 남도', 대전 '연계서비'(쪽 넘김) 4행을 원본 PDF 화면에서 확인했다. 치매검사비지원의 '국가 및 지자체'는 한 분류로 대응할 수 없어 보류한다. 양산시 표에는 중분류 칸이, 군산시 표에는 사업구분 칸이 없어 채우지 않는다." };
writeFileSync("docs/data-quality/classification-restorations-20261015-v6.json", JSON.stringify({ summary, rows: changes.map(({ service_id, name, updated_date, before, value, source_label, source_url, page, original_sha256, method }) => ({ service_id, name, updated_date, before, value, source_label, source_url, page, original_sha256, method })) }, null, 1) + "\n");
console.log(JSON.stringify(summary));

