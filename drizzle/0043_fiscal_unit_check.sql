-- 금액 단위 공식 화면 대조 기록(작업지시서 v5 §22·T84). 지방재정365 「세부사업별 세출현황」 화면(LF3120202)의 원값과 공개 snapshot을 행·칸 단위로 대조한 결과.
-- 대조 기록이 있고 불일치가 없는 snapshot의 금액만 VERIFIED_OFFICIAL_SCREEN으로 표시하고, 나머지는 수집 때 값(UNVERIFIED_IN_SCOPE)을 그대로 쓴다.
CREATE TABLE `fiscal_unit_check` (
	`snapshot_id` text PRIMARY KEY NOT NULL,
	`reference_date` text NOT NULL,
	`official_source` text NOT NULL,
	`method` text NOT NULL,
	`rows_compared` integer NOT NULL,
	`field_checks` integer NOT NULL,
	`mismatches` integer NOT NULL,
	`only_api` integer NOT NULL,
	`only_official` integer NOT NULL,
	`display_unit` text NOT NULL,
	`checked_at` integer NOT NULL
);
--> statement-breakpoint
INSERT INTO `fiscal_unit_check` VALUES ('fs:5b2e337f-260a-4950-89a3-2c438be4dbd8', '2026-10-02', 'https://www.lofin365.go.kr/portal/LF3120202.do', '같은 기준일·사업명(통합돌봄)으로 16개 시·도 화면을 조회해 자치단체코드+세부사업코드별로 예산현액·국비·시도비·시군구비·기타·지출액 원값 대조, 화면 표시(백만원 반올림)도 확인. scripts/fiscal/unit-check.mjs', 579, 3474, 0, 0, 0, '백만원(화면 표시), 원(화면 내부 원값·OpenAPI)', 1791087600);
