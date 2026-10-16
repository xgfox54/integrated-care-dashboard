-- 검색 전문 인덱스: 0113의 정규화 검색어에 trigram FTS를 붙여, 3글자 이상 검색어가 있으면 사업·정부24 전체 행을 훑지 않고 후보만 읽는다.
-- 인덱스는 후보를 좁히기만 하고 최종 일치 판정은 기존 instr 조건이 그대로 한다(결과 불변).
-- 기존 행은 배경 작업이 rowid 구간별로 채운다(search_fts_state). 다 채우기 전에는 검색이 인덱스를 쓰지 않는다.
CREATE VIRTUAL TABLE official_service_search_fts USING fts5(name_c, description_c, target_c, provider_c, subcategory_c, tokenize='trigram');
--> statement-breakpoint
CREATE VIRTUAL TABLE gov24_search_fts USING fts5(content_c, tokenize='trigram');
--> statement-breakpoint
CREATE TABLE search_fts_state (
  name TEXT PRIMARY KEY NOT NULL,
  backfill_limit INTEGER NOT NULL,
  next_rowid INTEGER NOT NULL,
  completed_at INTEGER
);
--> statement-breakpoint
INSERT INTO search_fts_state (name, backfill_limit, next_rowid, completed_at)
  SELECT 'official_service_search', COALESCE(MAX(rowid), 0), 0, CASE WHEN MAX(rowid) IS NULL THEN CAST(strftime('%s', 'now') AS INTEGER) END FROM official_service_search;
--> statement-breakpoint
INSERT INTO search_fts_state (name, backfill_limit, next_rowid, completed_at)
  SELECT 'gov24_search', COALESCE(MAX(rowid), 0), 0, CASE WHEN MAX(rowid) IS NULL THEN CAST(strftime('%s', 'now') AS INTEGER) END FROM gov24_search;
--> statement-breakpoint
CREATE TRIGGER official_service_search_fts_ai AFTER INSERT ON official_service_search BEGIN
  DELETE FROM official_service_search_fts WHERE rowid = NEW.rowid;
  INSERT INTO official_service_search_fts (rowid, name_c, description_c, target_c, provider_c, subcategory_c) VALUES (NEW.rowid, NEW.name_c, NEW.description_c, NEW.target_c, NEW.provider_c, NEW.subcategory_c);
END;
--> statement-breakpoint
CREATE TRIGGER official_service_search_fts_au AFTER UPDATE ON official_service_search BEGIN
  DELETE FROM official_service_search_fts WHERE rowid = OLD.rowid;
  INSERT INTO official_service_search_fts (rowid, name_c, description_c, target_c, provider_c, subcategory_c) VALUES (NEW.rowid, NEW.name_c, NEW.description_c, NEW.target_c, NEW.provider_c, NEW.subcategory_c);
END;
--> statement-breakpoint
CREATE TRIGGER official_service_search_fts_ad AFTER DELETE ON official_service_search BEGIN
  DELETE FROM official_service_search_fts WHERE rowid = OLD.rowid;
END;
--> statement-breakpoint
CREATE TRIGGER gov24_search_fts_ai AFTER INSERT ON gov24_search BEGIN
  DELETE FROM gov24_search_fts WHERE rowid = NEW.rowid;
  INSERT INTO gov24_search_fts (rowid, content_c) VALUES (NEW.rowid, NEW.content_c);
END;
--> statement-breakpoint
CREATE TRIGGER gov24_search_fts_au AFTER UPDATE ON gov24_search BEGIN
  DELETE FROM gov24_search_fts WHERE rowid = OLD.rowid;
  INSERT INTO gov24_search_fts (rowid, content_c) VALUES (NEW.rowid, NEW.content_c);
END;
--> statement-breakpoint
CREATE TRIGGER gov24_search_fts_ad AFTER DELETE ON gov24_search BEGIN
  DELETE FROM gov24_search_fts WHERE rowid = OLD.rowid;
END;
