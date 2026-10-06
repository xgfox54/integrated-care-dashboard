// 전국 행정기관 보도자료 registry(JSON/CSV)와 마이그레이션을 만든다(작업지시서 v5 §23.3·23.6·23.20).
//   node scripts/press/build-registry.mjs <마이그레이션 이름> [기준일 YYYY-MM-DD] [같은 날 개정 번호]
// 입력: 0021 기관 시드, metro-sources.mjs(시·도 수동 확인), docs/press/discovery/{homepages,boards}.json(시·군·구 자동 탐색).
// 기관마다 작업지시서의 다섯 상태 중 하나로 설명한다: endpoint_confirmed / shared_board / no_independent_board / access_blocked / unconfirmed.
// 자동 검증된 시·군·구 게시판은 ENDPOINT_VERIFIED로 등록하되 승인 대기(수집·공개 안 함)로 둔다.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";

import { organizations } from "./discover.mjs";
import { METRO_SOURCES } from "./metro-sources.mjs";

const name = process.argv[2];
const asOf = process.argv[3] ?? new Date().toISOString().slice(0, 10);
const revision = process.argv[4];
if (revision !== undefined && !/^\d{1,2}$/.test(revision)) throw new Error("개정 번호는 숫자여야 합니다.");
if (!name || !/^\d{4}_[a-z0-9_]+$/.test(name)) throw new Error("마이그레이션 이름(예: 0026_press_registry_survey)을 주세요.");
const migration = new URL("../../drizzle/" + name + ".sql", import.meta.url);
if (existsSync(migration)) throw new Error("이미 있는 마이그레이션은 덮어쓰지 않습니다: " + name);
const discovery = new URL("../../docs/press/discovery/", import.meta.url);
const homepages = JSON.parse(readFileSync(new URL("homepages.json", discovery), "utf8"));
const boards = JSON.parse(readFileSync(new URL("boards.json", discovery), "utf8"));
// 일반구 공용 게시판 확인 결과(scripts/press/general-districts.mjs). 없으면 일반구는 모두 확인 전으로 둔다.
const districtFile = new URL("general-districts-" + asOf + ".json", discovery);
const districts = existsSync(districtFile) ? JSON.parse(readFileSync(districtFile, "utf8")).results : {};
const VERSION = "registry-" + asOf + (revision ? "-r" + revision : "");
const quote = (value) => (value === null || value === undefined ? "NULL" : typeof value === "number" ? String(value) : "'" + String(value).replaceAll("'", "''") + "'");

const CATEGORY_LABEL = {
  endpoint_confirmed: "실제 endpoint 확인",
  shared_board: "공용 게시판",
  no_independent_board: "독립 게시판 없음",
  access_blocked: "접근 차단",
  unconfirmed: "미확인",
};

function metroSurvey(org) {
  if (org.id === "org:mohw") return { category: "endpoint_confirmed", detail: "ENDPOINT_VERIFIED", reason: "보건복지부 공식 보도자료 RSS(robots Allow) 확인", endpoint: "https://www.mohw.go.kr/rss/board.es?mid=a10503000000&bid=0027&info", homepage: "https://www.mohw.go.kr", method: "RSS" };
  const metro = METRO_SOURCES.find((source) => source.org === org.name);
  if (!metro) return null;
  const category = metro.verification === "ENDPOINT_VERIFIED" ? "endpoint_confirmed" : metro.verification === "BLOCKED_ROBOTS" ? "access_blocked" : "unconfirmed";
  return { category, detail: metro.verification, reason: metro.note, endpoint: metro.endpoint, homepage: metro.homepage, method: metro.method };
}

