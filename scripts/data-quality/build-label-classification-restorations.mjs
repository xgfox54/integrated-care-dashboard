// 사업구분 칸에 표준 분류의 줄임 표기가 적힌 행을 보완한다. 같은 원본 문서의 다른 행이 쓰는 분류 체계로 뜻을 확인한 표기만 다룬다.
// 실행: node scripts/data-quality/build-label-classification-restorations.mjs <운영 데이터 스냅샷.json>
import { readFileSync, writeFileSync } from "node:fs";

const REVISION = "source-classifications-20261015-v5";
const LABELS = new Map([["특화", "지역특화"], ["특화사업", "지역특화"], ["공통_연", "공통_연계"]]);
const [snapshotPath] = process.argv.slice(2);
if (!snapshotPath) throw new Error("Expected production dataset snapshot");
const snapshot = new Map(JSON.parse(readFileSync(snapshotPath, "utf8")).rows.map((row) => [row.serviceId, row]));
const pending = JSON.parse(readFileSync("data/classification-pending-review.json", "utf8"));
const registry = JSON.parse(readFileSync("data/source-classification-restorations.json", "utf8"));
const documentOf = (id) => id.split(":").slice(0, 3).join(":");
const documentTypes = new Map();
for (const row of snapshot.values()) {
  const types = documentTypes.get(documentOf(row.serviceId)) ?? new Set();
  types.add(row.type);
  documentTypes.set(documentOf(row.serviceId), types);
}
const changes = [];
for (const row of pending.rows) {
  if (row.field !== "type" || row.reason !== "SOURCE_LABEL_REQUIRES_SCOPE_REVIEW") continue;
  const value = LABELS.get(String(row.source_label ?? "").replace(/\s+/g, ""));
  if (!value) continue;
  const current = snapshot.get(row.service_id);
  if (!current || current.name !== row.name || current.updatedDate !== row.updated_date || current.type !== row.before) throw new Error("Production row changed: " + row.service_id);
  if (value === "공통_연계" && !documentTypes.get(documentOf(row.service_id))?.has("공통_연계")) throw new Error("Document does not use 공통_연계: " + row.service_id);
  changes.push({ ...row, value });
}
for (const row of changes) {
  const entry = registry.rows[row.service_id] ??= { name: row.name, updated_date: row.updated_date, fields: {} };
  if (entry.name !== row.name || entry.updated_date !== row.updated_date || entry.fields.type) throw new Error("Registry conflict: " + row.service_id);
  entry.fields.type = { before: row.before, value: row.value };
}
writeFileSync("data/source-classification-restorations.json", JSON.stringify({ ...registry, revision: REVISION }, null, 1) + "\n");
const resolved = new Set(changes.map((row) => row.service_id + "#" + row.field));
writeFileSync("data/classification-pending-review.json", JSON.stringify({ ...pending, rows: pending.rows.filter((row) => !resolved.has(row.service_id + "#" + row.field)) }, null, 1) + "\n");
const q = (value) => "'" + String(value).replace(/'/g, "''") + "'";
const values = changes.map((row) => "(" + [REVISION, row.service_id, "type", row.name, row.updated_date, row.before, row.value, row.source_label, row.source_url, row.page, "", row.original_sha256, "abbreviated_label_document_scheme"].map(q).join(",") + ")");
const sql = readFileSync("data/source-classification-backfill.sql", "utf8");
const previous = sql.slice(sql.lastIndexOf("UPDATE official_service_snapshot SET type ="));
const tail = previous.replaceAll("source-classifications-20261015-v4", REVISION);
writeFileSync("data/source-classification-backfill.sql", sql.trimEnd() + "\n--> statement-breakpoint\nINSERT OR IGNORE INTO official_classification_restoration(revision,service_id,field,expected_name,expected_updated_date,before_value,after_value,source_label,source_url,physical_page,glyph_sha256,original_pdf_sha256,verification_method) VALUES " + values.join(",") + ";\n--> statement-breakpoint\n" + tail.trimEnd() + "\n");
const summary = { revision: REVISION, restored: changes.length, by_label: Object.fromEntries([...LABELS.keys()].map((label) => [label, changes.filter((row) => String(row.source_label).replace(/\s+/g, "") === label).length])), pending_after: pending.rows.length - changes.length,
  rule: "원본 사업구분 칸의 '특화'·'특화사업'은 같은 문서가 '전국'과 함께 쓰는 지역 자체사업 표기로 '지역특화'에 대응한다. '공통_연'은 같은 문서의 다른 행이 쓰는 '공통_연계'가 칸에서 잘린 표기다. 뜻이 불명확한 표기(기관자체·보건소 자체·기타·부서명 등)는 보류한다." };
writeFileSync("docs/data-quality/classification-restorations-20261015-v5.json", JSON.stringify({ summary, rows: changes.map(({ service_id, name, updated_date, before, value, source_label, source_url, page, original_sha256 }) => ({ service_id, name, updated_date, before, value, source_label, source_url, page, original_sha256 })) }, null, 1) + "\n");
console.log(JSON.stringify(summary));
