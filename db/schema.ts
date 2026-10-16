import { sql } from "drizzle-orm";
import { check, foreignKey, index, integer, primaryKey, sqliteTable, text, unique } from "drizzle-orm/sqlite-core";

export const appSetting = sqliteTable("app_setting", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
  updatedAt: integer("updated_at").notNull(),
});

export const adminCredential = sqliteTable("admin_credential", {
  id: integer("id").primaryKey(),
  passwordHash: text("password_hash").notNull(),
  salt: text("salt").notNull(),
  iterations: integer("iterations").notNull(),
  failedAttempts: integer("failed_attempts").notNull().default(0),
  lockedUntil: integer("locked_until").notNull().default(0),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
});

export const adminSession = sqliteTable("admin_session", {
  tokenHash: text("token_hash").primaryKey(),
  createdAt: integer("created_at").notNull(),
  expiresAt: integer("expires_at").notNull(),
});

export const officialSyncRun = sqliteTable(
  "official_sync_run",
  {
    id: text("id").primaryKey(),
    trigger: text("trigger").notNull(),
    status: text("status").notNull(),
    startedAt: integer("started_at").notNull(),
    completedAt: integer("completed_at"),
    serviceCount: integer("service_count").notNull().default(0),
    documentCount: integer("document_count").notNull().default(0),
    error: text("error").notNull().default(""),
    stage: text("stage").notNull().default(""),
    progress: text("progress").notNull().default("{}"),
    advancedAt: integer("advanced_at").notNull().default(0),
  },
  (table) => [index("official_sync_run_status_started_idx").on(table.status, table.startedAt)],
);

export const officialSyncApiPage = sqliteTable(
  "official_sync_api_page",
  {
    runId: text("run_id").notNull(),
    term: text("term").notNull(),
    page: integer("page").notNull(),
    payload: text("payload").notNull(),
  },
  (table) => [primaryKey({ columns: [table.runId, table.term, table.page] })],
);

export const officialSyncLock = sqliteTable("official_sync_lock", {
  id: integer("id").primaryKey(),
  runId: text("run_id").notNull(),
  expiresAt: integer("expires_at").notNull(),
});

export const officialDocumentServiceCache = sqliteTable("official_document_service_cache", {
  documentId: text("document_id").primaryKey(),
  fingerprint: text("fingerprint").notNull(),
  payload: text("payload").notNull(),
  updatedAt: integer("updated_at").notNull(),
});

export const officialServiceSnapshot = sqliteTable(
  "official_service_snapshot",
  {
    id: text("id").primaryKey(),
    serviceId: text("service_id").notNull(),
    syncRunId: text("sync_run_id").notNull(),
    sido: text("sido").notNull(),
    sigungu: text("sigungu").notNull(),
    category: text("category").notNull(),
    subcategory: text("subcategory").notNull(),
    name: text("name").notNull(),
    description: text("description").notNull(),
    target: text("target").notNull(),
    detailTarget: text("detail_target").notNull(),
    applicationMethod: text("application_method").notNull().default(""),
    provider: text("provider").notNull(),
    type: text("type").notNull(),
    serial: text("serial").notNull(),
    detailUrl: text("detail_url").notNull(),
    updatedDate: text("updated_date").notNull(),
    collectedAt: integer("collected_at").notNull(),
    searchText: text("search_text").notNull().default(""),
  },
  (table) => [
    index("official_service_snapshot_run_idx").on(table.syncRunId),
    index("official_service_snapshot_region_idx").on(table.sido, table.sigungu),
    index("official_service_snapshot_run_order_idx").on(
      table.syncRunId,
      table.sido,
      table.sigungu,
      table.name,
    ),
    index("official_service_snapshot_run_category_idx").on(table.syncRunId, table.category),
    index("official_service_snapshot_run_type_idx").on(table.syncRunId, table.type),
    index("official_service_snapshot_canonical_region_idx").on(
      table.syncRunId,
      sql`(CASE WHEN sido IN ('광주광역시', '전라남도') THEN '전남광주통합특별시' ELSE sido END)`,
      table.sigungu,
    ),
    index("official_service_snapshot_normalized_service_idx").on(
      table.syncRunId,
      sql`(LOWER(REPLACE(REPLACE(service_id, ':', ''), '-', '')))`,
    ),
  ],
);

