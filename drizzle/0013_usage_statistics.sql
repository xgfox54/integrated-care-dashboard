-- 이용자 통계(관리자 「이용자 통계」). 원시 이벤트 로그 표는 만들지 않는다.
-- 일별 집계표(usage_daily_*)는 한국시간 날짜별 건수·합계만 담고 24개월 뒤 지운다.
-- 단기 처리 상태(usage_seen_event, usage_temp_*)는 중복 방지·전환 연결용 임시 ID만 담고 23시간 뒤 만료, 매시 정각 삭제한다.
-- 시각 칸(*_at)은 밀리초다.

CREATE TABLE IF NOT EXISTS `usage_daily_page` (
  `day` text NOT NULL,
  `page` text NOT NULL,
  `views` integer NOT NULL DEFAULT 0,
  PRIMARY KEY (`day`, `page`)
);

CREATE TABLE IF NOT EXISTS `usage_daily_screen` (
  `day` text NOT NULL,
  `screen` text NOT NULL,
  `views` integer NOT NULL DEFAULT 0,
  PRIMARY KEY (`day`, `screen`)
);

CREATE TABLE IF NOT EXISTS `usage_daily_tab` (
  `day` text NOT NULL,
  `tab` text NOT NULL,
  `initial_views` integer NOT NULL DEFAULT 0,
  `selected_views` integer NOT NULL DEFAULT 0,
  `active_ms` integer NOT NULL DEFAULT 0,
  `measures` integer NOT NULL DEFAULT 0,
  PRIMARY KEY (`day`, `tab`)
);

-- 통계용 고정 ID. 사업·제도의 원래 키(통합돌봄 WIKI 키, 복지제도 slug)가 바뀌어도 같은 사업이면 같은 ID를 쓴다.
CREATE TABLE IF NOT EXISTS `usage_entity` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `kind` text NOT NULL,
  `name` text NOT NULL,
  `sido` text NOT NULL DEFAULT '',
  `sigungu` text NOT NULL DEFAULT '',
  `category` text NOT NULL DEFAULT '',
  `status` text NOT NULL DEFAULT 'active',
  `first_seen_at` integer NOT NULL,
  `last_seen_at` integer NOT NULL
);
CREATE INDEX IF NOT EXISTS `usage_entity_kind_idx` ON `usage_entity` (`kind`, `status`);

CREATE TABLE IF NOT EXISTS `usage_entity_key` (
  `kind` text NOT NULL,
  `source_key` text NOT NULL,
  `entity_id` integer NOT NULL,
  `region_key` text NOT NULL DEFAULT '',
  `name_norm` text NOT NULL DEFAULT '',
  `service_norm` text NOT NULL DEFAULT '',
  `created_at` integer NOT NULL,
  PRIMARY KEY (`kind`, `source_key`)
);
CREATE INDEX IF NOT EXISTS `usage_entity_key_entity_idx` ON `usage_entity_key` (`entity_id`);
CREATE INDEX IF NOT EXISTS `usage_entity_key_name_idx` ON `usage_entity_key` (`kind`, `region_key`, `name_norm`);
CREATE INDEX IF NOT EXISTS `usage_entity_key_service_idx` ON `usage_entity_key` (`kind`, `region_key`, `service_norm`);

CREATE TABLE IF NOT EXISTS `usage_daily_entity` (
  `day` text NOT NULL,
  `entity_id` integer NOT NULL,
  `views` integer NOT NULL DEFAULT 0,
  `search_matches` integer NOT NULL DEFAULT 0,
  `search_opens` integer NOT NULL DEFAULT 0,
  `active_ms` integer NOT NULL DEFAULT 0,
  `active_views` integer NOT NULL DEFAULT 0,
  PRIMARY KEY (`day`, `entity_id`)
);
CREATE INDEX IF NOT EXISTS `usage_daily_entity_entity_idx` ON `usage_daily_entity` (`entity_id`, `day`);

CREATE TABLE IF NOT EXISTS `usage_daily_route` (
  `day` text NOT NULL,
  `kind` text NOT NULL,
  `route` text NOT NULL,
  `views` integer NOT NULL DEFAULT 0,
  PRIMARY KEY (`day`, `kind`, `route`)
);

CREATE TABLE IF NOT EXISTS `usage_daily_duration` (
  `day` text NOT NULL,
  `scope` text NOT NULL,
  `bucket` integer NOT NULL,
  `measures` integer NOT NULL DEFAULT 0,
  PRIMARY KEY (`day`, `scope`, `bucket`)
);

