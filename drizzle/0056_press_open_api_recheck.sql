-- Open API 수집처는 robots.txt가 아니라 활용신청 승인·이용약관으로 자동 승인한다(lib/press/auto-approve.ts).
-- 배포 직후 robots.txt로 판정해 UNREADABLE로 남은 기록을 지워 다음 배경 작업에서 바로 다시 보게 한다.
DELETE FROM press_auto_approval WHERE source_id IN ('src:seoul:press-api', 'src:gwacheon:press-api', 'src:paju:press-api') AND approved_at IS NULL;