export const officialSourceDocument = sqliteTable(
  "official_source_document",
  {
    id: text("id").primaryKey(),
    documentId: text("document_id").notNull(),
    syncRunId: text("sync_run_id").notNull(),
    province: text("province").notNull(),
    municipality: text("municipality").notNull(),
    title: text("title").notNull(),
    publishedAt: text("published_at").notNull(),
    dataAsOf: text("data_as_of").notNull(),
    detailUrl: text("detail_url").notNull(),
    downloadUrl: text("download_url").notNull(),
    fileName: text("file_name").notNull(),
    collectedAt: integer("collected_at").notNull(),
  },
  (table) => [index("official_source_document_run_idx").on(table.syncRunId)],
);

export const wikiEdit = sqliteTable(
  "wiki_edit",
  {
    serviceId: text("service_id").primaryKey(),
    sido: text("sido").notNull(),
    sigungu: text("sigungu").notNull(),
    name: text("name").notNull(),
    description: text("description"),
    target: text("target"),
    detailTarget: text("detail_target"),
    provider: text("provider"),
    applicationMethod: text("application_method"),
    content: text("content"),
    sourceTitle: text("source_title"),
    sourceUrl: text("source_url"),
    note: text("note").notNull().default(""),
    updatedAt: integer("updated_at").notNull(),
  },
  (table) => [index("wiki_edit_updated_idx").on(table.updatedAt)],
);

// 대시보드 요약·검색·지역 묶음 응답 보관본(lib/dataset-cache.ts). 최신 수집 번호와
// 위키 수정 상태가 같을 때만 쓴다.
export const datasetResponseCache = sqliteTable("dataset_response_cache", {
  cacheKey: text("cache_key").primaryKey(),
  runId: text("run_id").notNull(),
  editsVersion: text("edits_version").notNull(),
  body: text("body").notNull(),
  createdAt: integer("created_at").notNull(),
});

export const apiRateLimit = sqliteTable(
  "api_rate_limit",
  {
    bucketKey: text("bucket_key").primaryKey(),
    requestCount: integer("request_count").notNull(),
    expiresAt: integer("expires_at").notNull(),
  },
  (table) => [index("api_rate_limit_expires_at_idx").on(table.expiresAt)],
);

// Deployment-pinned parsed manuals. FTS5 virtual tables and maintenance triggers
// are declared in 0110_manual_corpus.sql because Drizzle has no FTS5 table model.
export const manualCorpus = sqliteTable("manual_corpus", {
  revision: text("revision").primaryKey().notNull(),
  sourceRepository: text("source_repository").notNull(),
  sourceCommit: text("source_commit").notNull(),
  manifestSha256: text("manifest_sha256").notNull(),
  manifestCreatedAt: integer("manifest_created_at").notNull(),
  expectedDocuments: integer("expected_documents").notNull(),
  expectedSections: integer("expected_sections").notNull(),
  batchCount: integer("batch_count").notNull(),
  nextBatch: integer("next_batch").notNull().default(0),
  documentCount: integer("document_count").notNull().default(0),
  sectionCount: integer("section_count").notNull().default(0),
  status: text("status").notNull().default("STAGING"),
  leaseToken: text("lease_token"),
  leaseExpiresAt: integer("lease_expires_at"),
  failureCount: integer("failure_count").notNull().default(0),
  lastError: text("last_error"),
  retryAfter: integer("retry_after"),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
  activatedAt: integer("activated_at"),
}, (table) => [
  check("manual_corpus_documents_positive", sql`${table.expectedDocuments} > 0`),
  check("manual_corpus_sections_positive", sql`${table.expectedSections} > 0`),
  check("manual_corpus_batches_positive", sql`${table.batchCount} > 0`),
  check("manual_corpus_status_valid", sql`${table.status} IN ('STAGING','ACTIVE','SUPERSEDED')`),
]);

export const manualDocument = sqliteTable("manual_document", {
  corpusRevision: text("corpus_revision").notNull().references(() => manualCorpus.revision),
  documentId: text("document_id").notNull(),
  sourceName: text("source_name").notNull(),
  sourcePath: text("source_path").notNull(),
  sha256: text("sha256").notNull(),
  byteSize: integer("byte_size").notNull(),
  documentYear: text("document_year"),
  category: text("category").notNull(),
  documentType: text("document_type").notNull(),
  publisher: text("publisher").notNull(),
  edition: text("edition").notNull(),
  effectiveFrom: text("effective_from").notNull(),
  effectiveTo: text("effective_to").notNull(),
  topic: text("topic").notNull(),
  authority: text("authority").notNull(),
  sourceRole: text("source_role").notNull(),
  jurisdiction: text("jurisdiction").notNull(),
  sectionCount: integer("section_count").notNull(),
}, (table) => [
  primaryKey({ columns: [table.corpusRevision, table.documentId] }),
  unique().on(table.corpusRevision, table.sourceName),
]);

