// 검색 가속 마이그레이션 생성기. 요청마다 계산하던 구분기호 제거·소문자 정규화(compactSearchSql)를
// 삽입·수정 시점에 한 번만 계산해 검색용 표에 저장한다. 식은 코드의 compactSearchSql로 만들어 검색 결과가 바뀌지 않게 한다.
// 실행: node scripts/search-index/build-migration.mjs  → drizzle/0113_search_acceleration.sql
import { writeFileSync } from "node:fs";
import { compactSearchSql } from "../../lib/mcp/search-text.ts";

export const PROGRAM_FIELDS = ["name", "description", "target", "provider", "subcategory"];
export const GOV24_CONTENT = (row) => row + "name || ' ' || COALESCE(" + row + "purpose,'') || ' ' || COALESCE(" + row + "target,'') || ' ' || COALESCE(" + row + "criteria,'') || ' ' || COALESCE(" + row + "benefit,'')";
const c = compactSearchSql;
const programValues = (row) => [row + "id", row + "sync_run_id", ...PROGRAM_FIELDS.map((field) => c(row + field))].join(", ");
const gov24Values = (row) => [row + "service_id", c(row + "name"), c(GOV24_CONTENT(row))].join(", ");
const statements = [
  "-- 검색 가속: 사업 스냅샷과 정부24 서비스의 정규화 검색어를 미리 저장한다(생성: scripts/search-index/build-migration.mjs).",
  "CREATE TABLE official_service_search (\n  snapshot_id TEXT PRIMARY KEY NOT NULL,\n  run_id TEXT NOT NULL,\n  " + PROGRAM_FIELDS.map((field) => field + "_c TEXT NOT NULL").join(",\n  ") + "\n);",
  "CREATE INDEX official_service_search_run_idx ON official_service_search (run_id);",
  "CREATE TRIGGER official_service_search_ai AFTER INSERT ON official_service_snapshot BEGIN\n  INSERT OR REPLACE INTO official_service_search VALUES (" + programValues("NEW.") + ");\nEND;",
  "CREATE TRIGGER official_service_search_au AFTER UPDATE OF id, sync_run_id, " + PROGRAM_FIELDS.join(", ") + " ON official_service_snapshot BEGIN\n  DELETE FROM official_service_search WHERE snapshot_id = OLD.id;\n  INSERT OR REPLACE INTO official_service_search VALUES (" + programValues("NEW.") + ");\nEND;",
  "CREATE TRIGGER official_service_search_ad AFTER DELETE ON official_service_snapshot BEGIN\n  DELETE FROM official_service_search WHERE snapshot_id = OLD.id;\nEND;",
  // 공개본이 고정하는 최근 수집분만 미리 채운다. 빠진 행은 검색 시 원래 식으로 계산하므로 결과는 같다.
  "INSERT OR REPLACE INTO official_service_search SELECT " + programValues("") + " FROM official_service_snapshot WHERE sync_run_id IN (SELECT id FROM official_sync_run WHERE status = 'succeeded' ORDER BY completed_at DESC LIMIT 2);",
  "CREATE TABLE gov24_search (\n  service_id TEXT PRIMARY KEY NOT NULL,\n  name_c TEXT NOT NULL,\n  content_c TEXT NOT NULL\n);",
  "CREATE TRIGGER gov24_search_ai AFTER INSERT ON gov24_service BEGIN\n  INSERT OR REPLACE INTO gov24_search VALUES (" + gov24Values("NEW.") + ");\nEND;",
  "CREATE TRIGGER gov24_search_au AFTER UPDATE OF service_id, name, purpose, target, criteria, benefit ON gov24_service BEGIN\n  DELETE FROM gov24_search WHERE service_id = OLD.service_id;\n  INSERT OR REPLACE INTO gov24_search VALUES (" + gov24Values("NEW.") + ");\nEND;",
  "CREATE TRIGGER gov24_search_ad AFTER DELETE ON gov24_service BEGIN\n  DELETE FROM gov24_search WHERE service_id = OLD.service_id;\nEND;",
  "INSERT OR REPLACE INTO gov24_search SELECT " + gov24Values("") + " FROM gov24_service;",
];
writeFileSync(new URL("../../drizzle/0113_search_acceleration.sql", import.meta.url), statements[0] + "\n" + statements.slice(1).join("\n--> statement-breakpoint\n") + "\n", "utf8");
console.log("statements", statements.length - 1);

