-- 기존 연결의 판정 출처 분류(D-03 데이터 단계, 재실행해도 결과 같음). 상태·공개 여부·근거·검토 시각은 바꾸지 않고 출처 표시만 채운다.
-- auto_rule: 자동 규칙(applyLinkRules)이 상태·검토 시각·근거(auto_review.at)를 한 번에 썼고, 그 뒤 검토 시각이 바뀌지 않은 연결.
--   사람 검토(reviewLink)는 근거를 고치지 않고 검토 시각만 바꾸므로, auto_review.at과 reviewed_at이 같으면 마지막 판정은 자동 규칙이다.
-- legacy_unknown: 그 밖의 확인·제외 연결. reviewed_at·auto_review.previous_status만으로는 판정 주체를 증명할 수 없어 자동 작업이 바꾸지 않게 보호한다.
-- 후보(CANDIDATE)는 아직 판정이 없으므로 빈 값으로 둔다.
UPDATE cross_domain_link SET decision_origin = 'auto_rule', decision_rule = COALESCE(json_extract(evidence_json, '$.auto_review.rule_version'), '')
WHERE decision_origin = '' AND relation = 'fiscalProjectFor' AND verification_status IN ('VERIFIED', 'REJECTED') AND json_valid(evidence_json)
  AND json_extract(evidence_json, '$.auto_review.at') IS NOT NULL AND reviewed_at IS NOT NULL AND json_extract(evidence_json, '$.auto_review.at') = reviewed_at;
--> statement-breakpoint
UPDATE cross_domain_link SET decision_origin = 'legacy_unknown'
WHERE decision_origin = '' AND verification_status IN ('VERIFIED', 'REJECTED');
