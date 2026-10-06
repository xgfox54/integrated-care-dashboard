// 인수 질의 120개(작업지시서 v5 §18.2·18.6·18.7) 실행기. 로컬 서버(실제 자료가 든 로컬 D1)의 MCP에 질의하고,
// 정답은 MCP 코드 경로와 다른 독립 경로로 만든다: 복지=D1 원자료 SQL, 재정=지방재정365 공식 API 직접 호출,
// 보도자료=보건복지부 RSS 직접 읽기, 공식 보도자료 registry=조사표 SQL. 결과는 docs/acceptance/results-<날짜>.json.
//   node scripts/acceptance/run-acceptance.mjs [MCP 주소] [기준일]
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";

const MCP = process.argv[2] ?? "http://127.0.0.1:8797/mcp";
const asOf = process.argv[3] ?? new Date().toISOString().slice(0, 10);
const FISCAL_DATE = "20261002";

function sql(query) {
  const out = execFileSync(process.execPath, ["--import", "./scripts/sites-env.mjs", "./node_modules/wrangler/bin/wrangler.js", "d1", "execute", "DB", "--local", "--config", "dist/server/wrangler.json", "--persist-to", ".wrangler/state", "--json", "--command", query], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  return JSON.parse(out.slice(out.indexOf("[")))[0].results;
}

let rpcId = 0;
async function tool(name, args) {
  // 공개 MCP 호출 한도(분당 60회)에 걸리면 기다렸다가 다시 묻는다.
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const response = await fetch(MCP, { method: "POST", headers: { "content-type": "application/json", accept: "application/json, text/event-stream" }, body: JSON.stringify({ jsonrpc: "2.0", id: ++rpcId, method: "tools/call", params: { name, arguments: args } }) });
    if (response.status === 429) {
      await new Promise((resolve) => setTimeout(resolve, 61_000));
      continue;
    }
    const body = await response.json();
    if (body.error) return { protocolError: body.error };
    return body.result.structuredContent ?? {};
  }
  return { rateLimited: true };
}
const results = [];
async function check(category, id, question, run) {
  const started = Date.now();
  try {
    const { pass, detail } = await run();
    results.push({ category, id, question, pass, detail, ms: Date.now() - started });
  } catch (error) {
    results.push({ category, id, question, pass: false, detail: "예외: " + String(error.message ?? error).slice(0, 200), ms: Date.now() - started });
  }
}

const compact = (text) => String(text ?? "").replace(/\s+/g, " ").trim();
const FORBIDDEN_NEWS = ["body", "summary", "snippet", "excerpt", "description", "content"];

// ---------- A. 복지 사업 50 ----------
const runId = sql("SELECT id FROM official_sync_run WHERE status = 'succeeded' ORDER BY completed_at DESC LIMIT 1")[0].id;
const sampled = sql("SELECT service_id, CASE WHEN sido IN ('광주광역시','전라남도') THEN '전남광주통합특별시' ELSE sido END AS sido, sigungu, name, target FROM official_service_snapshot WHERE sync_run_id = '" + runId + "' AND sigungu <> '' AND sigungu <> sido AND length(name) BETWEEN 4 AND 30 AND name NOT LIKE '%''%' ORDER BY substr(service_id, -3), service_id LIMIT 400")
  .filter((row, index) => index % 10 === 0).slice(0, 30);