function childSurvey(org) {
  if (org.type === "GENERAL_DISTRICT") {
    const own = boards.boards[org.id];
    if (own?.status === "AUTO_VERIFIED") {
      return { category: "endpoint_confirmed", detail: own.status, reason: own.reason + " (구청 자체 보도자료 게시판)", endpoint: own.endpoint, homepage: own.homepage ?? null, method: "HTML", board: own };
    }
    const check = districts[org.id];
    if (check?.verdict === "SHARED_PARENT_BOARD") {
      return {
        category: "shared_board", detail: "SHARED_PARENT_BOARD",
        reason: "구청 누리집(" + check.district_homepage + ") 첫 화면·사이트맵에 구 자체 보도자료 게시판이 없고, 보도자료는 상위 시 게시판(확인됨)을 함께 씀",
        endpoint: check.parent_endpoint, homepage: check.district_homepage, method: null,
      };
    }
    if (check?.verdict) {
      const why = { OWN_BOARD_CANDIDATE: "구청 누리집에 자체 보도자료 메뉴가 있으나 게시판 검증 전", SHARED_PARENT_BOARD_UNCONFIRMED: "구 자체 게시판은 없으나 상위 시 게시판이 아직 미확인", DISTRICT_SITE_NOT_LINKED: "상위 시 첫 화면에서 구청 누리집 링크를 찾지 못함", DISTRICT_SITE_UNREACHABLE: "구청 누리집 접속 실패", DISTRICT_SITE_ROBOTS: "구청 누리집을 robots.txt가 막음", PARENT_UNREACHABLE: "상위 시 누리집 접속 실패" }[check.verdict] ?? check.verdict;
      return { category: check.verdict === "DISTRICT_SITE_ROBOTS" ? "access_blocked" : "unconfirmed", detail: check.verdict, reason: why, endpoint: null, homepage: check.district_homepage ?? null, method: null };
    }
    return {
      category: "unconfirmed", detail: org.lifecycle === "SEED_UNVERIFIED" ? "SEED_UNVERIFIED" : "SHARED_BOARD_UNCHECKED",
      reason: org.lifecycle === "SEED_UNVERIFIED" ? "작업지시서 첨부의 후보 일반구. 공식 행정구역 코드·누리집으로 아직 확인하지 않음" : "시청 누리집 아래 일반구. 시 게시판을 함께 쓰는지(공용 게시판) 확인 전",
      endpoint: null, homepage: null, method: null,
    };
  }
  const home = homepages.found[org.id];
  if (!home) return { category: "unconfirmed", detail: "HOMEPAGE_UNRESOLVED", reason: "공식 누리집 목록에서 찾지 못함", endpoint: null, homepage: null, method: null };
  const board = boards.boards[org.id];
  if (!board) return { category: "unconfirmed", detail: "NOT_SURVEYED", reason: "게시판 탐색 전", endpoint: null, homepage: home.homepage, method: null };
  const category = board.status === "AUTO_VERIFIED" ? "endpoint_confirmed" : board.status === "BLOCKED_ROBOTS" ? "access_blocked" : "unconfirmed";
  return { category, detail: board.status, reason: board.reason + (board.menu_text ? " (메뉴: " + board.menu_text + ")" : ""), endpoint: board.endpoint ?? null, homepage: board.homepage ?? home.homepage, method: board.status === "AUTO_VERIFIED" ? "HTML" : null, board };
}

const orgs = organizations();
const registry = orgs.map((org) => {
  const survey = metroSurvey(org) ?? childSurvey(org);
  return {
    organization_id: org.id, name: org.name, organization_type: org.type, sido: org.sido, sigungu: org.sigungu, parent_id: org.parent,
    lifecycle_status: org.lifecycle, seed_origin: org.origin,
    survey_category: survey.category, survey_category_label: CATEGORY_LABEL[survey.category], survey_detail: survey.detail, survey_reason: survey.reason,
    homepage_url: survey.homepage, endpoint_url: survey.endpoint, method: survey.method,
    homepage_source: homepages.found[org.id]?.source ?? null, homepage_confirmed_by_metro: Boolean(homepages.found[org.id]?.confirmed_by_metro),
    checked_at: survey.board?.checked_at ?? homepages.checked_at,
    _board: survey.board,
  };
});

