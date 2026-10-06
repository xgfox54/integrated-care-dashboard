-- 5개 외부 데이터 연계(2026-10-05 운영자 지시): KOSIS, 장기요양기관 검색·상세, korean-law-mcp 법령, 법정동코드, 정부24 공공서비스.
-- 공통: 연계 목록(ext_dataset), 수집 실행(ext_run, lease·체크포인트), 범위 상태(ext_scope_state), 원천 레코드(ext_record, 해시로 중복 방지), 변경 이력(ext_record_change).
-- 부분 실패·빈 응답으로 기존 레코드를 지우지 않는다: 완전 수집에서 보이지 않은 레코드만 NOT_SEEN으로 표시하고 행은 남긴다.
CREATE TABLE ext_dataset (
  dataset_key TEXT PRIMARY KEY NOT NULL, provider TEXT NOT NULL, dataset_name TEXT NOT NULL, official_url TEXT NOT NULL, endpoint TEXT NOT NULL,
  access TEXT NOT NULL, terms TEXT NOT NULL, rate_limit TEXT NOT NULL, update_cycle TEXT NOT NULL, refresh_days INTEGER NOT NULL,
  personal_data TEXT NOT NULL, raw_retention TEXT NOT NULL, adapter_version TEXT NOT NULL, enabled INTEGER NOT NULL DEFAULT 1
);
--> statement-breakpoint
CREATE TABLE ext_run (
  run_id TEXT PRIMARY KEY NOT NULL, dataset_key TEXT NOT NULL, scope_key TEXT NOT NULL, trigger TEXT NOT NULL, status TEXT NOT NULL,
  started_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, finished_at INTEGER, cursor_json TEXT NOT NULL DEFAULT '{}',
  pages_done INTEGER NOT NULL DEFAULT 0, expected_total INTEGER, rows_received INTEGER NOT NULL DEFAULT 0, records_seen INTEGER NOT NULL DEFAULT 0,
  records_new INTEGER NOT NULL DEFAULT 0, records_changed INTEGER NOT NULL DEFAULT 0, attempts INTEGER NOT NULL DEFAULT 0, retry_at INTEGER,
  http_status INTEGER, result_code TEXT, message TEXT, query_basis TEXT, last_response_hash TEXT, adapter_version TEXT NOT NULL,
  lease_owner TEXT, lease_until INTEGER
);
--> statement-breakpoint
CREATE INDEX ext_run_scope_idx ON ext_run (dataset_key, scope_key, started_at);
--> statement-breakpoint
CREATE TABLE ext_scope_state (
  dataset_key TEXT NOT NULL, scope_key TEXT NOT NULL, last_status TEXT NOT NULL DEFAULT 'NOT_COLLECTED', last_message TEXT,
  last_attempt_at INTEGER, last_success_at INTEGER, last_success_run_id TEXT, next_due_at INTEGER NOT NULL DEFAULT 0, consecutive_failures INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (dataset_key, scope_key)
);
--> statement-breakpoint
CREATE TABLE ext_record (
  dataset_key TEXT NOT NULL, record_id TEXT NOT NULL, scope_key TEXT NOT NULL, record_hash TEXT NOT NULL, payload_json TEXT NOT NULL,
  official_url TEXT, data_as_of TEXT, source_updated_at TEXT, region_code_type TEXT, region_code TEXT,
  first_seen_at INTEGER NOT NULL, last_seen_at INTEGER NOT NULL, last_success_run_id TEXT NOT NULL,
  presence TEXT NOT NULL DEFAULT 'PRESENT', missing_runs INTEGER NOT NULL DEFAULT 0, validation_status TEXT NOT NULL DEFAULT 'UNVERIFIED', adapter_version TEXT NOT NULL,
  PRIMARY KEY (dataset_key, record_id)
);
--> statement-breakpoint
CREATE INDEX ext_record_scope_idx ON ext_record (dataset_key, scope_key);
--> statement-breakpoint
CREATE INDEX ext_record_region_idx ON ext_record (dataset_key, region_code);
--> statement-breakpoint
CREATE TABLE ext_record_change (
  change_id INTEGER PRIMARY KEY AUTOINCREMENT, dataset_key TEXT NOT NULL, record_id TEXT NOT NULL, run_id TEXT NOT NULL, kind TEXT NOT NULL,
  old_hash TEXT, new_hash TEXT, changed_fields TEXT, changed_at INTEGER NOT NULL
);
--> statement-breakpoint
CREATE INDEX ext_record_change_record_idx ON ext_record_change (dataset_key, record_id, changed_at);
--> statement-breakpoint
-- 행정코드: 체계(code_type)별로 따로 두고, 같은 코드라도 적용기간이 다르면 행을 나눈다.
CREATE TABLE region_code (
  code_type TEXT NOT NULL, code TEXT NOT NULL, valid_from TEXT NOT NULL DEFAULT '', valid_to TEXT, name TEXT NOT NULL, level TEXT NOT NULL,
  parent_code TEXT, validity_status TEXT NOT NULL, source_title TEXT NOT NULL, source_url TEXT NOT NULL, retrieved_at TEXT NOT NULL, note TEXT,
  PRIMARY KEY (code_type, code, valid_from)
);
--> statement-breakpoint
CREATE TABLE region_code_map (
  map_id TEXT PRIMARY KEY NOT NULL, from_type TEXT NOT NULL, from_code TEXT NOT NULL, to_type TEXT NOT NULL, to_code TEXT NOT NULL, relation TEXT NOT NULL,
  valid_from TEXT, valid_to TEXT, status TEXT NOT NULL, basis TEXT NOT NULL, basis_url TEXT, note TEXT, created_at INTEGER NOT NULL, reviewed_at INTEGER
);
--> statement-breakpoint
CREATE INDEX region_code_map_from_idx ON region_code_map (from_type, from_code);
--> statement-breakpoint
CREATE INDEX region_code_map_to_idx ON region_code_map (to_type, to_code);
--> statement-breakpoint
-- KOSIS: 통계표는 관리자가 메타데이터(항목·분류·단위·주기·지역 범위)를 확인해 VERIFIED로 바꾼 것만 수집한다.
CREATE TABLE kosis_table (
  org_id TEXT NOT NULL, tbl_id TEXT NOT NULL, tbl_name TEXT NOT NULL, purpose TEXT NOT NULL, status TEXT NOT NULL, note TEXT, source_url TEXT NOT NULL,
  query_json TEXT, item_label TEXT, unit TEXT, period_type TEXT, region_level TEXT, population_basis TEXT, meta_hash TEXT, meta_checked_at INTEGER, verified_at INTEGER,
  PRIMARY KEY (org_id, tbl_id)
);
--> statement-breakpoint
CREATE TABLE kosis_observation (
  org_id TEXT NOT NULL, tbl_id TEXT NOT NULL, itm_id TEXT NOT NULL, region_code TEXT NOT NULL, region_name TEXT, class2 TEXT NOT NULL DEFAULT '', class2_name TEXT,
  period TEXT NOT NULL, value TEXT, value_status TEXT NOT NULL, unit TEXT, source_changed_on TEXT, run_id TEXT NOT NULL, collected_at INTEGER NOT NULL,
  PRIMARY KEY (org_id, tbl_id, itm_id, region_code, class2, period)
);
--> statement-breakpoint
-- 장기요양기관: 기관(기관기호)과 서비스 유형(기관기호+기관유형코드)을 나눠 기관 수를 중복 집계하지 않는다. 기관기호는 원천 체계 그대로 둔다.
CREATE TABLE ltc_service_type (
  code TEXT PRIMARY KEY NOT NULL, name TEXT NOT NULL, service_group TEXT NOT NULL, code_pattern TEXT NOT NULL, source_title TEXT NOT NULL, source_url TEXT NOT NULL
);
--> statement-breakpoint
CREATE TABLE ltc_institution (
  admin_sym TEXT PRIMARY KEY NOT NULL, admin_nm TEXT NOT NULL, sido_cd TEXT, sgg_cd TEXT, sigungu_code TEXT, legal_dong_code TEXT, hdong_cd TEXT,
  post_no TEXT, detail_addr TEXT, tel TEXT, designated_on TEXT, registered_on TEXT, presence TEXT NOT NULL DEFAULT 'PRESENT',
  first_seen_at INTEGER NOT NULL, last_seen_at INTEGER NOT NULL, search_run_id TEXT NOT NULL, detail_status TEXT NOT NULL DEFAULT 'NOT_COLLECTED',
  detail_fetched_at INTEGER, detail_run_id TEXT
);
--> statement-breakpoint
CREATE INDEX ltc_institution_region_idx ON ltc_institution (sigungu_code);
--> statement-breakpoint
CREATE TABLE ltc_institution_service (
  admin_sym TEXT NOT NULL, admin_pttn_cd TEXT NOT NULL, presence TEXT NOT NULL DEFAULT 'PRESENT', first_seen_at INTEGER NOT NULL, last_seen_at INTEGER NOT NULL,
  PRIMARY KEY (admin_sym, admin_pttn_cd)
);
--> statement-breakpoint
CREATE TABLE ltc_partner (
  admin_sym TEXT NOT NULL, partner_name TEXT NOT NULL, agreement_from TEXT NOT NULL, agreement_to TEXT, presence TEXT NOT NULL DEFAULT 'PRESENT',
  first_seen_at INTEGER NOT NULL, last_seen_at INTEGER NOT NULL, run_id TEXT NOT NULL,
  PRIMARY KEY (admin_sym, partner_name, agreement_from)
);
--> statement-breakpoint
-- 정부24 공공서비스: 원천 서비스ID를 그대로 보존한다. 기존 사업과의 동일성은 program_ext_link 후보로만 둔다.
CREATE TABLE gov24_service (
  service_id TEXT PRIMARY KEY NOT NULL, name TEXT NOT NULL, org_name TEXT, org_code TEXT, org_type TEXT, user_type TEXT, field TEXT, support_type TEXT,
  purpose TEXT, target TEXT, criteria TEXT, benefit TEXT, apply_method TEXT, apply_deadline TEXT, required_documents TEXT, reception TEXT, contact TEXT,
  online_url TEXT, detail_url TEXT, laws TEXT, ordinances TEXT, admin_rules TEXT, registered_at TEXT, modified_at TEXT,
  presence TEXT NOT NULL DEFAULT 'PRESENT', first_seen_at INTEGER NOT NULL, last_seen_at INTEGER NOT NULL, list_run_id TEXT NOT NULL,
  detail_status TEXT NOT NULL DEFAULT 'NOT_COLLECTED', detail_modified_at TEXT, detail_fetched_at INTEGER,
  match_checked_hash TEXT, match_checked_at INTEGER
);
--> statement-breakpoint
-- 법령 참조: korean-law-mcp(조회·검증 계층)로 법제처(원천)에서 확인한 법령·조문 식별자와 시점. 조문 본문은 해시만 둔다.
CREATE TABLE law_import (
  import_id TEXT PRIMARY KEY NOT NULL, bundle_sha256 TEXT NOT NULL UNIQUE, package_version TEXT NOT NULL, server_name TEXT NOT NULL, collector_version TEXT NOT NULL,
  query_date TEXT NOT NULL, created_at TEXT NOT NULL, imported_at INTEGER NOT NULL, item_count INTEGER NOT NULL, blocked_count INTEGER NOT NULL, report_json TEXT NOT NULL
);
--> statement-breakpoint
CREATE TABLE law_reference (
  ref_id TEXT PRIMARY KEY NOT NULL, law_name TEXT NOT NULL, law_kind TEXT, law_id TEXT, law_mst TEXT, article TEXT, promulgated_on TEXT, effective_on TEXT,
  query_date TEXT NOT NULL, version_status TEXT NOT NULL, article_status TEXT NOT NULL, official_url TEXT NOT NULL, text_sha256 TEXT,
  upcoming_note TEXT, retrieved_via TEXT NOT NULL, retrieved_at TEXT NOT NULL, import_id TEXT NOT NULL
);
--> statement-breakpoint
-- 사업 연결(정부24 혜택·법령 근거): 자동 판정은 CANDIDATE까지만. 관리자가 VERIFIED로 바꾼 것만 공개 화면·MCP에 확정 관계로 나온다.
CREATE TABLE program_ext_link (
  link_id TEXT PRIMARY KEY NOT NULL, source_kind TEXT NOT NULL, source_id TEXT NOT NULL, target_kind TEXT NOT NULL, target_id TEXT NOT NULL, target_label TEXT,
  score REAL, evidence_json TEXT NOT NULL, status TEXT NOT NULL, conflict_json TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
  reviewed_at INTEGER, review_note TEXT, valid_from TEXT, valid_to TEXT
);
--> statement-breakpoint
CREATE UNIQUE INDEX program_ext_link_pair_idx ON program_ext_link (source_kind, source_id, target_kind, target_id);
--> statement-breakpoint
CREATE INDEX program_ext_link_target_idx ON program_ext_link (target_kind, target_id, status);
--> statement-breakpoint
INSERT INTO ext_dataset (dataset_key, provider, dataset_name, official_url, endpoint, access, terms, rate_limit, update_cycle, refresh_days, personal_data, raw_retention, adapter_version) VALUES ('mois.legal_dong', '행정안전부', '행정표준코드_법정동코드', 'https://www.data.go.kr/data/15077871/openapi.do', 'https://apis.data.go.kr/1741000/StanReginCd/getStanReginCdList', 'DATA_GO_KR_KEY', '이용허락범위 제한 없음, 무료, 자동승인', '개발계정 일 10,000건(활용사례 등록 시 증설 신청)', '실시간(원천 표기). 수집은 30일마다 전체 대조', '30', '없음(행정구역 코드·명칭)', '리(里) 단위를 뺀 명세 필드 원값만 보관', 'ext-adapter-1.0.0');
--> statement-breakpoint
INSERT INTO ext_dataset (dataset_key, provider, dataset_name, official_url, endpoint, access, terms, rate_limit, update_cycle, refresh_days, personal_data, raw_retention, adapter_version) VALUES ('nhis.ltc_search', '국민건강보험공단', '장기요양기관 검색 서비스', 'https://www.data.go.kr/data/15059029/openapi.do', 'https://apis.data.go.kr/B550928/searchLtcInsttService02/getLtcInsttSeachList02', 'DATA_GO_KR_KEY', '이용허락범위 제한 없음, 무료, 자동승인', '개발계정 일 10,000건', '실시간(원천 표기, 빈자리·이용 가능 여부 아님). 수집은 7일마다 시·도별 전체 대조', '7', '없음(기관 정보)', '명세 응답 필드 원값만 보관', 'ext-adapter-1.0.0');
--> statement-breakpoint
INSERT INTO ext_dataset (dataset_key, provider, dataset_name, official_url, endpoint, access, terms, rate_limit, update_cycle, refresh_days, personal_data, raw_retention, adapter_version) VALUES ('nhis.ltc_detail', '국민건강보험공단', '장기요양기관 시설별 상세조회 서비스', 'https://www.data.go.kr/data/15058856/openapi.do', 'https://apis.data.go.kr/B550928/getLtcInsttDetailInfoService02', 'DATA_GO_KR_KEY', '이용허락범위 제한 없음, 무료, 자동승인', '개발계정 일 10,000건, 초당 30tps(활용가이드)', '실시간(원천 표기). 기관마다 30일에 한 번 일반현황·협약기관 재조회', '30', '없음. 입소인원·인력현황은 빈자리로 오해될 수 있어 수집하지 않음', '일반현황·협약기관 필드 원값만 보관', 'ext-adapter-1.0.0');
--> statement-breakpoint
INSERT INTO ext_dataset (dataset_key, provider, dataset_name, official_url, endpoint, access, terms, rate_limit, update_cycle, refresh_days, personal_data, raw_retention, adapter_version) VALUES ('mois.gov24_list', '행정안전부', '대한민국 공공서비스(혜택) 정보 - 목록', 'https://www.data.go.kr/data/15113968/openapi.do', 'https://api.odcloud.kr/api/gov24/v3/serviceList', 'DATA_GO_KR_KEY', '이용허락범위 제한 없음, 무료, 자동승인', '개발계정 일 10,000건', '실시간(원천 표기). 1일마다 전체 목록 대조', '1', '없음(공공서비스 정보)', '명세 응답 필드 원값만 보관', 'ext-adapter-1.0.0');
--> statement-breakpoint
INSERT INTO ext_dataset (dataset_key, provider, dataset_name, official_url, endpoint, access, terms, rate_limit, update_cycle, refresh_days, personal_data, raw_retention, adapter_version) VALUES ('mois.gov24_detail', '행정안전부', '대한민국 공공서비스(혜택) 정보 - 상세', 'https://www.data.go.kr/data/15113968/openapi.do', 'https://api.odcloud.kr/api/gov24/v3/serviceDetail', 'DATA_GO_KR_KEY', '이용허락범위 제한 없음, 무료, 자동승인', '목록과 같은 키·한도 공유', '목록의 수정일시가 바뀐 서비스만 다시 조회', '1', '없음(공공서비스 정보)', '명세 응답 필드 원값만 보관', 'ext-adapter-1.0.0');
--> statement-breakpoint
INSERT INTO ext_dataset (dataset_key, provider, dataset_name, official_url, endpoint, access, terms, rate_limit, update_cycle, refresh_days, personal_data, raw_retention, adapter_version) VALUES ('kosis.stats', '통계청', 'KOSIS 국가통계 공유서비스(통계자료)', 'https://kosis.kr/openapi/index/index.jsp', 'https://kosis.kr/openapi/Param/statisticsParameterData.do', 'KOSIS_KEY', 'KOSIS 공유서비스 이용약관(출처 표시), 무료', '1회 조회 40,000셀 이하(초과 시 오류 31). 일 호출 한도는 인증키 발급 화면 기준으로 확인 필요', '통계표별 수록주기(월·년). 관리자가 확인한 통계표만 30일마다 최신 시점 조회', '30', '없음(공개 집계 통계)', '통계 수치와 분류·단위 원값만 보관', 'ext-adapter-1.0.0');
--> statement-breakpoint
INSERT INTO ext_dataset (dataset_key, provider, dataset_name, official_url, endpoint, access, terms, rate_limit, update_cycle, refresh_days, personal_data, raw_retention, adapter_version) VALUES ('moleg.law', '법제처', '국가법령정보 공동활용 OPEN API(korean-law-mcp 4.15.5 경유)', 'https://open.law.go.kr', 'https://www.law.go.kr/DRF', 'LOCAL_LAW_MCP', '법령 본문은 저작권법 제7조 비보호 저작물, 출처 법제처 표시. 인증값(OC)은 발급자 본인만 사용', '로컬 수집기 호출 예산(korean-law-mcp 실행 한도)', '로컬 수집기를 사람이 실행해 반입 묶음으로 올림(서버 자동 수집 없음)', '0', '없음(법령·조문)', '조문 원문은 저장하지 않고 해시·식별자·시행일만 보관', 'ext-adapter-1.0.0');
--> statement-breakpoint
INSERT INTO ltc_service_type (code, name, service_group, code_pattern, source_title, source_url) VALUES ('A01', '노인요양시설', 'RESIDENTIAL', 'EXACT', '국민건강보험공단 장기요양기관 시설정보 활용가이드 공통항목 기관유형코드 정의', 'https://www.data.go.kr/data/15058856/openapi.do');
--> statement-breakpoint
INSERT INTO ltc_service_type (code, name, service_group, code_pattern, source_title, source_url) VALUES ('A02', '노인전문요양시설', 'RESIDENTIAL', 'EXACT', '국민건강보험공단 장기요양기관 시설정보 활용가이드 공통항목 기관유형코드 정의', 'https://www.data.go.kr/data/15058856/openapi.do');
--> statement-breakpoint
INSERT INTO ltc_service_type (code, name, service_group, code_pattern, source_title, source_url) VALUES ('A03', '노인요양시설(개정법)', 'RESIDENTIAL', 'EXACT', '국민건강보험공단 장기요양기관 시설정보 활용가이드 공통항목 기관유형코드 정의', 'https://www.data.go.kr/data/15058856/openapi.do');
--> statement-breakpoint
INSERT INTO ltc_service_type (code, name, service_group, code_pattern, source_title, source_url) VALUES ('A04', '노인요양공동생활가정', 'RESIDENTIAL', 'EXACT', '국민건강보험공단 장기요양기관 시설정보 활용가이드 공통항목 기관유형코드 정의', 'https://www.data.go.kr/data/15058856/openapi.do');
--> statement-breakpoint
INSERT INTO ltc_service_type (code, name, service_group, code_pattern, source_title, source_url) VALUES ('A05', '노인요양시설(단기보호 전환)', 'RESIDENTIAL', 'EXACT', '국민건강보험공단 장기요양기관 시설정보 활용가이드 공통항목 기관유형코드 정의', 'https://www.data.go.kr/data/15058856/openapi.do');
--> statement-breakpoint
INSERT INTO ltc_service_type (code, name, service_group, code_pattern, source_title, source_url) VALUES ('AAA', '입소시설', 'RESIDENTIAL', 'EXACT', '국민건강보험공단 장기요양기관 시설정보 활용가이드 공통항목 기관유형코드 정의', 'https://www.data.go.kr/data/15058856/openapi.do');
--> statement-breakpoint
INSERT INTO ltc_service_type (code, name, service_group, code_pattern, source_title, source_url) VALUES ('B01', '재가노인복지시설 방문요양', 'HOME_VISIT_CARE', 'EXACT', '국민건강보험공단 장기요양기관 시설정보 활용가이드 공통항목 기관유형코드 정의', 'https://www.data.go.kr/data/15058856/openapi.do');
--> statement-breakpoint
INSERT INTO ltc_service_type (code, name, service_group, code_pattern, source_title, source_url) VALUES ('B02', '재가노인복지시설 방문목욕', 'HOME_VISIT_BATH', 'EXACT', '국민건강보험공단 장기요양기관 시설정보 활용가이드 공통항목 기관유형코드 정의', 'https://www.data.go.kr/data/15058856/openapi.do');
--> statement-breakpoint
INSERT INTO ltc_service_type (code, name, service_group, code_pattern, source_title, source_url) VALUES ('B03', '재가노인복지시설 주야간보호', 'DAY_NIGHT_CARE', 'EXACT', '국민건강보험공단 장기요양기관 시설정보 활용가이드 공통항목 기관유형코드 정의', 'https://www.data.go.kr/data/15058856/openapi.do');
--> statement-breakpoint
INSERT INTO ltc_service_type (code, name, service_group, code_pattern, source_title, source_url) VALUES ('B04', '재가노인복지시설 단기보호', 'SHORT_TERM_CARE', 'EXACT', '국민건강보험공단 장기요양기관 시설정보 활용가이드 공통항목 기관유형코드 정의', 'https://www.data.go.kr/data/15058856/openapi.do');
--> statement-breakpoint
INSERT INTO ltc_service_type (code, name, service_group, code_pattern, source_title, source_url) VALUES ('B05', '재가노인복지시설 방문간호', 'HOME_VISIT_NURSING', 'EXACT', '국민건강보험공단 장기요양기관 시설정보 활용가이드 공통항목 기관유형코드 정의', 'https://www.data.go.kr/data/15058856/openapi.do');
--> statement-breakpoint
INSERT INTO ltc_service_type (code, name, service_group, code_pattern, source_title, source_url) VALUES ('C01', '재가장기요양기관 방문요양', 'HOME_VISIT_CARE', 'EXACT', '국민건강보험공단 장기요양기관 시설정보 활용가이드 공통항목 기관유형코드 정의', 'https://www.data.go.kr/data/15058856/openapi.do');
--> statement-breakpoint
INSERT INTO ltc_service_type (code, name, service_group, code_pattern, source_title, source_url) VALUES ('C02', '재가장기요양기관 방문목욕', 'HOME_VISIT_BATH', 'EXACT', '국민건강보험공단 장기요양기관 시설정보 활용가이드 공통항목 기관유형코드 정의', 'https://www.data.go.kr/data/15058856/openapi.do');
--> statement-breakpoint
INSERT INTO ltc_service_type (code, name, service_group, code_pattern, source_title, source_url) VALUES ('C03', '재가장기요양기관 주야간보호', 'DAY_NIGHT_CARE', 'EXACT', '국민건강보험공단 장기요양기관 시설정보 활용가이드 공통항목 기관유형코드 정의', 'https://www.data.go.kr/data/15058856/openapi.do');
--> statement-breakpoint
INSERT INTO ltc_service_type (code, name, service_group, code_pattern, source_title, source_url) VALUES ('C04', '재가장기요양기관 단기보호', 'SHORT_TERM_CARE', 'EXACT', '국민건강보험공단 장기요양기관 시설정보 활용가이드 공통항목 기관유형코드 정의', 'https://www.data.go.kr/data/15058856/openapi.do');
--> statement-breakpoint
INSERT INTO ltc_service_type (code, name, service_group, code_pattern, source_title, source_url) VALUES ('C05', '재가장기요양기관 방문간호', 'HOME_VISIT_NURSING', 'EXACT', '국민건강보험공단 장기요양기관 시설정보 활용가이드 공통항목 기관유형코드 정의', 'https://www.data.go.kr/data/15058856/openapi.do');
--> statement-breakpoint
INSERT INTO ltc_service_type (code, name, service_group, code_pattern, source_title, source_url) VALUES ('C06', '재가장기요양기관 복지용구', 'WELFARE_EQUIPMENT', 'EXACT', '국민건강보험공단 장기요양기관 시설정보 활용가이드 공통항목 기관유형코드 정의', 'https://www.data.go.kr/data/15058856/openapi.do');
--> statement-breakpoint
INSERT INTO ltc_service_type (code, name, service_group, code_pattern, source_title, source_url) VALUES ('Z01', '기타', 'OTHER', 'EXACT', '국민건강보험공단 장기요양기관 시설정보 활용가이드 공통항목 기관유형코드 정의', 'https://www.data.go.kr/data/15058856/openapi.do');
--> statement-breakpoint
INSERT INTO ltc_service_type (code, name, service_group, code_pattern, source_title, source_url) VALUES ('S41', '치매전담형 노인요양공동생활가정', 'RESIDENTIAL', 'EXACT', '국민건강보험공단 장기요양기관 시설정보 활용가이드 공통항목 기관유형코드 정의', 'https://www.data.go.kr/data/15058856/openapi.do');
--> statement-breakpoint
INSERT INTO ltc_service_type (code, name, service_group, code_pattern, source_title, source_url) VALUES ('G31-G99', '치매전담실 가형 1~69실', 'RESIDENTIAL_DEMENTIA_UNIT', 'PREFIX:G', '국민건강보험공단 장기요양기관 시설정보 활용가이드 공통항목 기관유형코드 정의(G31~G99)', 'https://www.data.go.kr/data/15058856/openapi.do');
--> statement-breakpoint
INSERT INTO ltc_service_type (code, name, service_group, code_pattern, source_title, source_url) VALUES ('M31-M99', '치매전담실 나형 1~69실', 'RESIDENTIAL_DEMENTIA_UNIT', 'PREFIX:M', '국민건강보험공단 장기요양기관 시설정보 활용가이드 공통항목 기관유형코드 정의(M31~M99)', 'https://www.data.go.kr/data/15058856/openapi.do');
--> statement-breakpoint
INSERT INTO ltc_service_type (code, name, service_group, code_pattern, source_title, source_url) VALUES ('H31-H99', '주야간보호 내 치매전담 1~69실', 'DAY_NIGHT_DEMENTIA_UNIT', 'PREFIX:H', '국민건강보험공단 장기요양기관 시설정보 활용가이드 공통항목 기관유형코드 정의(H31~H99)', 'https://www.data.go.kr/data/15058856/openapi.do');
--> statement-breakpoint
INSERT INTO ltc_service_type (code, name, service_group, code_pattern, source_title, source_url) VALUES ('I31-I99', '주야간보호 내 치매전담 1~69실', 'DAY_NIGHT_DEMENTIA_UNIT', 'PREFIX:I', '국민건강보험공단 장기요양기관 시설정보 활용가이드 공통항목 기관유형코드 정의(I31~I99)', 'https://www.data.go.kr/data/15058856/openapi.do');
--> statement-breakpoint
INSERT INTO kosis_table (org_id, tbl_id, tbl_name, purpose, note, source_url, status) VALUES ('101', 'DT_1B04005N', '행정구역(읍면동)별/5세별 주민등록인구(2011년~)', 'ELDERLY_POPULATION', '행정안전부 주민등록인구(월). 65세 이상 인구는 5세 계급 합산이 필요해 항목·분류 확인 전 계산하지 않음', 'https://kosis.kr/statHtml/statHtml.do?orgId=101&tblId=DT_1B04005N', 'CANDIDATE');
--> statement-breakpoint
INSERT INTO kosis_table (org_id, tbl_id, tbl_name, purpose, note, source_url, status) VALUES ('101', 'DT_1PL1502', '성 및 연령별 1인가구 - 시군구', 'ELDERLY_SINGLE_HOUSEHOLD', '통계청 인구총조사(가구, 연 단위). 주민등록 세대와 모집단이 달라 합치지 않음', 'https://kosis.kr/statHtml/statHtml.do?orgId=101&tblId=DT_1PL1502', 'CANDIDATE');
--> statement-breakpoint
INSERT INTO kosis_table (org_id, tbl_id, tbl_name, purpose, note, source_url, status) VALUES ('350', 'DT_35006_N007', '시·군·구별 등급별 자격별 등급판정 현황(계)', 'LTC_CERTIFIED', '국민건강보험공단 노인장기요양보험통계(연 단위). 시·군·구 범위·시계열 실제 제공 여부 확인 전', 'https://kosis.kr/statHtml/statHtml.do?orgId=350&tblId=DT_35006_N007', 'CANDIDATE');
--> statement-breakpoint
INSERT INTO ext_scope_state (dataset_key, scope_key) VALUES ('moleg.law', 'local-bundle');
