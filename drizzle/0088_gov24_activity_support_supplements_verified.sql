-- 0087 후속: 같은 날(2026-10-09 오전) 「같은 사업으로 확인」된 대전광역시 「장애인 활동지원(추가)」↔ 대전 5개 구 「장애인활동지원」 연결도
-- 관리자 판정(국비 활동지원에 지방비로 덧붙인 추가지원 사업은 별도 사업)에 따라 제외로 정정한다. 근거·충돌 기록은 그대로 둔다.
UPDATE program_ext_link
SET status = 'REJECTED',
    reviewed_at = CAST(strftime('%s', 'now') AS INTEGER),
    updated_at = CAST(strftime('%s', 'now') AS INTEGER),
    review_note = '관리자 일괄 판정(2026-10-09) 정정: 「같은 사업」으로 확인됐던 지방비 추가지원 활동지원 연결을 별도 사업으로 제외'
WHERE source_kind = 'GOV24'
  AND status IN ('VERIFIED', 'REVIEW_REQUIRED')
  AND json_valid(evidence_json)
  AND json_extract(evidence_json, '$.gov24.name') LIKE '%활동지원%'
  AND (json_extract(evidence_json, '$.gov24.name') LIKE '%추가%'
    OR replace(json_extract(evidence_json, '$.gov24.name'), ' ', '') LIKE '%(구비)%'
    OR replace(json_extract(evidence_json, '$.gov24.name'), ' ', '') LIKE '%(시비)%'
    OR replace(json_extract(evidence_json, '$.gov24.name'), ' ', '') LIKE '%(도비)%'
    OR replace(json_extract(evidence_json, '$.gov24.name'), ' ', '') LIKE '%(군비)%')
  AND json_extract(evidence_json, '$.program.name') NOT LIKE '%추가%';
