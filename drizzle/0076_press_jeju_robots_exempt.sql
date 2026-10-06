-- 제주특별자치도·서귀포시 보도자료 수집(2026-10-05 운영자 지시).
-- 두 곳 모두 공개 API가 없고 robots.txt가 목록 경로를 막는다. 운영자가 공개 행정정보로 보고 수집하도록 지시해, 이 Source에만 robots 예외 근거를 남긴다.
-- 승인은 배경 작업의 자동 승인(auto-approve.ts)이 robots_exempt 근거로 한다(마이그레이션에서 바로 켜지 않음).
-- 수집 범위는 다른 Source와 같다: 제목·게시일·원문 링크만, 하루 4회(09·12·15·18시 KST), 같은 서버 요청 간격 3초 이상, 본문 저장 없음.
ALTER TABLE press_source ADD COLUMN robots_exempt text DEFAULT '' NOT NULL;
--> statement-breakpoint
UPDATE press_source SET method = 'RSS', adapter = 'RSSAdapter', allowed_hosts = '["www.jeju.go.kr"]', verification_status = 'ENDPOINT_VERIFIED',
  verification_note = '보도자료 RSS 2.0(제목·링크·게시시각·담당부서) 정상 응답 확인(2026-10-05). robots.txt는 Disallow: / 이며 운영자 예외로 수집.',
  endpoint_verified_at = 1791205200, approval_status = 'PENDING_PERMISSION', enabled = 0,
  policy_basis = '운영자 지시(2026-10-05): 공식 RSS·API가 없거나 robots.txt가 막은 지자체 보도자료 목록을 공개 행정정보로 보고 수집. 제목·게시일·원문 링크만 하루 4회 수집하고 본문은 저장하지 않음.', robots_exempt = '운영자 지시(2026-10-05): 공식 RSS·API가 없거나 robots.txt가 막은 지자체 보도자료 목록을 공개 행정정보로 보고 수집. 제목·게시일·원문 링크만 하루 4회 수집하고 본문은 저장하지 않음.', technical_status = 'UNCHECKED', registry_version = 'registry-2026-10-05-jeju'
WHERE source_id = 'src:jeju:press';
--> statement-breakpoint
INSERT INTO press_source (source_id, organization_id, method, adapter, homepage_url, endpoint_url, allowed_hosts, verification_status, verification_note, endpoint_verified_at, approval_status, enabled, policy_basis, robots_exempt, adapter_profile, registry_version)
VALUES ('src:www.seogwipo.go.kr:press', 'org:제주특별자치도:서귀포시', 'HTML', 'HTMLBoardAdapter', 'https://www.seogwipo.go.kr/', 'https://www.seogwipo.go.kr/news/seogwiponews/sijungnews.htm', '["www.seogwipo.go.kr"]', 'ENDPOINT_VERIFIED',
  '시정뉴스 > 서귀포소식 > 보도자료 게시판. 목록 10건·제목·담당부서·게시일 확인(2026-10-05). robots.txt는 검색엔진 외 전체 Disallow이며 운영자 예외로 수집.', 1791205200, 'PENDING_PERMISSION', 0,
  '운영자 지시(2026-10-05): 공식 RSS·API가 없거나 robots.txt가 막은 지자체 보도자료 목록을 공개 행정정보로 보고 수집. 제목·게시일·원문 링크만 하루 4회 수집하고 본문은 저장하지 않음.', '운영자 지시(2026-10-05): 공식 RSS·API가 없거나 robots.txt가 막은 지자체 보도자료 목록을 공개 행정정보로 보고 수집. 제목·게시일·원문 링크만 하루 4회 수집하고 본문은 저장하지 않음.', '{"link":"sijungnews\\.htm\\?act=view&(?:amp;)?seq=(?<id>\\d+)","url":"https://www.seogwipo.go.kr/news/seogwiponews/sijungnews.htm?act=view&seq={id}","title":"^\\s*([^<\\s][^<]*?)\\s*$","date":"class=\"date\">[^<]*?(20\\d{2}-\\d{2}-\\d{2})","page":"https://www.seogwipo.go.kr/news/seogwiponews/sijungnews.htm?page={page}"}', 'registry-2026-10-05-jeju')
ON CONFLICT(source_id) DO UPDATE SET endpoint_url = excluded.endpoint_url, adapter_profile = excluded.adapter_profile, verification_status = excluded.verification_status, verification_note = excluded.verification_note,
  policy_basis = excluded.policy_basis, robots_exempt = excluded.robots_exempt, registry_version = excluded.registry_version;
--> statement-breakpoint
UPDATE press_org_survey SET survey_category = 'endpoint_confirmed', survey_detail = 'OPERATOR_ROBOTS_EXEMPT', survey_reason = '운영자 지시로 robots.txt 예외 수집(2026-10-05)', endpoint_url = 'https://www.seogwipo.go.kr/news/seogwiponews/sijungnews.htm'
WHERE organization_id = 'org:제주특별자치도:서귀포시';
--> statement-breakpoint
UPDATE press_org_survey SET survey_category = 'endpoint_confirmed', survey_detail = 'OPERATOR_ROBOTS_EXEMPT', survey_reason = '운영자 지시로 robots.txt 예외 수집(2026-10-05)'
WHERE organization_id = 'org:제주특별자치도';
