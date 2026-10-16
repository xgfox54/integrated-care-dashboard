import assert from "node:assert/strict";
import test from "node:test";
import { ontologyRegistry, ontologyRegistrySchema, ontologyEntities, ontologyPredicates, ontologyMindmap, ENTITY_LABELS, RELATION_LABELS } from "./ontology.ts";
import { MCP_TOOL_NAMES } from "./mcp/contract.ts";
import { DOCUMENT_PREDICATES } from "./imports/pack.ts";
import { buildServerBranches } from "./mindmap.ts";

const gates = { fiscal: true, care: true, law: false };
test("Registry projections agree", () => {
  const entities = ontologyEntities(gates);
  assert.deepEqual(entities.slice(0, 16).map(row => row.id), ["implementation", "gov24_service", "welfare100_service", "manual_section", "region", "service_type", "organization", "press_release", "source_document", "fiscal_project", "budget_revision", "budget_line", "fiscal_entity", "document_program", "document_source", "fiscal_observation"]);
  assert.equal(entities.find(row => row.id === "gov24_service").prefix, "gov24_service:");
  assert.equal(ontologyRegistry.entity_types.find(row => row.id === "PublicBenefitService").prefix, "gov24:");
  for (const id of ["budget_revision", "budget_line", "official_faq"]) assert.equal(entities.find(row => row.id === id).status, "IMPLEMENTED");
  assert.equal(entities.find(row => row.id === "welfare_statistic").prefix, null);
  for (const row of entities) for (const tool of row.read_tools) assert.ok(MCP_TOOL_NAMES.includes(tool), tool);
  assert.equal(entities.some(row => row.schema_id === "StatisticalObservation"), false);
  const predicates = ontologyPredicates(gates);
  assert.deepEqual(predicates.filter(row => row.get_relationships).map(row => row.id).sort(), ["classified_as", "classified_as_topic", "has_jurisdiction", "issued_by", "located_in", "part_of"]);
  assert.equal(predicates.find(row => row.id === "issued_by").schema_id, "issuedBy");
  assert.deepEqual(Object.fromEntries(predicates.filter(row => row.assertion_type === "document_field").map(row => [row.id, row.label])), DOCUMENT_PREDICATES);
});

test("Disabled and invalid registry entries fail safely", () => {
  const entities = ontologyEntities({ fiscal: false, care: false, law: false });
  assert.ok(entities.every(row => row.gate === "always"));
  assert.equal(entities.some(row => ["budget_line", "care_provider", "legal_provision"].includes(row.id)), false);
  for (const mutate of [
    data => data.entity_types.push(data.entity_types[0]),
    data => { data.entity_types[0].gate = "unsupported"; },
    data => { data.entity_types[0].mcp.read_tools = ["execute_sql"]; },
    data => { data.relations[0].range = "UnknownEntity"; },
    data => { data.relations[0].get_relationships = false; },
    data => { data.relations.find(row => row.id === "succeeded_by").get_relationships = true; },
  ]) {
    const fixture = structuredClone(ontologyRegistry);
    mutate(fixture);
    assert.equal(ontologyRegistrySchema.safeParse(fixture).success, false);
  }
});

test("Mindmap projection preserves all concepts and localized labels", () => {
  const projected = ontologyMindmap();
  assert.deepEqual(projected.entities.map(row => row.id), ontologyRegistry.entity_types.map(row => row.id));
  assert.deepEqual(projected.relations.map(row => row.id), ontologyRegistry.relations.map(row => row.id));
  for (const row of projected.entities) assert.ok(ENTITY_LABELS[row.id]);
  for (const row of projected.relations) assert.ok(RELATION_LABELS[row.id]);
  const source = { generatedAt: "2026-10-13", knowledge: { dataAsOf: "", completedAt: "" }, services: { total: 0, documents: 0, categories: [], regions: [], targetGroups: [] }, news: { total: 0, categories: [] }, fiscal: { entityTotal: 0, regions: [], integratedCare: [] }, ontology: projected };
  const branch = buildServerBranches(source).find(row => row.id === "onto");
  assert.equal(branch.children[0].children.length, projected.entities.length);
  assert.equal(branch.children[1].children.length, projected.relations.length);
  const labels = node => [node.label, ...(node.children ?? []).flatMap(labels)];
  assert.doesNotMatch(labels(branch).join(" "), /[A-Za-z]{4,}/);
});