CREATE TABLE IF NOT EXISTS `usage_daily_search` (
  `day` text NOT NULL,
  `scope` text NOT NULL,
  `status` text NOT NULL,
  `results` text NOT NULL,
  `match` text NOT NULL,
  `searches` integer NOT NULL DEFAULT 0,
  `converted` integer NOT NULL DEFAULT 0,
  PRIMARY KEY (`day`, `scope`, `status`, `results`, `match`)
);

CREATE TABLE IF NOT EXISTS `usage_daily_filter` (
  `day` text NOT NULL,
  `filter` text NOT NULL,
  `code` text NOT NULL,
  `uses` integer NOT NULL DEFAULT 0,
  PRIMARY KEY (`day`, `filter`, `code`)
);

CREATE TABLE IF NOT EXISTS `usage_daily_action` (
  `day` text NOT NULL,
  `action` text NOT NULL,
  `outcome` text NOT NULL,
  `dest` text NOT NULL DEFAULT '',
  `count` integer NOT NULL DEFAULT 0,
  `ms_sum` integer NOT NULL DEFAULT 0,
  `ms_count` integer NOT NULL DEFAULT 0,
  PRIMARY KEY (`day`, `action`, `outcome`, `dest`)
);

CREATE TABLE IF NOT EXISTS `usage_daily_error` (
  `day` text NOT NULL,
  `op` text NOT NULL,
  `code` text NOT NULL,
  `count` integer NOT NULL DEFAULT 0,
  PRIMARY KEY (`day`, `op`, `code`)
);

CREATE TABLE IF NOT EXISTS `usage_daily_perf` (
  `day` text NOT NULL,
  `metric` text NOT NULL,
  `page` text NOT NULL DEFAULT '',
  `bucket` integer NOT NULL,
  `count` integer NOT NULL DEFAULT 0,
  `value_sum` integer NOT NULL DEFAULT 0,
  PRIMARY KEY (`day`, `metric`, `page`, `bucket`)
);

-- ---- 단기 처리 상태(최대 24시간) ----
CREATE TABLE IF NOT EXISTS `usage_seen_event` (
  `event_id` text PRIMARY KEY NOT NULL,
  `fp` text NOT NULL,
  `claim` text NOT NULL,
  `expires_at` integer NOT NULL
);
CREATE INDEX IF NOT EXISTS `usage_seen_event_expires_idx` ON `usage_seen_event` (`expires_at`);

CREATE TABLE IF NOT EXISTS `usage_temp_search` (
  `search_id` text PRIMARY KEY NOT NULL,
  `day` text NOT NULL,
  `scope` text NOT NULL DEFAULT '',
  `status` text NOT NULL DEFAULT '',
  `results` text NOT NULL DEFAULT '',
  `match` text NOT NULL DEFAULT '',
  `executed` integer NOT NULL DEFAULT 0,
  `converted` integer NOT NULL DEFAULT 0,
  `claim` text NOT NULL,
  `expires_at` integer NOT NULL
);
CREATE INDEX IF NOT EXISTS `usage_temp_search_expires_idx` ON `usage_temp_search` (`expires_at`);

CREATE TABLE IF NOT EXISTS `usage_temp_measure` (
  `measure_id` text PRIMARY KEY NOT NULL,
  `scope` text NOT NULL,
  `tab` text NOT NULL DEFAULT '',
  `entity_id` integer NOT NULL DEFAULT 0,
  `day_started` text NOT NULL,
  `last_ms` integer NOT NULL,
  `prev_ms` integer NOT NULL DEFAULT 0,
  `is_new` integer NOT NULL DEFAULT 1,
  `last_at` integer NOT NULL,
  `claim` text NOT NULL,
  `expires_at` integer NOT NULL
);
CREATE INDEX IF NOT EXISTS `usage_temp_measure_expires_idx` ON `usage_temp_measure` (`expires_at`);

CREATE TABLE IF NOT EXISTS `usage_temp_op` (
  `op_id` text PRIMARY KEY NOT NULL,
  `action` text NOT NULL,
  `state` text NOT NULL,
  `fresh` integer NOT NULL DEFAULT 1,
  `claim` text NOT NULL,
  `expires_at` integer NOT NULL
);
CREATE INDEX IF NOT EXISTS `usage_temp_op_expires_idx` ON `usage_temp_op` (`expires_at`);

-- 수집 켜기·끄기 기록(「수집 전」, 「수집 중지」, 0건을 구분하는 데 쓴다).
CREATE TABLE IF NOT EXISTS `usage_collection_period` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `started_at` integer NOT NULL,
  `ended_at` integer
);

