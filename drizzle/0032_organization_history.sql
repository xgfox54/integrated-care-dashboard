-- 기관 통합·개칭·분구·관할변경 이력(작업지시서 v5 T143·T145). 이전 기관은 지우지 않고 ABOLISHED로 남기며 선후행 관계와 효력일·근거를 따로 둔다.
--> statement-breakpoint
-- 이미 수집된 보도자료의 발행기관(issued_by_org_id)은 바꾸지 않는다. 근거 조사: docs/press/registry/organization-successions-2026-10-04.json
--> statement-breakpoint
ALTER TABLE `press_organization` ADD `valid_from` text DEFAULT '' NOT NULL;
--> statement-breakpoint
ALTER TABLE `press_organization` ADD `valid_to` text DEFAULT '' NOT NULL;
--> statement-breakpoint
CREATE TABLE `organization_succession` (
	`succession_id` text PRIMARY KEY NOT NULL,
	`predecessor_id` text NOT NULL,
	`successor_id` text NOT NULL,
	`kind` text NOT NULL,
	`effective_date` text NOT NULL,
	`territory_note` text NOT NULL,
	`basis_title` text NOT NULL,
	`basis_url` text NOT NULL,
	`secondary_url` text,
	`verification_status` text NOT NULL,
	`verified_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `organization_succession_predecessor` ON `organization_succession` (`predecessor_id`);
--> statement-breakpoint
CREATE INDEX `organization_succession_successor` ON `organization_succession` (`successor_id`);
--> statement-breakpoint
INSERT OR IGNORE INTO `press_organization` (organization_id, name, org_type, sido, sigungu, parent_id, lifecycle_status, seed_origin, registry_version, valid_to) VALUES ('org:광주광역시', '광주광역시', 'METROPOLITAN', '광주광역시', '', NULL, 'ABOLISHED', 'succession_research_2026-10-04', 'registry-2026-10-04-history', '2026-06-30');
--> statement-breakpoint
INSERT OR IGNORE INTO `press_organization` (organization_id, name, org_type, sido, sigungu, parent_id, lifecycle_status, seed_origin, registry_version, valid_to) VALUES ('org:전라남도', '전라남도', 'METROPOLITAN', '전라남도', '', NULL, 'ABOLISHED', 'succession_research_2026-10-04', 'registry-2026-10-04-history', '2026-06-30');
--> statement-breakpoint
INSERT OR IGNORE INTO `press_organization` (organization_id, name, org_type, sido, sigungu, parent_id, lifecycle_status, seed_origin, registry_version, valid_to) VALUES ('org:인천광역시:중구', '중구', 'AUTONOMOUS_DISTRICT', '인천광역시', '중구', 'org:인천광역시', 'ABOLISHED', 'succession_research_2026-10-04', 'registry-2026-10-04-history', '2026-06-30');
--> statement-breakpoint
INSERT OR IGNORE INTO `press_organization` (organization_id, name, org_type, sido, sigungu, parent_id, lifecycle_status, seed_origin, registry_version, valid_to) VALUES ('org:인천광역시:동구', '동구', 'AUTONOMOUS_DISTRICT', '인천광역시', '동구', 'org:인천광역시', 'ABOLISHED', 'succession_research_2026-10-04', 'registry-2026-10-04-history', '2026-06-30');
--> statement-breakpoint
INSERT OR IGNORE INTO `press_organization` (organization_id, name, org_type, sido, sigungu, parent_id, lifecycle_status, seed_origin, registry_version, valid_to) VALUES ('org:인천광역시:서구', '서구', 'AUTONOMOUS_DISTRICT', '인천광역시', '서구', 'org:인천광역시', 'ABOLISHED', 'succession_research_2026-10-04', 'registry-2026-10-04-history', '2026-06-30');
--> statement-breakpoint
INSERT OR IGNORE INTO `press_organization` (organization_id, name, org_type, sido, sigungu, parent_id, lifecycle_status, seed_origin, registry_version, valid_to) VALUES ('org:경상북도:군위군', '군위군', 'BASIC_COUNTY', '경상북도', '군위군', 'org:경상북도', 'ABOLISHED', 'succession_research_2026-10-04', 'registry-2026-10-04-history', '2023-06-30');
--> statement-breakpoint
UPDATE `press_organization` SET `valid_from` = '2026-07-01' WHERE `organization_id` IN ('org:전남광주통합특별시', 'org:인천광역시:제물포구', 'org:인천광역시:영종구', 'org:인천광역시:검단구', 'org:인천광역시:서해구');
--> statement-breakpoint
UPDATE `press_organization` SET `valid_from` = '2023-07-01' WHERE `organization_id` = 'org:대구광역시:군위군';
--> statement-breakpoint
INSERT OR IGNORE INTO `organization_succession` (succession_id, predecessor_id, successor_id, kind, effective_date, territory_note, basis_title, basis_url, secondary_url, verification_status, verified_at) VALUES ('succ:2026-07-01:gwangju-merge', 'org:광주광역시', 'org:전남광주통합특별시', 'MERGE', '2026-07-01', '광주광역시 전역', '「전남광주통합특별시 설치를 위한 특별법」 시행', 'https://opinion.lawmaking.go.kr/gcom/ogLmPp/87004/myOpn', 'https://m.korea.kr/news/policyNewsView.do?newsId=148960435', 'OFFICIAL_SOURCE', '2026-10-04');
--> statement-breakpoint
INSERT OR IGNORE INTO `organization_succession` (succession_id, predecessor_id, successor_id, kind, effective_date, territory_note, basis_title, basis_url, secondary_url, verification_status, verified_at) VALUES ('succ:2026-07-01:jeonnam-merge', 'org:전라남도', 'org:전남광주통합특별시', 'MERGE', '2026-07-01', '전라남도 전역', '「전남광주통합특별시 설치를 위한 특별법」 시행', 'https://opinion.lawmaking.go.kr/gcom/ogLmPp/87004/myOpn', 'https://m.korea.kr/news/policyNewsView.do?newsId=148960435', 'OFFICIAL_SOURCE', '2026-10-04');
--> statement-breakpoint
INSERT OR IGNORE INTO `organization_succession` (succession_id, predecessor_id, successor_id, kind, effective_date, territory_note, basis_title, basis_url, secondary_url, verification_status, verified_at) VALUES ('succ:2026-07-01:incheon-junggu-jemulpo', 'org:인천광역시:중구', 'org:인천광역시:제물포구', 'SPLIT', '2026-07-01', '중구 원도심(영종·용유 제외)', '인천광역시 행정체제 개편 법률 시행', 'https://www.law.go.kr/LSW/lsInfoP.do?ancNo=20161', 'https://www.incheon.go.kr/IC010205/view?repDt=2026-06-08&repSeq=DOM_0000000014871020', 'OFFICIAL_SOURCE', '2026-10-04');
--> statement-breakpoint
INSERT OR IGNORE INTO `organization_succession` (succession_id, predecessor_id, successor_id, kind, effective_date, territory_note, basis_title, basis_url, secondary_url, verification_status, verified_at) VALUES ('succ:2026-07-01:incheon-donggu-jemulpo', 'org:인천광역시:동구', 'org:인천광역시:제물포구', 'MERGE', '2026-07-01', '동구 전역', '인천광역시 행정체제 개편 법률 시행', 'https://www.law.go.kr/LSW/lsInfoP.do?ancNo=20161', 'https://www.incheon.go.kr/IC010205/view?repDt=2026-06-08&repSeq=DOM_0000000014871020', 'OFFICIAL_SOURCE', '2026-10-04');
--> statement-breakpoint
INSERT OR IGNORE INTO `organization_succession` (succession_id, predecessor_id, successor_id, kind, effective_date, territory_note, basis_title, basis_url, secondary_url, verification_status, verified_at) VALUES ('succ:2026-07-01:incheon-junggu-yeongjong', 'org:인천광역시:중구', 'org:인천광역시:영종구', 'SPLIT', '2026-07-01', '중구 영종·용유 지역', '인천광역시 행정체제 개편 법률 시행', 'https://www.law.go.kr/LSW/lsInfoP.do?ancNo=20161', 'https://www.incheon.go.kr/IC010205/view?repDt=2026-06-08&repSeq=DOM_0000000014871020', 'OFFICIAL_SOURCE', '2026-10-04');
--> statement-breakpoint
INSERT OR IGNORE INTO `organization_succession` (succession_id, predecessor_id, successor_id, kind, effective_date, territory_note, basis_title, basis_url, secondary_url, verification_status, verified_at) VALUES ('succ:2026-07-01:incheon-seogu-geomdan', 'org:인천광역시:서구', 'org:인천광역시:검단구', 'SPLIT', '2026-07-01', '서구 검단 지역', '인천광역시 행정체제 개편 법률 시행', 'https://www.law.go.kr/LSW/lsInfoP.do?ancNo=20161', 'https://www.incheon.go.kr/IC010205/view?repDt=2026-06-08&repSeq=DOM_0000000014871020', 'OFFICIAL_SOURCE', '2026-10-04');
--> statement-breakpoint
INSERT OR IGNORE INTO `organization_succession` (succession_id, predecessor_id, successor_id, kind, effective_date, territory_note, basis_title, basis_url, secondary_url, verification_status, verified_at) VALUES ('succ:2026-07-01:incheon-seogu-seohae', 'org:인천광역시:서구', 'org:인천광역시:서해구', 'SPLIT', '2026-07-01', '검단 분리 후 나머지 서구 지역. 개편 법률 공포 때 명칭은 서구였고 이후 별도 법률로 서해구로 개칭', '인천광역시 행정체제 개편 법률 시행 및 명칭 변경', 'https://www.law.go.kr/LSW/lsInfoP.do?ancNo=20161', 'https://www.yna.co.kr/view/AKR20260507123500530', 'OFFICIAL_LAW_AND_PRESS', '2026-10-04');
--> statement-breakpoint
INSERT OR IGNORE INTO `organization_succession` (succession_id, predecessor_id, successor_id, kind, effective_date, territory_note, basis_title, basis_url, secondary_url, verification_status, verified_at) VALUES ('succ:2023-07-01:gunwi-transfer', 'org:경상북도:군위군', 'org:대구광역시:군위군', 'TRANSFER', '2023-07-01', '군위군 전역(경상북도 → 대구광역시 관할 변경)', '「경상북도와 대구광역시 간 관할구역 변경에 관한 법률」(법률 제19155호) 시행', 'https://www.moleg.go.kr/lawinfo/nwLwAnInfo.mo?cs_seq=443532&currentPage=6&keyField=&keyWord=&mid=a&pageCnt=50&sort=date', NULL, 'OFFICIAL_SOURCE', '2026-10-04');