for (const [index, row] of sampled.entries()) {
  await check("welfare", "W" + String(index + 1).padStart(2, "0"), row.sido + " " + row.sigungu + "의 「" + row.name + "」 찾기", async () => {
    const result = await tool("find_programs", { region_id: "region:" + row.sido + "|" + row.sigungu, query: row.name.split(/\s+/).slice(0, 3).join(" "), limit: 5 });
    const hit = (result.data ?? []).find((item) => item.name === row.name || compact(item.name) === compact(row.name));
    return { pass: Boolean(hit), detail: hit ? "상위 5개 안 " + (result.data.indexOf(hit) + 1) + "위" : "상위 5개에 없음(총 " + (result.coverage?.total_count ?? 0) + ")" };
  });
}
const eligibility = sampled.slice(0, 10);
for (const [index, row] of eligibility.entries()) {
  await check("welfare", "W" + String(31 + index), "「" + row.name + "」 공개 지원대상", async () => {
    const found = await tool("find_programs", { region_id: "region:" + row.sido + "|" + row.sigungu, query: row.name.split(/\s+/).slice(0, 3).join(" "), limit: 5 });
    const hit = (found.data ?? []).find((item) => compact(item.name) === compact(row.name));
    if (!hit) return { pass: false, detail: "사업을 찾지 못함" };
    const result = await tool("get_eligibility", { implementation_id: hit.implementation_id });
    const expected = compact(row.target) || null;
    const actual = compact(result.data?.source_target_text) || null;
    const ok = actual === expected && result.data?.personal_determination === false;
    return { pass: ok, detail: ok ? "원자료 지원대상 문구와 일치, 개인 판정 없음" : "기대 " + expected + " / 실제 " + actual };
  });
}
for (const [index, query] of ["존재하지않는가상사업가나다", "없는돌봄시범사업zzz", "가상의복지바우처qq", "미등록통합돌봄xx사업", "테스트용허구서비스"].entries()) {
  await check("welfare", "W" + String(41 + index), "없는 사업 「" + query + "」", async () => {
    const result = await tool("find_programs", { query });
    const ok = (result.data ?? []).length === 0 && result.coverage?.complete === false && (result.coverage?.gaps ?? []).length > 0;
    return { pass: ok, detail: ok ? "0건 + '결과 없음≠사업 없음' 안내" : JSON.stringify(result.coverage).slice(0, 160) };
  });
}
const sameNames = sql("SELECT name, COUNT(DISTINCT sido || sigungu) AS regions FROM official_service_snapshot WHERE sync_run_id = '" + runId + "' AND length(name) BETWEEN 4 AND 20 GROUP BY name HAVING regions >= 3 ORDER BY regions DESC, name LIMIT 5");
for (const [index, row] of sameNames.entries()) {
  await check("welfare", "W" + String(46 + index), "동명 사업 「" + row.name + "」 지역별 분리", async () => {
    const result = await tool("find_programs", { query: row.name, limit: 50 });
    const exact = (result.data ?? []).filter((item) => item.name === row.name);
    const ids = new Set(exact.map((item) => item.implementation_id));
    const regions = new Set(exact.map((item) => item.region.region_id));
    const ok = exact.length >= 2 && ids.size === exact.length && regions.size >= 2;
    return { pass: ok, detail: exact.length + "건, 지역 " + regions.size + "곳, ID 중복 없음=" + (ids.size === exact.length) };
  });
}

// ---------- B. 재정 20: 지방재정365 공식 API 직접 호출과 대조 ----------
async function lofinRows(waLafCd) {
  const rows = [];
  for (const page of [1, 2]) {
    const url = "https://www.lofin365.go.kr/lf/hub/QWGJK?" + new URLSearchParams({ Type: "json", pIndex: String(page), pSize: "5", fyr: "2026", exe_ymd: FISCAL_DATE, wa_laf_cd: waLafCd, dbiz_nm: "통합돌봄" });
    const body = await (await fetch(url)).json();
    rows.push(...(body.QWGJK?.[1]?.row ?? []));
  }
  return rows;
}
const official = [...(await lofinRows("4900000")), ...(await lofinRows("1100000"))].slice(0, 20);
for (const [index, row] of official.entries()) {
  const projectId = "fp:" + [row.fyr, row.laf_cd, row.acnt_dv_cd, row.dept_cd, row.dbiz_cd].join(":");
  await check("fiscal", "F" + String(index + 1).padStart(2, "0"), row.laf_hg_nm + " 「" + row.dbiz_nm + "」 예산현액·지출액(" + FISCAL_DATE + ")", async () => {
    const result = await tool("get_budget_execution", { fiscal_project_ids: [projectId], fiscal_year: 2026, reference_date: "2026-10-02", fallback_policy: "exact" });
    const item = result.data?.[0];
    const ok = item?.current_budget_krw === String(row.bdg_cash_amt) && item?.public_expenditure_krw === String(row.ep_amt) && item?.reference_date === "2026-10-02";
    return { pass: ok, detail: ok ? "공식 API와 일치(" + row.bdg_cash_amt + "/" + row.ep_amt + ")" : "공식 " + row.bdg_cash_amt + "/" + row.ep_amt + " vs MCP " + JSON.stringify(item).slice(0, 160) };
  });
}

