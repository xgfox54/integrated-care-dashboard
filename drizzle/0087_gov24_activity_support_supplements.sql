-- 정부24 「장애인 활동지원(추가)」「(구비)」「(시비추가사업)」「(○○구 추가지원)」처럼 국비 장애인 활동지원에
-- 지방비로 덧붙인 추가지원 사업은 예산이 따로인 별도 사업이다(관리자 판정, 2026-10-09).
-- 아직 판정하지 않은 후보만 「다른 사업으로 제외」로 바꾼다. 사람이 확인·제외한 연결과 근거·충돌 기록은 그대로 둔다.
UPDATE program_ext_link
SET status = 'REJECTED',
    reviewed_at = CAST(strftime('%s', 'now') AS INTEGER),
    updated_at = CAST(strftime('%s', 'now') AS INTEGER),
    review_note = '관리자 일괄 판정(2026-10-09): 국비 장애인 활동지원에 지방비로 덧붙인 추가지원 사업은 예산이 따로인 별도 사업'
WHERE source_kind = 'GOV24'
  AND status = 'CANDIDATE'
  AND json_valid(evidence_json)
  AND json_extract(evidence_json, '$.gov24.name') LIKE '%활동지원%'
  AND (json_extract(evidence_json, '$.gov24.name') LIKE '%추가%'
    OR replace(json_extract(evidence_json, '$.gov24.name'), ' ', '') LIKE '%(구비)%'
    OR replace(json_extract(evidence_json, '$.gov24.name'), ' ', '') LIKE '%(시비)%'
    OR replace(json_extract(evidence_json, '$.gov24.name'), ' ', '') LIKE '%(도비)%'
    OR replace(json_extract(evidence_json, '$.gov24.name'), ' ', '') LIKE '%(군비)%')
  AND json_extract(evidence_json, '$.program.name') NOT LIKE '%추가%';
