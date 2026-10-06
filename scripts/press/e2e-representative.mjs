// 대표 12개 기관 실제 E2E(작업지시서 v5 §23.20). 실제 마이그레이션을 적용한 임시 DB에서 실제 수집 코드(collectPressSource)를
// 공식 endpoint에 그대로 돌려 결과를 기록한다. 운영 DB·승인 상태는 바꾸지 않는다. 표본 결과를 전국 수집 성공으로 확대하지 않는다.
//   node scripts/press/e2e-representative.mjs [기준일] [script-profiles]  (두 번째 인자: 스크립트 링크 개별 프로필 기관 전체)
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";

import { setPressApproval } from "../../lib/press/admin.ts";
import { collectPressSource } from "../../lib/press/collect.ts";
import { readSource } from "../../lib/press/store.ts";
import { database } from "../../lib/press-test-support.mjs";

const asOf = process.argv[2] ?? new Date().toISOString().slice(0, 10);
const scriptProfiles = process.argv[3] === "script-profiles";
// 두 번째 인자에 쉼표로 기관 ID를 주면(예: org:경상북도) 그 기관만 돌린다.
const explicit = process.argv[3]?.startsWith("org:") ? process.argv[3].split(",") : null;
const REPRESENTATIVES = explicit ?? (scriptProfiles ? Object.entries(JSON.parse(readFileSync(new URL("../../docs/press/discovery/boards.json", import.meta.url), "utf8")).boards).filter(([, board]) => board.status === "AUTO_VERIFIED" && board.pattern?.method === "SCRIPT_LINK_PROFILE").map(([id]) => id) : [
  "org:mohw", "org:서울특별시", "org:전남광주통합특별시", "org:인천광역시", "org:경기도", "org:제주특별자치도",
  "org:제주특별자치도:제주시", "org:제주특별자치도:서귀포시", "org:경기도:화성시", "org:경기도:화성시:동탄구", "org:충청북도:청주시", "org:경상남도:창원시",
]);

const deps = {
  fetcher: async (url, headers) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15_000);
    try {
      return await fetch(url, { headers, redirect: "manual", signal: controller.signal });
    } finally {
      clearTimeout(timer);
    }
  },
  now: () => Math.floor(Date.now() / 1000),
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  newId: () => crypto.randomUUID(),
};

const db = database();
const results = [];
for (const organizationId of REPRESENTATIVES) {
  const org = db.sqlite.prepare("SELECT name, org_type, lifecycle_status FROM press_organization WHERE organization_id = ?").get(organizationId);
  const survey = db.sqlite.prepare("SELECT survey_category, survey_detail, survey_reason, endpoint_url FROM press_org_survey WHERE organization_id = ?").get(organizationId);
  const sources = db.sqlite.prepare("SELECT source_id, method, adapter, endpoint_url, verification_status FROM press_source WHERE organization_id = ?").all(organizationId);
  const row = { organization_id: organizationId, name: org?.name ?? null, organization_type: org?.org_type ?? null, lifecycle: org?.lifecycle_status ?? null, survey, sources: [] };
  for (const source of sources) {
    const entry = { source_id: source.source_id, method: source.method, adapter: source.adapter, endpoint_url: source.endpoint_url, verification_status: source.verification_status };
    if (source.verification_status !== "ENDPOINT_VERIFIED") {
      entry.result = "NOT_RUN";
      entry.reason = "endpoint 미확인·차단 Source는 수집하지 않음";
      row.sources.push(entry);
      continue;
    }
    await setPressApproval(db, source.source_id, "approve", deps.now());
    const loaded = await readSource(db, source.source_id);
    const started = Date.now();
    const summary = await collectPressSource(db, { source: loaded, trigger: "manual" }, deps);
    const items = db.sqlite.prepare("SELECT title, canonical_url, published_date, public_status, classification_status FROM press_item WHERE source_id = ? ORDER BY published_date DESC LIMIT 3").all(source.source_id);
    Object.assign(entry, {
      result: summary.status, error_code: summary.errorCode || null, http_status: summary.httpStatus, elapsed_ms: Date.now() - started,
      counts: summary.counts, latest_published_date: items[0]?.published_date ?? null,
      sample: items.map((item) => ({ title: item.title.slice(0, 60), url: item.canonical_url, date: item.published_date, public_status: item.public_status })),
    });
    row.sources.push(entry);
  }
  results.push(row);
  console.log(organizationId, survey?.survey_category, row.sources.map((s) => s.source_id + ":" + (s.result ?? "-") + (s.counts ? "(" + s.counts.feedItems + ")" : "") + (s.error_code ? "[" + s.error_code + "]" : "")).join(", ") || "Source 없음");
}
const out = new URL("../../docs/press/e2e/", import.meta.url);
mkdirSync(out, { recursive: true });
const summary = {
  as_of: asOf, executed_at: new Date().toISOString(), runner: "로컬 PC(Node " + process.version + "), 실제 공식 endpoint 호출, 임시 SQLite",
  note: (scriptProfiles ? "스크립트 링크 개별 프로필 " + REPRESENTATIVES.length + "곳" : "대표 12곳 표본") + "의 실제 상태다. 전국 수집 성공률이 아니며, Cloudflare Workers 운영 환경의 접근 가능 여부(예: 전남광주 522)와 다를 수 있다.",
  succeeded: results.filter((row) => row.sources.some((s) => s.result === "succeeded" || s.result === "not_modified")).length,
  results,
};
writeFileSync(new URL((explicit ? "orgs-" : scriptProfiles ? "script-profiles-" : "representative-") + asOf + ".json", out), JSON.stringify(summary, null, 2));
console.log("succeeded orgs", summary.succeeded, "/", results.length);
