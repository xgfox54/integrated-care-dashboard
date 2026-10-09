-- 관리자 보도자료 삭제 되돌리기(2026-10-09): 삭제 전 공개 상태를 남긴다. 기존 차단 기록은 값이 없어 되돌리면 공개로 돌아간다.
ALTER TABLE press_item_block ADD COLUMN previous_status text;
