// 로컬 시험 DB(.wrangler/state)에만 넣는 모의 자료. 실제 수집 코드(runner·project·matching·law-bundle)를 가짜 원천 응답으로 돌린다.
// 기관·서비스 이름에는 모두 [시험]을 붙인다. 운영 DB에는 절대 쓰지 않는다(로컬 miniflare SQLite 파일만 연다).
// 사용: (서버를 끈 뒤) node --experimental-strip-types scripts/integrations/seed-local-fixture.mjs
import { createHash } from "node:crypto";
import { readdirSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

import { advanceRun, startRun } from "../../lib/integrations/runner.ts";
import { advanceGov24Matching } from "../../lib/integrations/matching.ts";
import { mapKosisRegions } from "../../lib/integrations/kosis.ts";
import { importLawBundle } from "../../lib/integrations/law-bundle.ts";

const dir = ".wrangler/state/v3/d1/miniflare-D1DatabaseObject";
const file = readdirSync(dir).find((name) => /^[0-9a-f]{64}\.sqlite$/.test(name));
if (!file) throw new Error("로컬 D1 파일이 없습니다.");
const sqlite = new DatabaseSync(path.join(dir, file));
class Statement {
  constructor(sql, values = []) { this.sql = sql; this.values = values; }
  bind(...values) { return new Statement(this.sql, values); }
  async first() { return sqlite.prepare(this.sql).get(...this.values) ?? null; }
  async all() { return { results: sqlite.prepare(this.sql).all(...this.values) }; }
  async run() { return sqlite.prepare(this.sql).run(...this.values); }
}
const db = {
  prepare: (sql) => new Statement(sql),
  async batch(statements) {
    sqlite.exec("BEGIN");
    try { const out = statements.map((s) => sqlite.prepare(s.sql).run(...s.values)); sqlite.exec("COMMIT"); return out; } catch (error) { sqlite.exec("ROLLBACK"); throw error; }
  },
};
const now = Math.floor(Date.now() / 1000);
let id = 0;
const res = (status, body, type) => ({ status, headers: { get: (name) => (name.toLowerCase() === "content-type" ? type : null) }, text: async () => body });
const deps = (fetcher) => ({ fetcher, now: () => now, newId: () => "fixture-" + now + "-" + ++id, keyFor: async () => "LOCALFIXTUREKEY", owner: "fixture", stepBudgetMs: 60_000, queueCap: 100 });
async function runAll(dataset, scope, fetcher) {
  await db.prepare("INSERT OR IGNORE INTO ext_scope_state (dataset_key, scope_key) VALUES (?, ?)").bind(dataset, scope).run();
  const d = deps(fetcher);
  const { runId } = await startRun(db, d, dataset, scope, "local-fixture");
  let status = "RUNNING";
  for (let step = 0; step < 20 && status === "RUNNING"; step += 1) status = await advanceRun(db, d, runId);
  console.log(dataset, scope, status);
}

const xml = (items, total) => "<response><header><resultCode>00</resultCode><resultMsg>NORMAL SERVICE.</resultMsg></header><body><items>" + items.join("") + "</items><numOfRows>100</numOfRows><pageNo>1</pageNo><totalCount>" + total + "</totalCount></body></response>";
const ltc = [
  ["11260000001", "C01", "[시험] 중랑 방문요양센터"], ["11260000001", "C02", "[시험] 중랑 방문요양센터"], ["11260000002", "C03", "[시험] 중랑 주야간보호센터"],
  ["11260000003", "A03", "[시험] 중랑 노인요양원"], ["11260000004", "C05", "[시험] 중랑 방문간호센터"], ["11260000005", "C06", "[시험] 중랑 복지용구"],
].map(([sym, pttn, name]) => "<item><longTermAdminSym>" + sym + "</longTermAdminSym><adminPttnCd>" + pttn + "</adminPttnCd><adminNm>" + name + "</adminNm><siDoCd>11</siDoCd><siGunGuCd>260</siGunGuCd><longTermPeribRgtDt>20210301</longTermPeribRgtDt><stpRptDt>20210201</stpRptDt></item>");
await runAll("nhis.ltc_search", "sido:11", async () => res(200, xml(ltc, ltc.length), "application/xml"));
await runAll("nhis.ltc_detail", "queue", async (url) => {
  const parsed = new URL(url);
  const sym = parsed.searchParams.get("longTermAdminSym");
  if (parsed.pathname.endsWith("getConvInsttDetailInfoList02")) {
    const partners = sym === "11260000003" ? [["[시험] 중랑내과의원", "20240101", "99991231"], ["[시험] 옛협약병원", "20190101", "20231231"]] : [];
    return res(200, "<response><header><resultCode>00</resultCode><resultMsg>NORMAL SERVICE.</resultMsg></header><body><items>" + partners.map(([n, f, t]) => "<item><adptFrDt>" + f + "</adptFrDt><adptToDt>" + t + "</adptToDt><longTermAdminSym>" + sym + "</longTermAdminSym><yoyangNm>" + n + "</yoyangNm></item>").join("") + "</items><totalCount>" + partners.length + "</totalCount></body></response>", "application/xml");
  }
  return res(200, "<response><header><resultCode>00</resultCode><resultMsg>NORMAL SERVICE.</resultMsg></header><body><item><longTermAdminSym>" + sym + "</longTermAdminSym><adminPttnCd>C01</adminPttnCd><adminNm>x</adminNm><siDoCd>11</siDoCd><siGunGuCd>260</siGunGuCd><BDongCd>101</BDongCd><riCd>00</riCd><detailAddr>[시험] 주소 1</detailAddr><locTelNo_1>02</locTelNo_1><locTelNo_2>000</locTelNo_2><locTelNo_3>0000</locTelNo_3></item></body></response>", "application/xml");
});
const gov = JSON.stringify({ page: 1, perPage: 500, totalCount: 1, currentCount: 1, matchCount: 1, data: [{ 서비스ID: "FIXTURE-0001", 서비스명: "노인 방문 구강관리", 소관기관명: "서울특별시 중랑구", 소관기관유형: "지방자치단체", 지원대상: "[시험] 65세 이상 구강관리 필요 어르신", 신청방법: "[시험] 동 주민센터 방문 신청", 접수기관: "[시험] 중랑구 보건소", 전화문의: "02-000-0000", 수정일시: "20261001", 상세조회URL: "https://www.gov.kr/portal/rcvfvrSvc/main" }] });
await runAll("mois.gov24_list", "all", async () => res(200, gov, "application/json"));
await runAll("mois.gov24_detail", "queue", async () => res(200, JSON.stringify({ page: 1, perPage: 1, totalCount: 1, currentCount: 1, matchCount: 1, data: [{ 서비스ID: "FIXTURE-0001", 서비스명: "노인 방문 구강관리", 구비서류: "[시험] 신분증", 법령: "구강보건법 제15조", 수정일시: "20261001" }] }), "application/json"));
console.log("match", JSON.stringify(await advanceGov24Matching(db, now)));
await db.prepare("UPDATE kosis_table SET status = 'VERIFIED', query_json = ?, item_label = '[시험] 65세 이상 인구', unit = '명', period_type = 'M', region_level = '시·군·구', population_basis = '[시험] 주민등록인구', verified_at = ? WHERE org_id = '101' AND tbl_id = 'DT_1B04005N'")
  .bind(JSON.stringify({ itmId: "T2", objL1: "ALL", objL2: "ALL", prdSe: "M", newEstPrdCnt: 3, aggregate: { class2_codes: ["65", "70", "75"], label: "[시험] 65세 이상 인구" } }), now).run();
const kosis = [];
for (const [period, values] of [["202607", ["30100", "21000", "28000"]], ["202608", ["30200", "21100", "28100"]], ["202609", ["30300", "x", "28200"]]]) {
  ["65", "70", "75"].forEach((code, index) => kosis.push({ ORG_ID: "101", TBL_ID: "DT_1B04005N", TBL_NM: "[시험]", ITM_ID: "T2", ITM_NM: "인구", UNIT_NM: "명", C1: "1126000000", C1_NM: "중랑구", C2: code, C2_NM: code + "세 이상 5세 계급", PRD_SE: "M", PRD_DE: period, DT: values[index], LST_CHN_DE: "2026-10-01" }));
}
await runAll("kosis.stats", "tbl:101:DT_1B04005N", async () => res(200, JSON.stringify(kosis), "text/html;charset=UTF-8"));
console.log("kosis maps", await mapKosisRegions(db, "101", "DT_1B04005N", now));
const link = sqlite.prepare("SELECT target_id, target_label FROM program_ext_link WHERE source_kind = 'GOV24' AND source_id = 'FIXTURE-0001'").get();
if (link) {
  sqlite.prepare("UPDATE program_ext_link SET status = 'VERIFIED', reviewed_at = ?, review_note = '[시험] 로컬 연결 시험용 확인' WHERE source_kind = 'GOV24' AND source_id = 'FIXTURE-0001'").run(now);
  const items = [{ candidate_id: "FIXTURE-0001:법령:" + link.target_id, target_kind: "service", target_id: link.target_id, target_label: link.target_label, citation_text: "구강보건법 제15조", source: { kind: "GOV24_FIELD", id: "FIXTURE-0001", field: "법령" }, status: "OK", message: null, verify_summary: "[시험] 모의 검증 결과", references: [{ law_name: "구강보건법", law_kind: "법률", law_id: "FIXTURE", mst: "FIXTURE-MST", article: "제15조", promulgated_on: null, effective_on: null, version_status: "CURRENT", article_status: "EXISTS", upcoming_note: null, official_url: "https://www.law.go.kr/법령/구강보건법", text_sha256: "0".repeat(64) }] }];
  const bundle = { schema: "welfare-law-bundle-1", created_at: new Date().toISOString(), query_date: new Date().toISOString().slice(0, 10), package: "korean-law-mcp@4.15.6", server: { name: "korean-law", version: "4.15.6" }, collector_version: "fixture", protocol_sha256: "0".repeat(64), blocked_count: 0, items };
  bundle.items_sha256 = createHash("sha256").update(JSON.stringify(items)).digest("hex");
  console.log("law", JSON.stringify(await importLawBundle(db, JSON.stringify(bundle), now)));
  sqlite.prepare("UPDATE program_ext_link SET status = 'VERIFIED', reviewed_at = ?, review_note = '[시험] 로컬 연결 시험용 확인' WHERE source_kind = 'LAW' AND target_id = ?").run(now, link.target_id);
  console.log("target", link.target_id);
}
sqlite.close();