const counts = registry.reduce((acc, row) => ({ ...acc, [row.survey_category]: (acc[row.survey_category] ?? 0) + 1 }), {});
const out = new URL("../../docs/press/registry/", import.meta.url);
mkdirSync(out, { recursive: true });
const publicRows = registry.map((row) => Object.fromEntries(Object.entries(row).filter(([key]) => key !== "_board")));
writeFileSync(new URL(VERSION + ".json", out), JSON.stringify({ registry_version: VERSION, generated_at: new Date().toISOString(), basis: "0021 기관 시드 + 행정안전부 지자체 누리집 목록 + 시·도 수동 확인 + 시·군·구 자동 탐색 + 스크립트 링크 게시판 개별 프로필(scripts/press/script-profiles.mjs)", counts, organizations: publicRows }, null, 2));
const columns = Object.keys(publicRows[0]);
const csvCell = (value) => {
  const text = value === null || value === undefined ? "" : String(value);
  const safe = /^[=+\-@\t\r]/.test(text) ? "'" + text : text;
  return /[",\n]/.test(safe) ? "\"" + safe.replaceAll("\"", "\"\"") + "\"" : safe;
};
writeFileSync(new URL(VERSION + ".csv", out), "\ufeff" + [columns.join(","), ...publicRows.map((row) => columns.map((column) => csvCell(row[column])).join(","))].join("\n") + "\n");

const lines = [
  "-- 자동 생성: scripts/press/build-registry.mjs " + name + " (" + VERSION + ")",
  "CREATE TABLE IF NOT EXISTS press_org_survey (organization_id text PRIMARY KEY NOT NULL, survey_category text NOT NULL, survey_detail text NOT NULL, survey_reason text NOT NULL, homepage_url text, endpoint_url text, checked_at text NOT NULL, registry_version text NOT NULL);",
  "--> statement-breakpoint",
];
for (const row of registry) {
  lines.push(
    "INSERT INTO press_org_survey (organization_id, survey_category, survey_detail, survey_reason, homepage_url, endpoint_url, checked_at, registry_version) VALUES (" +
      [row.organization_id, row.survey_category, row.survey_detail, row.survey_reason, row.homepage_url, row.endpoint_url, row.checked_at, VERSION].map(quote).join(", ") +
      ") ON CONFLICT(organization_id) DO UPDATE SET survey_category = excluded.survey_category, survey_detail = excluded.survey_detail, survey_reason = excluded.survey_reason, homepage_url = excluded.homepage_url, endpoint_url = excluded.endpoint_url, checked_at = excluded.checked_at, registry_version = excluded.registry_version;",
    "--> statement-breakpoint",
  );
  // 시드의 생애주기 판정이 바뀐 기관(예: 실재를 확인한 화성시 일반구)은 기관 표도 맞춘다.
  if (row.lifecycle_status) {
    lines.push(
      "UPDATE press_organization SET lifecycle_status = " + quote(row.lifecycle_status) + " WHERE organization_id = " + quote(row.organization_id) + " AND lifecycle_status <> " + quote(row.lifecycle_status) + ";",
      "--> statement-breakpoint",
    );
  }
}
let sources = 0;
for (const row of registry) {
  const board = row._board;
  if (row.survey_detail !== "AUTO_VERIFIED" || !board?.pattern) continue;
  const detailHost = new URL(board.pattern.profile.url).hostname;
  const sourceId = "src:" + detailHost + ":press";
  const verifiedAt = Math.floor(Date.parse(board.checked_at) / 1000);
  const values = [
    sourceId, row.organization_id, "HTML", "HTMLBoardAdapter", row.homepage_url, board.endpoint, JSON.stringify([detailHost]), "ENDPOINT_VERIFIED",
    "자동 탐색·검증(" + board.reason + "). 메뉴: " + board.menu_text, verifiedAt,
    "robots.txt 허용 확인. 개별 이용조건(공공누리 유형 등)은 운영자 확인 전이라 승인 대기 상태다.", JSON.stringify(board.pattern.profile), VERSION,
  ];
  lines.push(
    "INSERT INTO press_source (source_id, organization_id, method, adapter, homepage_url, endpoint_url, allowed_hosts, verification_status, verification_note, endpoint_verified_at, policy_basis, adapter_profile, registry_version) VALUES (" +
      values.map(quote).join(", ") +
      ") ON CONFLICT(source_id) DO UPDATE SET endpoint_url = excluded.endpoint_url, adapter_profile = excluded.adapter_profile, verification_note = excluded.verification_note, endpoint_verified_at = excluded.endpoint_verified_at, registry_version = excluded.registry_version;",
    "--> statement-breakpoint",
  );
  sources += 1;
}
// 앞선 registry에서 확인됐지만 이번 판정에서 확인이 풀린 게시판(예: 최근 1년 게시물이 없는 지난 자료 보관 게시판)은
// Source를 지우지 않고 확인 상태를 되돌려 수집을 멈춘다(자동 승인 대상에서도 빠짐). 기존 수집 자료는 그대로 둔다.
let withdrawn = 0;
for (const row of registry) {
  const board = row._board;
  if (row.survey_detail === "AUTO_VERIFIED" || !board?.pattern?.profile?.url) continue;
  const sourceId = "src:" + new URL(board.pattern.profile.url).hostname + ":press";
  lines.push(
    "UPDATE press_source SET verification_status = 'NEEDS_REVIEW', enabled = 0, verification_note = " + quote("registry " + VERSION + " 재판정: " + board.reason) +
      ", registry_version = " + quote(VERSION) + " WHERE source_id = " + quote(sourceId) + " AND verification_status = 'ENDPOINT_VERIFIED' AND robots_exempt = '';",
    "--> statement-breakpoint",
  );
  withdrawn += 1;
}
// 운영자 robots 예외 Source(robots_exempt 근거 있음, scripts/press/robots-exempt.mjs)는 되돌리지 않는다.
// robots.txt가 수집 경로를 막게 된 시·군·구(예: 도봉구 /bbs.asp)는 기존 Source를 BLOCKED_ROBOTS로 내리고 승인·수집을 끈다
// (시·도 Source는 build-metro-sources.mjs가 같은 규칙으로 처리한다). 기존 수집 자료는 지우지 않는다.
for (const row of registry) {
  if (row.survey_category !== "access_blocked" || row.organization_type === "METROPOLITAN" || row.organization_type === "CENTRAL") continue;
  lines.push(
    "UPDATE press_source SET verification_status = 'BLOCKED_ROBOTS', approval_status = 'PENDING_PERMISSION', enabled = 0, verification_note = " + quote("registry " + VERSION + " 재판정: " + row.survey_reason) +
      ", registry_version = " + quote(VERSION) + " WHERE organization_id = " + quote(row.organization_id) + " AND verification_status = 'ENDPOINT_VERIFIED' AND adapter <> 'OpenAPIAdapter' AND robots_exempt = '';",
    "--> statement-breakpoint",
  );
  withdrawn += 1;
}
lines.pop();
writeFileSync(migration, lines.join("\n") + "\n");
console.log(JSON.stringify({ organizations: registry.length, counts, new_sources: sources, rechecked_sources: withdrawn, migration: name }));
