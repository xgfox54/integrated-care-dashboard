-- Open API 첫 수집(2026-10-04)이 남긴 항목을 지우고 다시 받게 한다.
-- 1) 과천시는 같은 원문 주소를 게시판 Source가 이미 저장해 공개 목록에 두 번 나왔다(이제 collect.ts가 다른 Source가 가진 원문 주소는 새로 넣지 않음).
-- 2) 시간대 없는 날짜(2026-10-02 16:20:35.0)를 UTC로 읽어 게시일이 하루 밀렸다(이제 한국시간으로 읽음).
DELETE FROM press_text_fingerprint WHERE item_id IN (SELECT item_id FROM press_item WHERE source_id IN ('src:gwacheon:press-api', 'src:paju:press-api'));
--> statement-breakpoint
DELETE FROM press_item WHERE source_id IN ('src:gwacheon:press-api', 'src:paju:press-api');
--> statement-breakpoint
UPDATE press_crawl_state SET next_due_at = 0, latest_item_date = '', etag = '', last_modified = '' WHERE source_id IN ('src:gwacheon:press-api', 'src:paju:press-api');
