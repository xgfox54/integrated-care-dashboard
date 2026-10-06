// 문서 사실 공개 묶음(welfare-public-release-v2, knowledge/document-facts-1) 만들기. 로컬 전용.
// 사실 ID·내용 지문 규칙은 서버 검사기(lib/imports/pack.ts)의 함수를 그대로 써서 두 쪽 결과가 항상 같다.
import { createHash } from "node:crypto";

import { contentDigestOf, DOCUMENT_SCHEMA_VERSION, IMPORT_FORMAT, sourceSetDigestOf, statementIdOf } from "../../lib/imports/pack.ts";
import { zipStored } from "../../lib/platform/zip-writer.ts";

const encoder = new TextEncoder();
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const jsonl = (rows) => encoder.encode(rows.map((row) => JSON.stringify(row)).join("\n") + (rows.length ? "\n" : ""));

/**
 * @param {object} input
 * @param {string} input.artifactId
 * @param {string} input.createdAt ISO 시각
 * @param {string} input.producerRunId
 * @param {string} input.mappingVersion
 * @param {string|null} input.baseSourceRunId
 * @param {object[]} input.sources 서버 sources.jsonl 행 그대로
 * @param {object[]} input.facts { subject_id, subject_label, subject_sido, subject_sigungu, predicate_id, value_text, unit, scope_text, source_version_id, reviewed_at, evidence: [{ block_id, ir_pointer, table_id, cell, layout_page_start, quote }] }
 * @param {string[]} [input.emptyReplaceSourceIds]
 */
export async function buildDocumentPack(input) {
  const parseOf = new Map(input.sources.map((source) => [source.source_version_id, source]));
  const statements = [];
  const evidence = [];
  for (const fact of input.facts) {
    const statement = {
      statement_id: "", subject_id: fact.subject_id, subject_label: fact.subject_label, subject_sido: fact.subject_sido, subject_sigungu: fact.subject_sigungu ?? "",
      predicate_id: fact.predicate_id, value_text: fact.value_text, unit: fact.unit ?? null, scope_text: fact.scope_text ?? null,
      source_version_id: fact.source_version_id, assertion_type: "document_field", review_status: fact.review_status ?? "approved", reviewed_at: fact.reviewed_at,
    };
    statement.statement_id = await statementIdOf(statement);
    statements.push(statement);
    const source = parseOf.get(fact.source_version_id);
    for (const proof of fact.evidence ?? []) {
      evidence.push({
        evidence_id: "ev_" + sha256(statement.statement_id + "|" + proof.block_id + "|" + (proof.cell ?? "")).slice(0, 24),
        statement_id: statement.statement_id, source_version_id: fact.source_version_id, parse_id: source?.parse_id ?? "",
        block_id: proof.block_id, ir_pointer: proof.ir_pointer, table_id: proof.table_id ?? null, cell: proof.cell ?? null,
        locator_precision: source?.locator_precision ?? "parsed_structural", page_mode: source?.page_mode ?? "layout",
        layout_page_start: proof.layout_page_start ?? null, physical_page_verified: false, quote: proof.quote,
      });
    }
  }
  const files = [
    { path: "data/knowledge/sources.jsonl", bytes: jsonl(input.sources), records: input.sources.length },
    { path: "data/knowledge/statements.jsonl", bytes: jsonl(statements), records: statements.length },
    { path: "data/knowledge/evidence.jsonl", bytes: jsonl(evidence), records: evidence.length },
    { path: "README.md", bytes: encoder.encode("# " + IMPORT_FORMAT + " (knowledge / " + DOCUMENT_SCHEMA_VERSION + ")\n\n검토 승인된 문서 사실과 근거 위치만 담았습니다. 원문 파일·파서 중간 결과·검토 메모는 넣지 않습니다.\n"), records: null },
  ];
  const sourceIds = [...new Set([...input.sources.map((source) => source.source_id), ...(input.emptyReplaceSourceIds ?? [])])].sort();
  const manifest = {
    format: IMPORT_FORMAT,
    artifact_id: input.artifactId,
    created_at: input.createdAt,
    producer_run_id: input.producerRunId,
    modules_present: ["knowledge"],
    module_schema_versions: { knowledge: DOCUMENT_SCHEMA_VERSION },
    module_modes: { knowledge: "source_scoped_replace" },
    publication_scope: { knowledge: { source_ids: sourceIds, ...(input.emptyReplaceSourceIds?.length ? { empty_replace_source_ids: input.emptyReplaceSourceIds } : {}) } },
    ontology_version: "welfare-v2",
    mapping_version: input.mappingVersion,
    base_release_bundle_id: input.baseReleaseBundleId ?? null,
    base_source_run_id: input.baseSourceRunId,
    base_component_ids: input.baseComponentIds ?? {},
    source_set_digest: await sourceSetDigestOf(input.sources),
    content_digest: await contentDigestOf(statements, evidence),
    source_policy_versions: input.sourcePolicyVersions ?? {},
    files: files.map((file) => ({ path: file.path, size: file.bytes.length, sha256: sha256(file.bytes), records: file.records })),
    coverage: input.coverage ?? { statements: statements.length, evidence: evidence.length },
    validation: input.validation ?? { validator: "factory/release/pack-builder.mjs", checks: ["server-shared statement_id", "content_digest"] },
  };
  const zip = zipStored([{ path: "manifest.json", bytes: encoder.encode(JSON.stringify(manifest, null, 2)) }, ...files.map(({ path, bytes }) => ({ path, bytes }))]);
  return { zip, sha256: sha256(zip), manifest, statements, evidence };
}
