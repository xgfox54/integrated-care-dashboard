import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";

import { expandCompactRows, normalizeRows, serviceWikiKey } from "../lib/dataset.ts";
import { buildDatasetSummary } from "../lib/dataset-summary.ts";
import {
  removeExtractedContinuationFragments,
  repairKnownExtractionFragments,
} from "../lib/official-correction.ts";
import { repairExtractionSpacing } from "../lib/official-spacing.ts";
import { REGION_DEFINITIONS } from "../lib/region-statistics.ts";
import { applyWikiEdits } from "../lib/wiki-edits.ts";

const STATE_ROOT = resolve(".wrangler/state");
const SUMMARY_PATH = resolve("public/data/summary.json");
const REGIONS_PATH = resolve("public/data/regions");
const LEGACY_PATH = resolve("public/dashboard-snapshot-20260920.json");
const EXPLICIT_SOURCE_PATH = process.env.DASHBOARD_SNAPSHOT_SOURCE
  ? resolve(process.env.DASHBOARD_SNAPSHOT_SOURCE)
  : "";
const SOURCE_URL = "https://www.mohw.go.kr/menu.es?mid=a60600000000";

function compactPayload(rows) {
  const columns = Object.keys(rows[0] ?? {});
  const dictionaries = columns.map(() => []);
  const dictionaryIndexes = columns.map(() => new Map());
  const compactRows = rows.map((row) =>
    columns.map((column, columnIndex) => {
      const value = String(row[column] ?? "");
      const indexes = dictionaryIndexes[columnIndex];
      const existing = indexes.get(value);
      if (existing !== undefined) return existing;
      const next = dictionaries[columnIndex].length;
      dictionaries[columnIndex].push(value);
      indexes.set(value, next);
      return next;
    }),
  );
  return { columns, dictionaries, rows: compactRows };
}

function sqliteFiles(directory) {
  if (!existsSync(directory)) return [];
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) return sqliteFiles(path);
    return entry.isFile() && entry.name.endsWith(".sqlite") ? [path] : [];
  });
}

function openSnapshotDatabase() {
  const candidates = sqliteFiles(STATE_ROOT).sort(
    (left, right) => statSync(right).mtimeMs - statSync(left).mtimeMs,
  );
  for (const path of candidates) {
    const database = new DatabaseSync(path, { readOnly: true });
    const table = database
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'official_service_snapshot'")
      .get();
    if (table) return database;
    database.close();
  }
  return null;
}

const database = EXPLICIT_SOURCE_PATH ? null : openSnapshotDatabase();
try {
  let services;
  let fetchedAt;
  let dataAsOf;
  let fromDatabase = false;
  if (EXPLICIT_SOURCE_PATH) {
    const legacy = JSON.parse(readFileSync(EXPLICIT_SOURCE_PATH, "utf8"));
    services = expandCompactRows(legacy);
    fetchedAt = legacy.fetchedAt ?? "";
    dataAsOf = legacy.dataAsOf ?? "";
  } else if (database) {
    fromDatabase = true;
    const run = database
      .prepare(
        "SELECT id, completed_at FROM official_sync_run WHERE status = 'succeeded' ORDER BY completed_at DESC LIMIT 1",
      )
      .get();
    if (!run) throw new Error("성공한 공식자료 현행화 이력이 없습니다.");
    const documentDate = database
      .prepare("SELECT MAX(data_as_of) AS dataAsOf FROM official_source_document WHERE sync_run_id = ?")
      .get(run.id);
    services = database
      .prepare(
        "SELECT service_id AS serviceId, sido, sigungu, category, subcategory, name, description, target, detail_target AS detailTarget, application_method AS applicationMethod, provider, type, serial, detail_url AS detailUrl, updated_date AS updatedDate FROM official_service_snapshot WHERE sync_run_id = ? ORDER BY sido, sigungu, name",
      )
      .all(run.id);
    fetchedAt = new Date(Number(run.completed_at) * 1000).toISOString();
    dataAsOf = documentDate?.dataAsOf ?? "";
  } else if (existsSync(LEGACY_PATH)) {
    const legacy = JSON.parse(readFileSync(LEGACY_PATH, "utf8"));
    services = expandCompactRows(legacy);
    fetchedAt = legacy.fetchedAt ?? "";
    dataAsOf = legacy.dataAsOf ?? "";
  } else {
    throw new Error("로컬 D1 또는 기존 공식 사업 스냅샷을 찾지 못했습니다.");
  }
  if (fetchedAt) {
    const collected = Date.parse(fetchedAt);
    if (!Number.isFinite(collected) || collected < Date.UTC(2000, 0, 1) || collected > Date.now() + 86_400_000) {
      throw new Error("수집 시각이 유효하지 않습니다. 운영 공개 자료를 명시적으로 받아 스냅샷을 만들거나 수집 이력을 확인해 주세요.");
    }
  }
  // 공개 API와 기존 공개 스냅샷에는 사람의 편집이 포함되므로 의미 보정을 재적용하지 않는다.
  const correctedRows = fromDatabase
    ? repairExtractionSpacing(removeExtractedContinuationFragments(repairKnownExtractionFragments(services)))
    : services;
  const edits = fromDatabase
    ? new Map(database.prepare(
      "SELECT service_id AS serviceId, description, target, detail_target AS detailTarget, provider, application_method AS applicationMethod FROM wiki_edit",
    ).all().map((edit) => [edit.serviceId, edit]))
    : new Map();
  const rows = normalizeRows(applyWikiEdits(correctedRows, edits));
  if (rows.length !== 12_526) {
    throw new Error(`빠른 시작 스냅샷은 12,526건이어야 합니다. 현재 ${rows.length}건입니다.`);
  }
  const wikiKeys = new Set(rows.map(serviceWikiKey));
  if (wikiKeys.size !== rows.length) {
    throw new Error(
      `빠른 시작 스냅샷의 WIKI 사업 식별자가 고유하지 않습니다: ${wikiKeys.size}/${rows.length}`,
    );
  }

  const meta = {
    state: "official",
    sourceLabel: "보건복지부 통합돌봄 사업안내",
    sourceUrl: SOURCE_URL,
    fetchedAt,
    dataAsOf,
    message: "검증된 요약 자료를 먼저 표시하고 최신 서버 자료를 순차적으로 확인하고 있습니다.",
  };
  mkdirSync(REGIONS_PATH, { recursive: true });
  writeFileSync(SUMMARY_PATH, JSON.stringify({ ...meta, summary: buildDatasetSummary(rows) }));
  for (const region of REGION_DEFINITIONS) {
    const regionRows = rows.filter((row) => row.sido === region.fullName);
    writeFileSync(
      resolve(REGIONS_PATH, `${region.id}.json`),
      JSON.stringify({ ...meta, ...compactPayload(regionRows) }),
    );
  }
  rmSync(LEGACY_PATH, { force: true });
  console.log(JSON.stringify({ summary: SUMMARY_PATH, regions: REGION_DEFINITIONS.length, rows: rows.length }));
} finally {
  database?.close();
}
