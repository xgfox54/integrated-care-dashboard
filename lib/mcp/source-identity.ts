import { z } from "zod";
import { ontologyEntities, type OntologyGates } from "../ontology.ts";
import { SOURCE_IDENTITY_PATHS } from "./source-identity-paths.ts";

const optionalId = z.string().min(1).nullable().optional();
const recordSchema = z.object({
  id: optionalId, entity_id: optionalId, implementation_id: optionalId, evidence_id: optionalId,
  institution_id: optionalId, budget_line_id: optionalId, observation_id: optionalId,
  fiscal_project_id: optionalId, fiscal_entity_id: optionalId, document_revision_id: optionalId,
  organization_id: optionalId, region_id: optionalId, article_id: optionalId,
  source_id: optionalId, source_version_id: optionalId, service_id: optionalId,
  faq_id: optionalId, section_id: optionalId, admin_sym: optionalId, source_project_code: optionalId,
  entity_type: optionalId, kind: optionalId, requested_id: optionalId,
  revision: z.unknown().optional(), manual_revision: optionalId, faq_revision: optionalId,
  dataset_id: optionalId, table_code: optionalId,
}).readonly();

export type SourceIdentityRecord = z.infer<typeof recordSchema>;
export interface SourceIdentityContext {
  readonly gates: OntologyGates;
  readonly statisticsRole?: "catalog" | "dataset";
  /** Evidence must name this exact returned record, not the current release bundle. */
  readonly capturedRevisions?: readonly { readonly canonical_id: string; readonly revision: string }[];
  /** 같은 응답이 밝힌 복지제도100 목록 버전. 목록 항목은 개별 버전이 없어 이 값을 쓴다. */
  readonly welfareCatalogRevision?: string;
}
export interface SourceIdentity {
  readonly schema_version: "source-identity-1";
  readonly entity_type: string;
  readonly namespace: string;
  readonly canonical_id: string;
  readonly source_record_id: string | null;
  readonly revision: string | null;
  readonly revision_basis: "record" | "captured_source" | "unknown";
  readonly aliases: readonly { readonly id: string; readonly basis: string }[];
  readonly catalog_id?: string | null;
  readonly dataset_id?: string | null;
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() === value && value.length > 0 && !/[\u0000-\u001f]/.test(value) ? value : null;
}

function locator(record: SourceIdentityRecord): string | null {
  const primary = [record.id, record.entity_id, record.implementation_id].filter(value => value != null);
  if (primary.length) return new Set(primary).size === 1 ? text(primary[0]) : null;
  const direct = record.institution_id ?? record.budget_line_id ?? record.observation_id ?? record.fiscal_project_id
    ?? record.document_revision_id ?? record.organization_id ?? record.fiscal_entity_id ?? record.evidence_id;
  if (direct != null) return text(direct);
  if (record.kind === "DOCUMENT_SOURCE" && record.source_version_id) return "doc:" + record.source_version_id;
  if (record.article_id) return record.article_id.startsWith("news:") ? record.article_id : "news:" + record.article_id;
  if (record.entity_type === "gov24_service" && record.service_id) return "gov24_service:" + record.service_id;
  if (record.entity_type === "official_faq" && record.faq_id) return "faq129:" + record.faq_id;
  if (record.entity_type === "manual_section" && record.section_id && text(record.revision)) return "manual:" + record.revision + ":" + record.section_id;
  return record.region_id ? text(record.region_id) : null;
}

const LOCATOR_PATTERNS: Readonly<Record<string, RegExp>> = {
  "faq129:": /^faq129:\d{1,10}$/,
  "manual:": /^manual:[a-z0-9][a-z0-9._-]{0,99}:[A-Za-z0-9][A-Za-z0-9._-]{0,119}$/,
  "gov24_service:": /^gov24_service:[A-Za-z0-9_-]{1,80}$/,
  "welfare100_service:": /^welfare100_service:[A-Za-z0-9_-]{1,100}$/,
  "ltc:": /^ltc:\d{11}$/,
  "lofin:laf:": /^lofin:laf:\d{1,12}$/,
} as const;

