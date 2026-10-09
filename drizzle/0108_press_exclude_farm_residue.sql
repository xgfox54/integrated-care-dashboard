-- 운영자 지시(2026-10-09): '영농부산물' 보도자료는 쓰레기 불법소각 방지 안내라 복지뉴스에서 뺀다. 관리자 삭제와 같은 방식(press_item_block)이라 다시 수집돼도 공개되지 않고 관리자 화면에서 되돌릴 수 있다.
INSERT INTO press_item_block (canonical_url, reason, blocked_at, previous_status) SELECT canonical_url, '운영자 지시: 영농부산물(불법소각 방지) 보도자료 수집 제외', 1791550800, MIN(public_status) FROM press_item WHERE title LIKE '%영농부산물%' AND public_status <> 'WITHDRAWN' GROUP BY canonical_url ON CONFLICT(canonical_url) DO NOTHING;
--> statement-breakpoint
UPDATE press_item SET public_status = 'WITHDRAWN' WHERE title LIKE '%영농부산물%';
