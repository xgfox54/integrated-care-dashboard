import assert from "node:assert/strict";
import test from "node:test";
import { ontologyEntities } from "./ontology.ts";
import { describeSourceIdentity, decorateSourceIdentities } from "./mcp/source-identity.ts";

const enabled = { gates: { fiscal: true, care: true, law: true } };
const matrix = [
  ["implementation", { implementation_id: "service:강원|사업|01" }],
  ["region", { entity_id: "region:서울특별시" }],
  ["service_type", { id: "category:건강|진료" }],
  ["organization", { organization_id: "org:seoul" }],
  ["fiscal_entity", { fiscal_entity_id: "lofin:laf:1100000" }],
  ["fiscal_project", { fiscal_project_id: "fp:2026:1100000:100:200:300" }],
  ["fiscal_observation", { observation_id: "fo:run1:2026:1100000:100:200:300", fiscal_project_id: "fp:2026:1100000:100:200:300" }],
  ["budget_revision", { document_revision_id: "brev-001" }],
  ["budget_line", { budget_line_id: "bl-001", document_revision_id: "brev-001" }],
  ["press_release", { entity_id: "news:press_001", article_id: "press_001" }],
  ["care_provider", { institution_id: "ltc:12345678901", admin_sym: "12345678901" }],
  ["gov24_service", { id: "gov24_service:Abc_001", service_id: "Abc_001" }],
  ["welfare100_service", { id: "welfare100_service:basic-pension" }],
  ["manual_section", { id: "manual:2026-v1:section01", section_id: "section01", revision: "2026-v1" }],
  ["source_document", { evidence_id: "mohw-doc:menu-01" }],
  ["document_program", { id: "docprog:program-01" }],
  ["document_source", { kind: "DOCUMENT_SOURCE", source_id: "original-01", source_version_id: "version-02" }],
  ["official_faq", { id: "faq129:00123", faq_id: "00123" }],
  ["welfare_statistic", { id: "approved:1", dataset_id: null, kind: "approved" }],
];

for (const [entity, record] of matrix) {
  test(`identity matrix maps ${entity} when its public locator is returned`, () => {
    const before = structuredClone(record);
    const identity = describeSourceIdentity(record, enabled);
    assert.equal(identity?.entity_type, entity);
    assert.equal(identity?.canonical_id, entity === "document_source" ? "doc:version-02" : Object.values(record)[0]);
    assert.deepEqual(record, before);
  });
}

test("identity matrix accounts for every exposed registry entity", () => {
  const expected = ontologyEntities(enabled.gates).map(row => row.id).sort();
  const actual = matrix.map(([entity]) => entity).sort();
  assert.deepEqual(actual, expected);
});

function stripIdentity(value) {
  if (Array.isArray(value)) return value.map(stripIdentity);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value).filter(([key]) => key !== "source_identity").map(([key, item]) => [key, stripIdentity(item)]));
}

test("immutable enrichment preserves entire fiscal payload and nested evidence", () => {
  const payload = { data: { items: [{ fiscal_project_id: "fp:2026:110:100:200:300", current_budget_krw: null,
    fiscal_entity: { fiscal_entity_id: "lofin:laf:110" }, evidence: { evidence_id: "fo:run:2026:110:100:200:300", source_raw_values: { bdg_cash_amt: null } },
    budget_documents: [{ budget_line_id: "bl-01", document_revision_id: "brev-01", same_project_verified: false }] }] }, evidence: [], warnings: ["unchanged"], release_bundle_id: "new-bundle" };
  const before = structuredClone(payload);
  const enriched = decorateSourceIdentities("find_budget_projects", payload, enabled);
  assert.deepEqual(stripIdentity(enriched), before);
  assert.deepEqual(payload, before);
  assert.equal(enriched.data.items[0].source_identity.canonical_id, "fp:2026:110:100:200:300");
  assert.equal(enriched.data.items[0].evidence.source_identity.entity_type, "fiscal_observation");
  assert.equal(enriched.data.items[0].budget_documents[0].source_identity.canonical_id, "bl-01");
});

for (const id of ["approved:1", "indicator:2", "portal:kosis", "stat:2760", "population:senior"]) {
  test(`statistics separation retains nullable dataset when catalog is ${id}`, () => {
    const input = { data: { items: [{ id, kind: "indicator", dataset_id: null, data_available: false }] } };
    const result = decorateSourceIdentities("search_statistics", input, enabled);
    assert.deepEqual(result.data.items[0].source_identity, { schema_version: "source-identity-1", entity_type: "welfare_statistic", namespace: "statistics_catalog", canonical_id: id, source_record_id: null, revision: null, revision_basis: "unknown", aliases: [], catalog_id: id, dataset_id: null });
    assert.deepEqual(stripIdentity(result), input);
  });
}