// ---------- C. 보도자료 20: 보건복지부 RSS 직접 읽기와 대조 ----------
const rss = await (await fetch("https://www.mohw.go.kr/rss/board.es?mid=a10503000000&bid=0027")).text();
const rssItems = [...rss.matchAll(/<item>[\s\S]*?<title><!\[CDATA\[([\s\S]*?)\]\]><\/title>[\s\S]*?<link>([^<]+)<\/link>[\s\S]*?<\/item>/g)].map((match) => ({ title: compact(match[1]), link: match[2].replace(/&amp;/g, "&").trim() }));
const stored = sql("SELECT item_id, title, canonical_url, published_date FROM press_item WHERE source_id = 'src:mohw:press-rss' AND public_status = 'PUBLIC' ORDER BY published_date DESC LIMIT 40");
const overlap = stored.filter((item) => rssItems.some((rssItem) => rssItem.title === compact(item.title))).slice(0, 10);
for (const [index, item] of overlap.entries()) {
  await check("news", "N" + String(index + 1).padStart(2, "0"), "보도자료 「" + item.title.slice(0, 30) + "」 제목·원문 주소", async () => {
    const result = await tool("search_news", { query: item.title.split(/\s+/).slice(0, 3).join(" "), organization_ids: ["org:mohw"], limit: 10 });
    const hit = (result.data ?? []).find((row) => row.article_id === item.item_id);
    const rssItem = rssItems.find((row) => row.title === compact(item.title));
    const ok = Boolean(hit) && compact(hit.title) === rssItem.title && hit.content_scope === "metadata_only" && !FORBIDDEN_NEWS.some((key) => key in hit);
    return { pass: ok, detail: ok ? "RSS 제목과 일치, 메타데이터 전용" : "불일치 " + JSON.stringify(hit ?? null).slice(0, 120) };
  });
}
for (const [index, item] of overlap.slice(0, 5).entries()) {
  await check("news", "N" + String(11 + index), "fetch(news:…) 메타데이터 전용", async () => {
    const result = await tool("fetch", { id: "news:" + item.item_id });
    const ok = result.metadata?.content_scope === "metadata_only" && /본문·요약 미제공/.test(result.text ?? "") && result.url === item.canonical_url;
    return { pass: ok, detail: ok ? "원문 주소만, 본문 없음" : JSON.stringify(result).slice(0, 160) };
  });
}
const negatives = [
  ["N16", "민간 매체 ID 지정 거절", { publisher_ids: ["chosun"] }, "PUBLISHER_IDS_NOT_SUPPORTED"],
  ["N17", "언급 지역 기준 거절", { region_ids: ["region:서울특별시"], region_basis: "mentioned" }, "REGION_BASIS_NOT_AVAILABLE"],
  ["N18", "검증 묶음 모드 거절", { group_mode: "verified_groups" }, "GROUP_MODE_NOT_AVAILABLE"],
  ["N19", "날짜 역전 거절", { date_from: "2026-10-05", date_to: "2026-10-01" }, "INPUT_CONFLICT"],
];
for (const [id, question, args, code] of negatives) {
  await check("news", id, question, async () => {
    const result = await tool("search_news", args);
    return { pass: result.error?.code === code, detail: result.error?.code ?? "오류 없음" };
  });
}
await check("news", "N20", "기사 ID 자리에 URL 거절", async () => {
  const result = await tool("get_news_metadata", { article_id: "https://www.mohw.go.kr/board.es?x=1" });
  return { pass: result.error?.code === "ARTICLE_ID_INVALID", detail: result.error?.code ?? "오류 없음" };
});

