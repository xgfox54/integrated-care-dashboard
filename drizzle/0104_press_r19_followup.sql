-- 0103 후속(2026-10-09 20:30). PC 중계 첫 수집 결과 반영.
-- 창녕군: 01552.web?gcode=1016이 /01541/01552.web?gcode=1016으로 302 이동한다. PC 수집기는 이동을 따라가지 않으므로 최종 주소로 바꾼다(원문 주소 틀은 기존 항목과 같게 유지).
UPDATE press_source SET endpoint_url = 'https://www.cng.go.kr/01541/01552.web?gcode=1016' WHERE source_id = 'src:www.cng.go.kr:press' AND endpoint_url = 'https://www.cng.go.kr/01552.web?gcode=1016';
--> statement-breakpoint
UPDATE press_crawl_state SET next_due_at = 0, consecutive_failures = 0, safe_error = '' WHERE source_id = 'src:www.cng.go.kr:press';
--> statement-breakpoint
-- 군산시 새올: https는 구형 TLS(1.0)만 받아 PC 수집기(TLS 1.2)와 최신 브라우저 모두 원문을 열 수 없다. 원문 링크가 깨지므로 수집을 멈추고 보류로 되돌린다.
UPDATE press_source SET approval_status = 'PENDING_PERMISSION', enabled = 0, verification_status = 'NEEDS_REVIEW', verification_note = '2026-10-09 보류: 새올 https가 구형 TLS 1.0만 지원해 PC 수집기와 최신 브라우저에서 원문이 열리지 않음. http만 응답.' WHERE source_id = 'src:eminwon.gunsan.go.kr:press';
--> statement-breakpoint
UPDATE press_org_survey SET survey_category = 'unconfirmed', survey_detail = 'TLS_LEGACY', survey_reason = '2026-10-09 운영자 지정 새올 주소 재시도: 목록·원문 판독은 되지만 https가 구형 TLS 1.0만 지원해 수집 PC와 최신 브라우저에서 원문이 열리지 않음(http만 응답). 보류.', checked_at = '2026-10-09T11:40:00.000Z' WHERE organization_id = 'org:전북특별자치도:군산시';

