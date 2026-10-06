// robots.txt 예외 수집처 탐색·등록(운영자 지시 2026-10-06). 로컬에서만 실행한다.
//   node scripts/press/robots-exempt.mjs <마이그레이션 이름> [기준일 YYYY-MM-DD]
// 근거: 행정안전부 「전자정부 웹사이트 품질관리 가이드」(2025.6.30. 기준) 웹 개방성 진단 '검색 로봇 접근'
// ("웹사이트는 로봇 배제 표준에 따른 검색 로봇 접근을 허용해야 함", 완전차단 0점)과 운영자 지시.
// robots.txt가 막아 게시판을 찾지 못한 시·군·구(boards.json의 BLOCKED_ROBOTS)와 robots 차단 시·도 Source를 다시 본다.
// 요청 예절은 discover.mjs와 같다(호스트마다 1.5초 간격·기관마다 요청 8개). 수집 범위는 다른 Source와 같다(제목·게시일·링크, 본문 저장 없음).
// 자동 검증된 게시판만 ENDPOINT_VERIFIED + robots_exempt 근거로 등록하고 승인 대기로 둔다(배경 작업의 자동 승인이 근거로 승인한다).
import { existsSync, readFileSync, writeFileSync } from "node:fs";

import { discoverBoard, organizations, politeFetch, setIgnoreRobots, verifyBoard } from "./discover.mjs";
import { METRO_SOURCES } from "./metro-sources.mjs";

const name = process.argv[2];
const asOf = process.argv[3] ?? new Date().toISOString().slice(0, 10);
if (!name || !/^\d{4}_[a-z0-9_]+$/.test(name)) throw new Error("마이그레이션 이름(예: 0077_press_robots_exempt)을 주세요.");
const migration = new URL("../../drizzle/" + name + ".sql", import.meta.url);
if (existsSync(migration)) throw new Error("이미 있는 마이그레이션은 덮어쓰지 않습니다: " + name);
const discovery = new URL("../../docs/press/discovery/", import.meta.url);
const homepages = JSON.parse(readFileSync(new URL("homepages.json", discovery), "utf8")).found;
const boards = JSON.parse(readFileSync(new URL("boards.json", discovery), "utf8")).boards;
const VERSION = "registry-" + asOf + "-robots-exempt";
export const ROBOTS_EXEMPT_BASIS =
  "운영자 지시(2026-10-06)와 행정안전부 「전자정부 웹사이트 품질관리 가이드」(2025.6.30. 기준) 웹 개방성 진단 '검색 로봇 접근'(웹사이트는 로봇 배제 표준에 따른 검색 로봇 접근을 허용해야 함)에 따라 " +
  "robots.txt 예외로 공개 보도자료 목록의 제목·게시일·원문 링크만 하루 4회 수집한다. 본문은 저장하지 않는다.";
const quote = (value) => (value === null || value === undefined ? "NULL" : typeof value === "number" ? String(value) : "'" + String(value).replaceAll("'", "''") + "'");

// 자동 검증은 됐지만 목록을 사람이 다시 보니 보도자료 게시판이 아닌 곳(2026-10-06 확인). 등록하지 않고 검토 대상으로 남긴다.
const MANUAL_REJECT = {
  "org:경기도:남양주시": "자동 검증된 링크 묶음이 보도자료가 아니라 행정복지센터 메뉴 목록임(사람 확인)",
  "org:경상남도:산청군": "보도자료 게시판이 아니라 산하 시설 프로그램 안내로 보임(최근 글 2026-06, 사람 확인)",
};
// 0076에서 수동 프로필로 등록한 Source는 자동 탐색 결과로 덮어쓰지 않는다(서귀포시 자동 탐색은 읍면동소식 묶음을 잡음).
const KEEP_MANUAL = new Set(["org:제주특별자치도:서귀포시"]);

setIgnoreRobots(true);
const orgs = organizations();
const targets = [
  ...orgs.filter((org) => boards[org.id]?.status === "BLOCKED_ROBOTS" && homepages[org.id]).map((org) => ({ org, kind: "child" })),
  ...METRO_SOURCES.filter((source) => source.verification === "BLOCKED_ROBOTS" && source.key !== "jeju").map((source) => ({ org: orgs.find((org) => org.name === source.org && org.type === "METROPOLITAN"), kind: "metro", metro: source })),
].filter((target) => target.org);