// ---------- D. 교차 10 ----------
const bundleIds = new Set();
for (const [name, args] of [["get_dataset_status", {}], ["find_programs", { query: "방문" }], ["search_news", {}], ["get_fiscal_catalog", { catalog_type: "available_reference_date" }], ["get_ontology_schema", {}]]) {
  const result = await tool(name, args);
  bundleIds.add(result.release_bundle_id);
}
await check("cross", "X01", "다섯 도구가 같은 통합 공개본을 쓴다", async () => ({ pass: bundleIds.size === 1 && ![...bundleIds][0]?.startsWith("rb:"), detail: [...bundleIds].join(",") }));
const status = await tool("get_dataset_status", {});
await check("cross", "X02", "도메인별 기준일을 하나로 합치지 않는다", async () => ({ pass: Boolean(status.data?.knowledge?.effective_reference_date) && status.warnings?.some((warning) => /합치지/.test(warning)), detail: status.warnings?.join(" / ") }));
await check("cross", "X03", "공개본 호환성 보고서가 있다", async () => ({ pass: Array.isArray(status.data?.release_bundle?.compatibility?.blocking), detail: JSON.stringify(status.data?.release_bundle?.compatibility).slice(0, 160) }));
for (const [index, row] of sampled.slice(0, 5).entries()) {
  await check("cross", "X" + String(4 + index).padStart(2, "0"), "「" + row.name + "」 종합 맥락: 조건·재정·보도 분리", async () => {
    const found = await tool("find_programs", { region_id: "region:" + row.sido + "|" + row.sigungu, query: row.name.split(/\s+/).slice(0, 3).join(" "), limit: 5 });
    const hit = (found.data ?? []).find((item) => compact(item.name) === compact(row.name));
    if (!hit) return { pass: false, detail: "사업을 찾지 못함" };
    const result = await tool("get_welfare_context", { implementation_id: hit.implementation_id });
    const fiscal = result.data?.fiscal;
    const ok = ["UNLINKED", "LINKED_VERIFIED"].includes(fiscal?.status) && !("current_budget_krw" in (fiscal ?? {})) && result.data?.eligibility?.personal_determination === false && (result.data?.news?.items ?? []).every((item) => item.content_scope === "metadata_only");
    return { pass: ok, detail: "재정 " + fiscal?.status + ", 보도 " + (result.data?.news?.items?.length ?? 0) + "건" };
  });
}
await check("cross", "X09", "후보 연결은 공개 연결로 나오지 않는다", async () => {
  const candidates = sql("SELECT target_id FROM cross_domain_link WHERE verification_status = 'CANDIDATE' LIMIT 1");
  if (!candidates.length) return { pass: true, detail: "후보 없음(해당 없음)" };
  const result = await tool("get_welfare_context", { implementation_id: candidates[0].target_id });
  return { pass: result.data?.fiscal?.status === "UNLINKED", detail: "후보 대상 사업의 재정 상태 " + result.data?.fiscal?.status };
});
await check("cross", "X10", "재정 4도구가 공개본 고정 snapshot만 쓴다", async () => {
  const catalog = await tool("get_fiscal_catalog", { catalog_type: "available_reference_date" });
  const published = sql("SELECT snapshot_id FROM fiscal_snapshot WHERE status = 'PUBLISHED'").map((row) => row.snapshot_id);
  const returned = (catalog.data ?? []).map((row) => row.snapshot_id);
  return { pass: returned.every((id) => published.includes(id)), detail: returned.join(",") };
});

