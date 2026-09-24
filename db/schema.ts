import { sql } from "drizzle-orm";
import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

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
  },
  (table) => [index("official_sync_run_status_started_idx").on(table.status, table.startedAt)],
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