test("statistics separation decorates dataset with its captured wrapper revision and no series identity", () => {
  const input = { data: { dataset: { id: "kosis:table-01", table_code: "table-01", series: [{ id: "region:11", points: [{ value: null }] }] }, revision: "stored-old-revision" }, release_bundle_id: "new-bundle" };
  const result = decorateSourceIdentities("get_statistics_data", input, enabled);
  assert.equal(result.data.dataset.source_identity.namespace, "statistics_dataset");
  assert.equal(result.data.dataset.source_identity.dataset_id, "kosis:table-01");
  assert.equal(result.data.dataset.source_identity.catalog_id, null);
  assert.equal(result.data.dataset.source_identity.revision, "stored-old-revision");
  assert.equal(result.data.dataset.series[0].source_identity, undefined);
  assert.deepEqual(stripIdentity(result), input);
});

test("statistics separation never calls a catalog dataset link an alias", () => {
  const record = { id: "approved:3", dataset_id: "kosis:other", kind: "approved" };
  const identity = describeSourceIdentity(record, enabled);
  assert.equal(identity.canonical_id, "approved:3");
  assert.equal(identity.dataset_id, "kosis:other");
  assert.deepEqual(identity.aliases, []);
});

test("statistics separation respects dataset role when stat prefix is shared with catalog", () => {
  const input = { data: { dataset: { id: "stat:2760", table_code: "table-2760" }, revision: "stored-old" } };
  const result = decorateSourceIdentities("get_statistics_data", input, enabled);
  assert.equal(result.data.dataset.source_identity.namespace, "statistics_dataset");
  assert.equal(result.data.dataset.source_identity.catalog_id, null);
  assert.equal(result.data.dataset.source_identity.dataset_id, "stat:2760");
  assert.equal(result.data.dataset.source_identity.revision, "stored-old");
});

test("same title retains independent identities across source namespaces", () => {
  const payload = { results: [{ id: "faq129:23", title: "Shared title" }, { id: "gov24_service:23", title: "Shared title" }] };
  const result = decorateSourceIdentities("search", payload, enabled);
  assert.deepEqual(result.results.map(row => row.source_identity.canonical_id), ["faq129:23", "gov24_service:23"]);
  assert.ok(result.results.every(row => row.source_identity.aliases.length === 0));
});

for (const record of [ {}, { id: "" }, { id: "faq129:" }, { id: "faq129:x" }, { id: "ltc:12" }, { id: "manual:bad" },
  { id: "https://source.example/23" }, { id: "law:123" }, { id: "supplement:23" }, { id: "admin-edit:23" },
  { id: "lofin:dept:110:20", fiscal_entity_id: "lofin:laf:110" }, { id: "faq129:23", entity_id: "faq129:24" },
  { id: "faq129:23", faq_id: "24" }, { id: "gov24_service:a", service_id: "b" }, { id: "news:a", article_id: "b" },
  { id: "faq129:23", entity_type: "gov24_service" }, { id: "manual:old:section1", revision: "new" },
  { id: "doc:v1", source_version_id: "v2" }, { id: "region:" }, { id: " faq129:23" } ]) {
  test(`unknown or ambiguous record is unclassified: ${JSON.stringify(record)}`, () => {
    assert.equal(describeSourceIdentity(record, enabled), null);
  });
}

test("gated registry namespaces cannot acquire descriptors when disabled", () => {
  const context = { gates: { fiscal: false, care: false, law: false } };
  const payload = { results: matrix.map(([, record]) => record) };
  const result = decorateSourceIdentities("search", payload, context);
  assert.deepEqual(result.results.filter(row => row.source_identity).map(row => row.source_identity.entity_type).sort(), matrix.filter(([entity]) => !["care_provider", "fiscal_entity", "fiscal_project", "fiscal_observation", "budget_revision", "budget_line"].includes(entity)).map(([entity]) => entity).sort());
  assert.deepEqual(stripIdentity(result), payload);
});

