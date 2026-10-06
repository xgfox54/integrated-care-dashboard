import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

const origin = process.argv[2];
const output = resolve(process.argv[3] ?? "var/law-mcp-probe/audit-http.json");
if (!origin || !/^https?:\/\/(127\.0\.0\.1(?::\d+)?|integrated-care-national-dashboard\.xgfox54\.chatgpt\.site)$/.test(origin)) {
  throw new Error("검증할 로컬 주소 또는 확인된 Sites 주소를 지정하세요.");
}
const results = [];
async function request(path, json = true) {
  const started = performance.now();
  const response = await fetch(origin + path, { signal: AbortSignal.timeout(30000) });
  const text = await response.text();
  const record = { path, status: response.status, elapsed_ms: Math.round(performance.now() - started), bytes: Buffer.byteLength(text) };
  results.push(record);
  assert.equal(response.status, 200, `${path}: HTTP ${response.status}`);
  return json ? JSON.parse(text) : text;
}
let failure;
try {
  for (const path of ["/", "/wiki", "/welfare100", "/mindmap", "/news", "/budget", "/sources", "/usage-policy"]) {
    const html = await request(path, false);
    assert.ok(html.includes("전국 통합돌봄"), `${path}: HTML 페이지 확인`);
  }
  const summary = await request("/data/summary.json");
  assert.ok(Date.parse(summary.fetchedAt) > Date.UTC(2026, 0, 1), "정적 자료 확인 날짜");
  const service = "service:00831489622127|강원특별자치도|강릉시|일상생활돌봄|안부확인|1촌돌봄단";
  const info = await request("/api/integrations/program?service=" + encodeURIComponent(service));
  assert.equal(info.ok, true, "긴 사업 ID 공식 연결 조회");
  await request("/api/wiki/context?service=" + encodeURIComponent(service));
  const news = await request("/api/press?page=1&size=20");
  const status = await request("/api/press/status");
  assert.equal(status.items.display_total, news.total_count, "공개 뉴스 집계와 중복 제외 목록 일치");
  assert.ok(news.items.every((item) => !item.title.endsWith(" 새글")), "새 글 배지와 제목 분리");
  const budget = await request("/api/budget?view=main");
  assert.equal(budget.filters?.mode ?? budget.mode, "social_welfare", "예산 API 기본 분야");
  const deep = await request("/api/budget?mode=social_welfare&view=main&page=501&size=20");
  assert.equal(deep.page, 501, "501쪽을 500쪽으로 바꾸지 않음");
  const first = new Set(budget.items.map((item) => item.fiscal_project_id));
  assert.ok(deep.items.every((item) => !first.has(item.fiscal_project_id)), "첫 쪽과 501쪽 행 중복 없음");
  const region = await request("/api/budget?mode=social_welfare&view=main&region=4900000");
  const national = await request("/api/budget?mode=social_welfare&view=main");
  assert.equal(national.summary.current_budget_krw, budget.summary.current_budget_krw, "지역 조회 후 전국 합계 유지");
  assert.ok(BigInt(region.summary.current_budget_krw) < BigInt(national.summary.current_budget_krw), "지역 합계는 전국 합계와 별도");
  const map = await request("/api/mindmap");
  assert.ok(map, "관계성 지도 API JSON 확인");
} catch (error) {
  failure = String(error.message);
}
mkdirSync(dirname(output), { recursive: true });
writeFileSync(output, JSON.stringify({ checked_at: new Date().toISOString(), origin, status: failure ? "FAIL" : "PASS", failure, results }, null, 2) + "\n");
console.log(JSON.stringify({ status: failure ? "FAIL" : "PASS", failure, calls: results.length, output }));
if (failure) process.exitCode = 1;