export function describeSourceIdentity(record: SourceIdentityRecord, context: SourceIdentityContext): SourceIdentity | null {
  const id = locator(record);
  if (!id) return null;
  const entities = ontologyEntities(context.gates);
  const catalog = context.statisticsRole ? context.statisticsRole === "catalog" : record.dataset_id !== undefined || /^(stat|indicator|approved|portal):/.test(id)
    || record.entity_type === "welfare_statistic" && !record.table_code;
  const statistics = Boolean(context.statisticsRole) || catalog || record.entity_type === "welfare_statistic" || Boolean(record.table_code) && /^(stat|population|kosis|report|index):/.test(id);
  const entity = statistics
    ? entities.find(row => row.id === "welfare_statistic")
    : entities.find(row => row.prefix && id.startsWith(row.prefix));
  if (!entity || record.entity_type && record.entity_type !== entity.id) return null;
  const prefix = entity.prefix;
  if (prefix && (id.length === prefix.length || !(LOCATOR_PATTERNS[prefix]?.test(id) ?? !/[\r\n\t/\\]/.test(id)))) return null;
  if (prefix === "news:" && record.article_id && record.article_id !== id && record.article_id !== id.slice(5)) return null;
  if (statistics && (!/^[A-Za-z0-9][A-Za-z0-9:._-]{0,199}$/.test(id) || catalog && !/^(stat|indicator|approved|portal|population):/.test(id))) return null;

  const manualParts = prefix === "manual:" ? id.split(":") : [];
  const recordRevision = text(record.revision) ?? (prefix === "manual:" ? text(record.manual_revision) ?? manualParts[1] ?? null
    : prefix === "faq129:" ? text(record.faq_revision)
    : prefix === "doc:" ? record.source_version_id ?? id.slice(4)
    : prefix === "bl-" || prefix === "brev-" ? record.document_revision_id ?? null : null);
  const captured = [...new Set(context.capturedRevisions?.filter(row => row.canonical_id === id).map(row => text(row.revision)).filter(value => value !== null) ?? [])];
  const revision = recordRevision ?? (captured.length === 1 ? captured[0] ?? null : prefix === "welfare100_service:" ? context.welfareCatalogRevision ?? null : null);
  const suffix = prefix ? id.slice(prefix.length) : null;
  const sourceId = prefix === "doc:" ? record.source_id ?? null
    : prefix === "manual:" ? record.section_id ?? manualParts[2] ?? null
    : prefix === "fp:" ? record.source_project_code ?? null
    : prefix === "faq129:" ? record.faq_id ?? suffix
    : prefix === "gov24_service:" ? record.service_id ?? suffix
    : prefix === "ltc:" ? record.admin_sym ?? suffix
    : statistics ? catalog ? null : id
    : ["news:", "welfare100_service:", "mohw-doc:"].includes(prefix ?? "") ? suffix : null;
  if ((prefix === "faq129:" && record.faq_id && record.faq_id !== suffix)
    || (prefix === "gov24_service:" && record.service_id && record.service_id !== suffix)
    || (prefix === "ltc:" && record.admin_sym && record.admin_sym !== suffix)
    || (prefix === "manual:" && (record.section_id && record.section_id !== manualParts[2] || recordRevision !== manualParts[1]))
    || (prefix === "doc:" && record.source_version_id && record.source_version_id !== suffix)) return null;
  const aliases = prefix === "news:" && suffix ? [{ id: suffix, basis: "get_news_metadata accepts article_id with or without news: prefix" }]
    : prefix === "welfare100_service:" && record.requested_id && record.requested_id !== id && LOCATOR_PATTERNS["welfare100_service:"]?.test(record.requested_id)
      ? [{ id: record.requested_id, basis: "resolved welfare catalog requested_id" }] : [];
  return {
    schema_version: "source-identity-1", entity_type: entity.id,
    namespace: statistics ? catalog ? "statistics_catalog" : "statistics_dataset" : prefix ?? entity.id,
    canonical_id: id, source_record_id: sourceId, revision,
    revision_basis: recordRevision ? "record" : revision ? "captured_source" : "unknown", aliases,
    ...(statistics ? { catalog_id: catalog ? id : null, dataset_id: catalog ? record.dataset_id ?? null : id } : {}),
  };
}

function object(value: unknown): value is Readonly<Record<string, unknown>> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function enrich(value: unknown, context: SourceIdentityContext, statisticsRevision?: unknown): unknown {
  if (!object(value) || "source_identity" in value) return value;
  const metadata = object(value.metadata) ? value.metadata : {};
  const metadataRevision = metadata.manual_revision ?? metadata.faq_revision;
  const parsed = recordSchema.safeParse({ ...metadata, ...(metadataRevision ? { revision: metadataRevision } : {}), ...value });
  if (!parsed.success) return value;
  const record = statisticsRevision === undefined ? parsed.data : { ...parsed.data, revision: statisticsRevision };
  const identity = describeSourceIdentity(record, context);
  return identity ? { ...value, source_identity: identity } : value;
}

function enrichAt(value: unknown, path: readonly string[], context: SourceIdentityContext, parentRevision?: unknown): unknown {
  if (Array.isArray(value)) return value.map((item: unknown) => enrichAt(item, path, context, parentRevision));
  if (!path.length) return enrich(value, context, parentRevision);
  const [key, ...tail] = path;
  if (!object(value) || !key || !(key in value)) return value;
  const nextContext = key === "dataset" || key === "datasets" ? { ...context, statisticsRole: "dataset" as const } : context;
  return { ...value, [key]: enrichAt(value[key], tail, nextContext, key === "dataset" ? value.revision : undefined) };
}

export function decorateSourceIdentities(toolName: string, payload: object, context: SourceIdentityContext): object;
export function decorateSourceIdentities(toolName: string, payload: unknown, context: SourceIdentityContext): unknown;
export function decorateSourceIdentities(toolName: string, payload: unknown, context: SourceIdentityContext): unknown {
  const paths = SOURCE_IDENTITY_PATHS[toolName];
  if (!paths || !object(payload) || "error" in payload || payload.isError === true) return payload;
  const wrapped = "data" in payload;
  const body = wrapped ? payload.data : payload;
  const catalog = object(body) ? [body.revision, object(body.welfare_catalog) ? body.welfare_catalog.revision : undefined].find((value) => typeof value === "string" && value.startsWith("welfare100:")) : undefined;
  const scoped = typeof catalog === "string" ? { ...context, welfareCatalogRevision: catalog } : context;
  const data = paths.reduce<unknown>((value, path) => enrichAt(value, path ? path.split(".") : [], scoped), body);
  const result = wrapped ? { ...payload, data } : data;
  return enrichAt(result, ["evidence"], scoped);
}
