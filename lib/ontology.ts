import { z } from "zod";
import source from "../ontology/welfare-v2/schema.json" with { type: "json" };

const gateSchema = z.enum(["always", "fiscal", "care", "law", "internal"]);
const statusSchema = z.enum(["IMPLEMENTED", "PARTIAL", "NOT_IMPLEMENTED", "NOT_COLLECTED"]);
const readToolSchema = z.enum(["find_programs", "get_entity", "get_relationships", "get_eligibility", "get_sources",
  "search_welfare_services", "fetch", "search_manuals", "get_manual_section", "search_news", "get_news_metadata",
  "find_budget_projects", "get_budget_execution", "get_fiscal_catalog", "search_budget_lines", "get_budget_breakdown",
  "search_faq", "get_faq", "search_statistics", "get_statistics_data", "get_statistics_sources",
  "find_care_institutions", "get_care_institution"]);
const entitySchema = z.object({
  id: z.string().min(1), label: z.string().min(1), description: z.string().min(1),
  prefix: z.string().optional(), status: statusSchema, gate: gateSchema,
  source: z.string().optional(), note: z.string().optional(),
  mcp: z.object({ id: z.string().min(1), prefix: z.string().nullable(), label: z.string(), description: z.string(),
    order: z.number().int().nonnegative(), read_tools: z.array(readToolSchema).readonly(),
    access_mode: z.enum(["direct", "evidence_only"]) }).strict().readonly().nullable(),
}).strict().readonly();
const relationSchema = z.object({
  id: z.string().min(1), label: z.string().min(1), description: z.string().min(1),
  domain: z.string().optional(), range: z.string().optional(), status: statusSchema,
  note: z.string().optional(), gate: gateSchema, get_relationships: z.boolean(),
  mcp: z.object({ id: z.string().min(1), domain: z.string(), range: z.string(), assertion_type: z.string(),
    order: z.number().int().nonnegative(), label: z.string().optional(), note: z.string().optional(),
    kinds: z.array(z.string()).readonly().optional() }).strict().readonly().nullable(),
}).strict().readonly();

const TRAVERSALS: ReadonlySet<string> = new Set(["located_in", "classified_as", "part_of", "has_jurisdiction", "issued_by", "classified_as_topic"]);
export const ontologyRegistrySchema = z.object({
  contract: z.literal("welfare-v2"), version: z.string().min(1), compatible_core: z.string(),
  entity_types: z.array(entitySchema).readonly(), relations: z.array(relationSchema).readonly(),
}).strict().superRefine((registry, ctx) => {
  const issue = (message: string) => ctx.addIssue({ code: "custom", message });
  for (const records of [registry.entity_types, registry.relations]) {
    for (const field of ["id", "mcp"] as const) {
      const seen = new Set<string>();
      for (const row of records) {
        const id = field === "id" ? row.id : row.mcp?.id;
        if (id && seen.has(id)) issue("Duplicate ontology identifier: " + id);
        if (id) seen.add(id);
      }
    }
  }
  const entities = new Set(registry.entity_types.map(row => row.id));
  const traversals = new Set<string>();
  for (const row of registry.relations) {
    for (const id of [row.domain, row.range].flatMap(value => value?.split("|") ?? [])) {
      if (!entities.has(id)) issue("Unknown relationship endpoint: " + id);
    }
    if (row.get_relationships) {
      if (!row.mcp || !TRAVERSALS.has(row.mcp.id) || row.gate !== "always") issue("Unsupported traversal: " + row.id);
      if (row.mcp) traversals.add(row.mcp.id);
    }
  }
  if (traversals.size !== TRAVERSALS.size) issue("The six public traversals must remain explicit");
  for (const row of registry.entity_types) {
    if (row.mcp && (row.gate === "internal" || row.mcp.access_mode === "direct" && row.mcp.read_tools.length === 0)) issue("Actionable entity has no public read contract: " + row.id);
  }
}).readonly();

export const ontologyRegistry = ontologyRegistrySchema.parse(source);
export const ONTOLOGY_VERSION = ontologyRegistry.version;
export interface OntologyGates { readonly fiscal: boolean; readonly care: boolean; readonly law: boolean }
function enabled(gate: z.infer<typeof gateSchema>, gates: OntologyGates): boolean {
  return gate === "always" || gate !== "internal" && gates[gate];
}

export function ontologyEntities(gates: OntologyGates) {
  return ontologyRegistry.entity_types.toSorted((a, b) => (a.mcp?.order ?? 0) - (b.mcp?.order ?? 0))
    .flatMap(row => row.mcp && enabled(row.gate, gates) ? [{
      id: row.mcp.id, prefix: row.mcp.prefix, label: row.mcp.label, description: row.mcp.description,
      read_tools: row.mcp.read_tools, access_mode: row.mcp.access_mode,
      schema_id: row.id, status: row.status, gate: row.gate,
    }] : []);
}

export function ontologyPredicates(gates: OntologyGates) {
  return ontologyRegistry.relations.toSorted((a, b) => (a.mcp?.order ?? 0) - (b.mcp?.order ?? 0))
    .flatMap(row => row.mcp && enabled(row.gate, gates) ? [{
      id: row.mcp.id, domain: row.mcp.domain, range: row.mcp.range, assertion_type: row.mcp.assertion_type,
      ...(row.mcp.label ? { label: row.mcp.label } : {}), ...(row.mcp.note ? { note: row.mcp.note } : {}),
      ...(row.mcp.kinds ? { kinds: row.mcp.kinds } : {}), schema_id: row.id, status: row.status,
      gate: row.gate, get_relationships: row.get_relationships,
    }] : []);
}

export const ENTITY_LABELS: Readonly<Record<string, string>> = Object.freeze(Object.fromEntries(ontologyRegistry.entity_types.map(row => [row.id, row.label])));
export const RELATION_LABELS: Readonly<Record<string, string>> = Object.freeze(Object.fromEntries(ontologyRegistry.relations.map(row => [row.id, row.label])));

export function ontologyMindmap() {
  return {
    entities: ontologyRegistry.entity_types.map(({ id, status, note }) => ({ id, status, ...(note ? { note } : {}) })),
    relations: ontologyRegistry.relations.map(({ id, domain, range, status }) => ({ id, domain: domain ?? "(여러 개체)", range: range ?? "(여러 개체)", status })),
  };
}
