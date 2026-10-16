import { readFileSync, writeFileSync } from "node:fs";
import { SEARCH_TEXT_FROM_COLUMNS } from "../../lib/official-search-text.ts";

const [reviewPath, beforePath, manifestPath] = process.argv.slice(2);
if (!reviewPath || !beforePath || !manifestPath) throw new Error("Expected approved cell review, production snapshot and original manifest");
const changes = JSON.parse(readFileSync(reviewPath, "utf8"));
const before = JSON.parse(readFileSync(beforePath, "utf8"));
const originals = JSON.parse(readFileSync(manifestPath, "utf8"));
const registry = JSON.parse(readFileSync("data/source-classification-restorations.json", "utf8"));
const revision = "source-classifications-20261015-v2";
for (const row of changes) {
  const entry = registry.rows[row.service_id] ??= { name: row.name, updated_date: row.updated_date, fields: {} };
  if (entry.name !== row.name || entry.updated_date !== row.updated_date) throw new Error("Source identity conflicts: " + row.service_id);
  const old = entry.fields[row.field];
  if (old && (old.before !== row.before || old.value !== row.value)) throw new Error("Review conflicts: " + row.service_id);
  entry.fields[row.field] = { before: row.before, value: row.value };
}
writeFileSync("data/source-classification-restorations.json", JSON.stringify({ ...registry, revision }, null, 1) + "\n");
const typeCount = changes.filter((row) => row.field === "type").length;
const subcategoryCount = changes.length - typeCount;
const summary = {
  revision, documents: originals.length, original_bytes: originals.reduce((n, row) => n + row.bytes, 0),
  row_count: before.rows.length, type_restored: typeCount, subcategory_restored: subcategoryCount,
  unclassified_type_before: before.rows.filter((row) => row.type === "미분류").length,
  unclassified_type_after: before.rows.filter((row) => row.type === "미분류").length - typeCount,
  blank_subcategory_before: before.rows.filter((row) => !row.subcategory).length,
  blank_subcategory_after: before.rows.filter((row) => !row.subcategory).length - subcategoryCount,
  parser: "kordoc@4.18.2", geometry_verifier: "pdfplumber@0.11.9",
};
writeFileSync("docs/data-quality/classification-restorations-20261015-v2.json",
  JSON.stringify({ summary, originals: originals.map(({ id, sha256, bytes, url }) => ({ id, sha256, bytes, url })), rows: changes }, null, 1) + "\n");
const q = (value) => "'" + String(value).replace(/'/g, "''") + "'";
const sql = [];
for (let i = 0; i < changes.length; i += 30) {
  const values = changes.slice(i, i + 30).map((row) => {
    const source = originals.find((file) => file.id === row.service_id.split(":").slice(0, 3).join(":"));
    const method = row.geometry.method ? "kordoc_pdf_open_column" : row.geometry.header === "페이지" ? "kordoc_pdf_mislabelled_header" : "kordoc_pdf_cells";
    return "(" + [revision, row.service_id, row.field, row.name, row.updated_date, row.before, row.value,
      row.source_label, source.url, row.page, "", row.original_sha256, method].map(q).join(",") + ")";
  });
  sql.push("INSERT OR IGNORE INTO official_classification_restoration(revision,service_id,field,expected_name,expected_updated_date,before_value,after_value,source_label,source_url,physical_page,glyph_sha256,original_pdf_sha256,verification_method) VALUES " + values.join(",") + ";");
}
const latest = "(SELECT id FROM official_sync_run WHERE status = 'succeeded' ORDER BY completed_at DESC LIMIT 1)";
for (const field of ["type", "subcategory"]) {
  const match = "r.revision = " + q(revision) + " AND r.service_id = official_service_snapshot.service_id AND r.expected_name = official_service_snapshot.name AND r.expected_updated_date = official_service_snapshot.updated_date AND r.field = " + q(field) + " AND r.before_value = official_service_snapshot." + field;
  sql.push("UPDATE official_service_snapshot SET " + field + " = (SELECT r.after_value FROM official_classification_restoration r WHERE " + match + ") WHERE sync_run_id = " + latest + " AND EXISTS (SELECT 1 FROM official_classification_restoration r WHERE " + match + ");");
}
sql.push("UPDATE official_service_snapshot SET search_text = " + SEARCH_TEXT_FROM_COLUMNS + " WHERE sync_run_id = " + latest + " AND EXISTS (SELECT 1 FROM official_classification_restoration r WHERE r.revision = " + q(revision) + " AND r.service_id = official_service_snapshot.service_id AND r.expected_name = official_service_snapshot.name AND r.expected_updated_date = official_service_snapshot.updated_date AND ((r.field = 'type' AND r.after_value = official_service_snapshot.type) OR (r.field = 'subcategory' AND r.after_value = official_service_snapshot.subcategory)));");
sql.push("UPDATE official_source_row_ledger SET mapped = (SELECT COUNT(*) FROM official_service_snapshot s WHERE s.sync_run_id = official_source_row_ledger.run_id AND s.service_id LIKE official_source_row_ledger.document_id || ':%' AND TRIM(s.subcategory) <> '' AND TRIM(s.type) <> ''), preserved_unresolved = (SELECT COUNT(*) FROM official_service_snapshot s WHERE s.sync_run_id = official_source_row_ledger.run_id AND s.service_id LIKE official_source_row_ledger.document_id || ':%' AND (TRIM(s.subcategory) = '' OR TRIM(s.type) = '')) WHERE run_id = " + latest + ";");
sql.push("DELETE FROM dataset_response_cache;");
sql.push("DELETE FROM mcp_search_cache;");
sql.push("INSERT OR REPLACE INTO app_setting(key,value,updated_at) SELECT " + q("source-classification-applied:" + revision) + ", id, CAST(strftime('%s','now') AS INTEGER) FROM official_sync_run WHERE status = 'succeeded' ORDER BY completed_at DESC LIMIT 1;");
writeFileSync("data/source-classification-backfill.sql", sql.join("\n--> statement-breakpoint\n") + "\n");
console.log(JSON.stringify(summary, null, 1));