test("rubric and conditions IDs are untouched outside explicit source paths", () => {
  const payload = { id: "faq129:23", revision: "old", aliases: [{ alias: "faq129:24", kind: "search" }],
    answer_criteria: { items: [{ id: "faq129:25" }] }, structured_conditions: [{ id: "service:condition" }], results: [{ id: "news:rubric" }] };
  const result = decorateSourceIdentities("get_faq", payload, enabled);
  assert.deepEqual(stripIdentity(result), payload);
  assert.deepEqual(result.source_identity.aliases, []);
  assert.deepEqual(result.answer_criteria, payload.answer_criteria);
  assert.deepEqual(result.results, payload.results);
});

test("revision remains unknown for cached search despite bundle and source aggregate pins", () => {
  const payload = { results: [{ id: "gov24_service:old" }, { id: "faq129:23" }], release_bundle_id: "new", gov24_revision: "new-gov24", manual_revision: "new-manual" };
  const result = decorateSourceIdentities("search", payload, enabled);
  assert.deepEqual(result.results.map(row => [row.source_identity.revision, row.source_identity.revision_basis]), [[null, "unknown"], [null, "unknown"]]);
});

test("revision prefers record evidence over exact captured context", () => {
  const identity = describeSourceIdentity({ id: "faq129:23", revision: "old" }, { ...enabled, capturedRevisions: [{ canonical_id: "faq129:23", revision: "new" }] });
  assert.equal(identity.revision, "old");
  assert.equal(identity.revision_basis, "record");
});

test("revision context only applies to its exact canonical locator", () => {
  const result = decorateSourceIdentities("search", { results: [{ id: "faq129:23" }, { id: "faq129:24" }] }, { ...enabled, capturedRevisions: [{ canonical_id: "faq129:23", revision: "captured" }] });
  assert.deepEqual(result.results.map(row => [row.source_identity.revision, row.source_identity.revision_basis]), [["captured", "captured_source"], [null, "unknown"]]);
});

test("revision conflict in captured context is unknown", () => {
  const result = describeSourceIdentity({ id: "faq129:23" }, { ...enabled, capturedRevisions: [{ canonical_id: "faq129:23", revision: "a" }, { canonical_id: "faq129:23", revision: "b" }] });
  assert.equal(result.revision, null);
});

test("immutable enrichment uses fetch metadata revision without changing metadata or text", () => {
  const input = { id: "faq129:23", text: "Body\nConditions", metadata: { entity_type: "official_faq", faq_revision: "old", faq_id: "23", release_bundle_id: "new" } };
  const result = decorateSourceIdentities("fetch", input, enabled);
  assert.equal(result.source_identity.revision, "old");
  assert.deepEqual(stripIdentity(result), input);
  assert.deepEqual(decorateSourceIdentities("fetch", result, enabled), result);
});

test("aliases are limited to resolved same-source catalog and news parser aliases", () => {
  const payload = { id: "welfare100_service:canonical", requested_id: "welfare100_service:old", revision: "catalog-old" };
  const result = decorateSourceIdentities("fetch", payload, enabled);
  assert.deepEqual(result.source_identity.aliases.map(row => row.id), ["welfare100_service:old"]);
});

test("unknown tool and error payloads are returned untouched", () => {
  const payload = { id: "faq129:23", error: { code: "NOT_FOUND" } };
  assert.equal(decorateSourceIdentities("fetch", payload, enabled), payload);
  assert.equal(decorateSourceIdentities("unknown", payload, enabled), payload);
  assert.equal(decorateSourceIdentities("search", null, enabled), null);
});

test("immutable enrichment skips malformed source fields without throwing", () => {
  const payload = { results: [null, 23, { id: 23 }, { id: "faq129:23", faq_id: 23 }] };
  const result = decorateSourceIdentities("search", payload, enabled);
  assert.deepEqual(result, payload);
});


test("welfare catalog list results carry the catalog revision that the same response reports", () => {
  const item = { id: "welfare100_service:seogwipo-warm-store", entity_type: "welfare100_service" };
  const listed = decorateSourceIdentities("search_welfare_services", { revision: "welfare100:d8f3efed", items: [item] }, enabled);
  assert.equal(listed.items[0].source_identity.revision, "welfare100:d8f3efed");
  assert.equal(listed.items[0].source_identity.revision_basis, "captured_source");
  const unified = decorateSourceIdentities("search", { welfare_catalog: { revision: "welfare100:d8f3efed" }, results: [item] }, enabled);
  assert.equal(unified.results[0].source_identity.revision, "welfare100:d8f3efed");
  const unversioned = decorateSourceIdentities("search", { results: [item] }, enabled);
  assert.equal(unversioned.results[0].source_identity.revision, null);
});

