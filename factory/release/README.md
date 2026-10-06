# 문서 사실 공개 묶음 만들기 (로컬 전용)

HWP/HWPX 파싱 결과(`factory/hwp-parser`)에서 사람이 확인한 사실만 골라 `welfare-public-release-v2`(knowledge / document-facts-1) 묶음을 만든다.
만든 ZIP은 관리자 화면 `/admin/imports`에서 올리고, 서버 검사 → 관리자 승인(해시 확인) → 활성화를 거쳐야 공개된다.

1. 후보 뽑기: `node factory/release/candidates.mjs --parsed var/welfare-factory/parsed/<parse_id> --out var/welfare-factory/review/<이름>.candidates.json`
   - '지원대상: …' 같은 항목 문단과 '신청자격·제출서류' 절의 글머리 문단을 후보로 만든다. 모델·외부 호출 없음.
2. 검토 파일 만들기(`var/welfare-factory/review/<이름>.review.json`): 후보를 확인해 `review_status`를 `approved`/`rejected`로 정하고 주체와 원문 정보를 채운다.
   - `sources[]`: source_id(`doc:…`), source_version_id, raw_sha256, parse_id, source_kind(PUBLIC_NOTICE 등, 보도자료 불가), title, issuer, issuer_sido, issuer_sigungu, document_number, url(모르면 null), published_date(모르면 null), retrieved_at(원문을 받은 시각), rights_basis
   - `facts[]`: subject_id(`service:…` 대시보드 사업 또는 `docprog:…` 문서가 정의한 사업), subject_label, subject_sido, subject_sigungu, predicate_id, value_text, unit, scope_text, source_version_id, review_status, reviewed_at, evidence[{block_id, ir_pointer, table_id, cell, layout_page_start, quote(300자 이내)}]
3. 미리 보기(선택): 같은 명령에 `--dry-run`을 붙이면 파일을 쓰지 않고 서버 검사기 결과만 보여 준다(파싱·모델·외부 호출 없음).
4. 묶음 만들기: `node factory/release/build-pack.mjs --review <검토.json> --parsed-root var/welfare-factory/parsed --out <묶음.zip>` → ZIP과 `.sha256` 파일.

규칙: 원문 파일·raw IR·로컬 경로·검토 메모는 묶음에 넣지 않는다. 사실 ID와 내용 지문은 서버 검사기(`lib/imports/pack.ts`)와 같은 함수로 만든다.
같은 artifact_id로 다른 내용을 다시 올리면 서버가 거절하므로, 내용을 바꾸면 artifact_id도 바꾼다.