// ---------- E. 공식 보도자료·registry 20 ----------
const survey = sql("SELECT survey_category, COUNT(*) AS n FROM press_org_survey GROUP BY survey_category");
const archive = await tool("get_news_archive_status", { limit: 50 });
await check("press", "P01", "조사 대상 기관 수(시드)", async () => ({ pass: archive.data?.targets?.organizations === sql("SELECT COUNT(*) AS n FROM press_organization WHERE lifecycle_status = 'ACTIVE'")[0].n, detail: String(archive.data?.targets?.organizations) }));
await check("press", "P02", "endpoint 확인 기관 수가 조사표와 일치", async () => ({ pass: archive.data?.coverage?.endpoint_verified_organizations === (survey.find((row) => row.survey_category === "endpoint_confirmed")?.n ?? 0), detail: archive.data?.coverage?.endpoint_verified_organizations + " vs " + JSON.stringify(survey) }));
await check("press", "P03", "등록 기관 수를 수집률로 쓰지 않는다", async () => ({ pass: /전국 수집률이 아닙니다/.test(archive.data?.coverage?.denominator_note ?? ""), detail: archive.data?.coverage?.denominator_note }));
await check("press", "P04", "행정시 Source 조회(ADMINISTRATIVE_CITY)", async () => {
  const result = await tool("get_news_archive_status", { organization_type: "ADMINISTRATIVE_CITY" });
  const expected = sql("SELECT COUNT(*) AS n FROM press_source s JOIN press_organization o ON o.organization_id = s.organization_id WHERE o.org_type = 'ADMINISTRATIVE_CITY'")[0].n;
  return { pass: result.data?.source_total === expected, detail: result.data?.source_total + " vs " + expected };
});
await check("press", "P05", "민간 기사 수집 상태", async () => {
  const result = await tool("get_news_archive_status", { source_kind: "NEWS_ARTICLE" });
  return { pass: result.data?.status === "NOT_COLLECTED", detail: result.data?.status };
});
const regionCases = [["P06", "region:서울특별시", false], ["P07", "region:서울특별시", true], ["P08", "region:인천광역시", true], ["P09", "region:경기도", false], ["P10", "region:충청남도", false]];
for (const [id, regionId, descendants] of regionCases) {
  const sido = regionId.slice(7);
  await check("press", id, sido + " 발행 보도자료(하위기관 포함=" + descendants + ")", async () => {
    const result = await tool("search_news", { region_ids: [regionId], include_descendant_publishers: descendants, limit: 50 });
    const expected = sql("SELECT COUNT(*) AS n FROM press_item i JOIN press_source s ON s.source_id = i.source_id JOIN press_organization o ON o.organization_id = i.issued_by_org_id WHERE i.public_status = 'PUBLIC' AND s.approval_status = 'POLICY_APPROVED' AND s.enabled = 1 AND o.sido = '" + sido + "'" + (descendants ? "" : " AND o.sigungu = ''") + " AND i.discovered_at <= (SELECT json_extract(components_json, '$.news.detail.discovered_watermark') FROM platform_release_bundle b JOIN platform_active_bundle a ON a.bundle_id = b.bundle_id)")[0].n;
    return { pass: result.coverage?.total_count === expected && (result.data ?? []).every((item) => item.publisher_region.sido === sido), detail: result.coverage?.total_count + " vs " + expected };
  });
}
await check("press", "P11", "보건복지부 발행 자료는 중앙 기관 유형", async () => {
  const result = await tool("search_news", { organization_types: ["CENTRAL"], limit: 5 });
  return { pass: (result.data ?? []).length > 0 && result.data.every((item) => item.issued_by.type === "CENTRAL"), detail: (result.data ?? []).length + "건" };
});
await check("press", "P12", "기관 레지스트리 개체 조회", async () => {
  const result = await tool("get_entity", { entity_id: "org:제주특별자치도:서귀포시" });
  return { pass: result.data?.facts?.organization_type === "ADMINISTRATIVE_CITY", detail: result.data?.facts?.organization_type };
});
await check("press", "P13", "행정시와 제주 재정주체를 섞지 않는다", async () => {
  const result = await tool("find_budget_projects", { fiscal_year: 2026, mode: "integrated_care", region_id: "region:제주특별자치도|서귀포시" });
  return { pass: result.error?.code === "MAPPING_REQUIRED", detail: result.error?.code ?? "오류 없음" };
});
await check("press", "P14", "보도자료 분류 관계는 확정 사실이 아니다", async () => {
  const item = stored[0];
  const result = await tool("get_relationships", { entity_id: "news:" + item.item_id });
  const topic = (result.data ?? []).filter((relation) => relation.predicate_id === "classified_as_topic");
  return { pass: topic.length > 0 && topic.every((relation) => relation.verification_status === "UNVERIFIED_CLASSIFICATION"), detail: topic.length + "건" };
});
await check("press", "P15", "게시일 기간 필터", async () => {
  const result = await tool("search_news", { date_from: "2026-10-02", date_to: "2026-10-02", limit: 50 });
  return { pass: (result.data ?? []).every((item) => item.published_date === "2026-10-02"), detail: (result.data ?? []).length + "건" };
});
await check("press", "P16", "발견일 기준 필터", async () => {
  const result = await tool("search_news", { date_basis: "discovered", date_from: "2020-01-01", limit: 5 });
  return { pass: result.basis?.news_date_basis === "discovered" && Array.isArray(result.data), detail: result.basis?.news_date_basis };
});
await check("press", "P17", "철회·숨김 자료는 검색되지 않는다", async () => {
  const hidden = sql("SELECT item_id, title FROM press_item WHERE public_status <> 'PUBLIC' LIMIT 1");
  if (!hidden.length) return { pass: true, detail: "숨김 자료 없음(해당 없음)" };
  const result = await tool("get_news_metadata", { article_id: hidden[0].item_id });
  return { pass: result.error?.code === "NOT_FOUND", detail: result.error?.code ?? "노출됨" };
});
await check("press", "P18", "미승인 Source 자료는 공개되지 않는다", async () => {
  const pending = sql("SELECT i.item_id FROM press_item i JOIN press_source s ON s.source_id = i.source_id WHERE s.approval_status <> 'POLICY_APPROVED' LIMIT 1");
  if (!pending.length) return { pass: true, detail: "미승인 Source 자료 없음(해당 없음)" };
  const result = await tool("get_news_metadata", { article_id: pending[0].item_id });
  return { pass: result.error?.code === "NOT_FOUND", detail: result.error?.code ?? "노출됨" };
});
await check("press", "P19", "관련 묶음은 같은 자료 확정이 아니다", async () => {
  const result = await tool("search_news", { limit: 50 });
  const grouped = (result.data ?? []).filter((item) => item.related_group);
  return { pass: grouped.every((item) => item.related_group.verified_same_release === false), detail: grouped.length + "건 묶음" };
});
await check("press", "P20", "보도자료 MCP 응답에 금지 필드 없음(전수)", async () => {
  const result = await tool("search_news", { limit: 50 });
  const bad = (result.data ?? []).filter((item) => FORBIDDEN_NEWS.some((key) => key in item));
  return { pass: bad.length === 0 && (result.data ?? []).length > 0, detail: (result.data ?? []).length + "건 검사" };
});