export const manualSection = sqliteTable("manual_section", {
  rowId: integer("row_id").primaryKey(),
  corpusRevision: text("corpus_revision").notNull(),
  sectionId: text("section_id").notNull(),
  documentId: text("document_id").notNull(),
  ordinal: integer("ordinal").notNull(),
  nodeId: text("node_id").notNull(),
  title: text("title").notNull(),
  headingPath: text("heading_path").notNull(),
  serviceNames: text("service_names").notNull(),
  originalName: text("original_name").notNull(),
  upstreamOriginalName: text("upstream_original_name").notNull(),
  originalNameBasis: text("original_name_basis").notNull(),
  originalNameLine: integer("original_name_line"),
  startLine: integer("start_line").notNull(),
  endLine: integer("end_line").notNull(),
  content: text("content").notNull(),
  contentHash: text("content_hash").notNull(),
  sourceYear: text("source_year"),
  sourceYearOrigin: text("source_year_origin").notNull(),
  originalSearch: text("original_search").notNull(),
  titleSearch: text("title_search").notNull(),
  headingSearch: text("heading_search").notNull(),
  searchText: text("search_text").notNull(),
}, (table) => [
  unique().on(table.corpusRevision, table.sectionId),
  unique().on(table.corpusRevision, table.documentId, table.ordinal),
  foreignKey({ columns: [table.corpusRevision, table.documentId], foreignColumns: [manualDocument.corpusRevision, manualDocument.documentId] }),
  index("manual_section_document_idx").on(table.corpusRevision, table.documentId, table.ordinal),
  check("manual_section_original_name_basis_valid", sql`${table.originalNameBasis} IN ('explicit_original_file_marker','upstream_metadata','mixed_original_files')`),
]);

export const manualActive = sqliteTable("manual_active", {
  id: integer("id").primaryKey(),
  revision: text("revision").references(() => manualCorpus.revision),
  generation: integer("generation").notNull().default(0),
  updatedAt: integer("updated_at").notNull(),
}, (table) => [check("manual_active_singleton", sql`${table.id} = 1`)]);

// Millisecond timestamps; one MOIS scope publishes all three age groups atomically.
export const statisticsRefreshScope = sqliteTable("statistics_refresh_scope", {
  scopeId: text("scope_id").primaryKey(),
  resultJson: text("result_json"),
  previousJson: text("previous_json"),
  revision: text("revision"),
  latestPeriod: text("latest_period"),
  lastAttemptAt: integer("last_attempt_at"),
  lastSuccessAt: integer("last_success_at"),
  nextCheckAt: integer("next_check_at").notNull().default(0),
  failureCount: integer("failure_count").notNull().default(0),
  errorCode: text("error_code"),
  stageJson: text("stage_json"),
  updatedAt: integer("updated_at").notNull(),
}, (table) => [check("statistics_refresh_failure_count_nonnegative", sql`${table.failureCount} >= 0`)]);

export const statisticsRefreshWorker = sqliteTable("statistics_refresh_worker", {
  id: integer("id").primaryKey(),
  leaseToken: text("lease_token"),
  leaseExpiresAt: integer("lease_expires_at"),
  activeScope: text("active_scope"),
  lastWakeAt: integer("last_wake_at"),
  hostStateJson: text("host_state_json").notNull().default("{}"),
}, (table) => [check("statistics_refresh_worker_singleton", sql`${table.id} = 1`)]);

export const officialClassificationRestoration = sqliteTable("official_classification_restoration", {
  revision: text("revision").notNull(),
  serviceId: text("service_id").notNull(),
  field: text("field").notNull(),
  expectedName: text("expected_name").notNull(),
  expectedUpdatedDate: text("expected_updated_date").notNull(),
  beforeValue: text("before_value").notNull(),
  afterValue: text("after_value").notNull(),
  sourceLabel: text("source_label").notNull(),
  sourceUrl: text("source_url").notNull(),
  physicalPage: integer("physical_page").notNull(),
  glyphSha256: text("glyph_sha256").notNull(),
  originalPdfSha256: text("original_pdf_sha256"),
  verificationMethod: text("verification_method").notNull().default("synap_glyph"),
}, (table) => [
  primaryKey({ columns: [table.revision, table.serviceId, table.field] }),
  check("official_classification_field", sql`${table.field} IN ('type','subcategory')`),
]);