// --from-json: 같은 기준일에 이미 탐색한 결과 파일로 마이그레이션만 다시 만든다(기관 서버에 다시 요청하지 않음).
const saved = new URL("robots-exempt-" + asOf + ".json", discovery);
const reuse = process.argv.includes("--from-json") && existsSync(saved);
const results = reuse ? JSON.parse(readFileSync(saved, "utf8")).results : [];
for (const target of reuse ? [] : targets) {
  let result;
  try {
    if (target.kind === "metro") {
      let used = 0;
      const spend = () => (used < 8 ? (used += 1, true) : false);
      const list = await politeFetch(target.metro.endpoint);
      result = list.ok ? { ...(await verifyBoard({ text: "보도자료", strict: true }, list, spend)), homepage: target.metro.homepage, endpoint: target.metro.endpoint, menu_text: "보도자료" } : { status: "ACCESS_ERROR", reason: "목록 열람 실패(" + (list.error ?? list.status) + ")" };
    } else {
      result = await discoverBoard(homepages[target.org.id]);
    }
  } catch (error) {
    result = { status: "ACCESS_ERROR", reason: String(error?.message ?? error).slice(0, 80) };
  }
  results.push({ id: target.org.id, name: target.org.name, sido: target.org.sido, kind: target.kind, metroKey: target.metro?.key ?? null, ...result, checked_at: new Date().toISOString() });
  console.log(results.length + "/" + targets.length, target.org.sido, target.org.name, result.status, result.reason ?? "");
}

if (!reuse) writeFileSync(saved, JSON.stringify({ checked_at: new Date().toISOString(), basis: ROBOTS_EXEMPT_BASIS, results }, null, 2));
const lines = ["-- 자동 생성: scripts/press/robots-exempt.mjs " + name + " (" + VERSION + ")", "-- " + ROBOTS_EXEMPT_BASIS];
let registered = 0;
for (const row of results) {
  if (KEEP_MANUAL.has(row.id)) continue;
  if (MANUAL_REJECT[row.id]) Object.assign(row, { status: "CANDIDATE_NEEDS_REVIEW", reason: MANUAL_REJECT[row.id] });
  if (row.status === "AUTO_VERIFIED" && row.pattern) {
    const detailHost = new URL(row.pattern.profile.url).hostname;
    const sourceId = row.kind === "metro" ? "src:" + row.metroKey + ":press" : "src:" + detailHost + ":press";
    const values = [
      sourceId, row.id, "HTML", "HTMLBoardAdapter", row.homepage ?? null, row.endpoint, JSON.stringify([detailHost]), "ENDPOINT_VERIFIED",
      "robots.txt 예외 탐색·검증(" + row.reason + "). 메뉴: " + (row.menu_text ?? ""), Math.floor(Date.parse(row.checked_at) / 1000),
      "PENDING_PERMISSION", 0, ROBOTS_EXEMPT_BASIS, ROBOTS_EXEMPT_BASIS, JSON.stringify(row.pattern.profile), VERSION,
    ];
    lines.push(
      "--> statement-breakpoint",
      "INSERT INTO press_source (source_id, organization_id, method, adapter, homepage_url, endpoint_url, allowed_hosts, verification_status, verification_note, endpoint_verified_at, approval_status, enabled, policy_basis, robots_exempt, adapter_profile, registry_version) VALUES (" +
        values.map(quote).join(", ") +
        ") ON CONFLICT(source_id) DO UPDATE SET method = excluded.method, adapter = excluded.adapter, endpoint_url = excluded.endpoint_url, allowed_hosts = excluded.allowed_hosts, verification_status = excluded.verification_status, " +
        "verification_note = excluded.verification_note, endpoint_verified_at = excluded.endpoint_verified_at, policy_basis = excluded.policy_basis, robots_exempt = excluded.robots_exempt, adapter_profile = excluded.adapter_profile, registry_version = excluded.registry_version;",
      "--> statement-breakpoint",
      "UPDATE press_org_survey SET survey_category = 'endpoint_confirmed', survey_detail = 'OPERATOR_ROBOTS_EXEMPT', survey_reason = " + quote("robots.txt 예외 탐색·검증: " + row.reason) +
        ", endpoint_url = " + quote(row.endpoint) + ", registry_version = " + quote(VERSION) + " WHERE organization_id = " + quote(row.id) + ";",
    );
    registered += 1;
  } else {
    lines.push(
      "--> statement-breakpoint",
      "UPDATE press_org_survey SET survey_category = 'unconfirmed', survey_detail = " + quote("ROBOTS_EXEMPT_" + row.status) + ", survey_reason = " + quote("robots.txt 예외로 다시 봤으나 게시판 미확정: " + (row.reason ?? row.status)) +
        ", registry_version = " + quote(VERSION) + " WHERE organization_id = " + quote(row.id) + " AND survey_category = 'access_blocked';",
    );
  }
}
writeFileSync(migration, lines.join("\n") + "\n");
const counts = results.reduce((acc, row) => ({ ...acc, [row.status]: (acc[row.status] ?? 0) + 1 }), {});
console.log(JSON.stringify({ targets: reuse ? results.length : targets.length, counts, registered, migration: name }));