const byCategory = {};
for (const result of results) {
  byCategory[result.category] ??= { total: 0, pass: 0 };
  byCategory[result.category].total += 1;
  if (result.pass) byCategory[result.category].pass += 1;
}
const summary = {
  as_of: asOf, executed_at: new Date().toISOString(), mcp: MCP,
  basis: "로컬 wrangler 서버 + 실제 자료(로컬 D1). 정답은 MCP 코드와 독립된 경로(D1 원자료 SQL·지방재정365 공식 API·보건복지부 RSS·조사표 SQL)로 만들었다.",
  limits: "복지 정답은 같은 원자료 DB에서 나온 것으로, 보건복지부 원문 문서와의 대조는 아니다. 운영(Workers) 환경 결과가 아니다.",
  total: results.length, passed: results.filter((result) => result.pass).length, by_category: byCategory,
  latency_ms: { p50: results.map((r) => r.ms).sort((a, b) => a - b)[Math.floor(results.length / 2)], p95: results.map((r) => r.ms).sort((a, b) => a - b)[Math.floor(results.length * 0.95)] },
  results,
};
mkdirSync(new URL("../../docs/acceptance/", import.meta.url), { recursive: true });
writeFileSync(new URL("../../docs/acceptance/results-" + asOf + ".json", import.meta.url), JSON.stringify(summary, null, 2));
console.log(JSON.stringify({ total: summary.total, passed: summary.passed, by_category: byCategory, latency: summary.latency_ms }));
for (const result of results.filter((r) => !r.pass)) console.log("FAIL", result.id, result.question, "-", result.detail);

