// MCP 검색·조회 품질 평가 세트 v2 생성(작업지시서 2026-10-14 §3-3). 공식 원문 행에서 문항과 정답 기준을 만들고 버전·해시를 남긴다.
// 실행: node scripts/mcp/build-eval-v2.mjs  → quality/mcp-eval-v2-20261014.json
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { readMohwSeed } from "../../lib/mohw-seed.ts";
import { STATISTICS_DATASETS } from "../../lib/statistics/catalog.ts";

let state = 20261014;
const random = () => ((state = (state * 1103515245 + 12345) % 2147483648) / 2147483648);
const pick = (list, count) => { const copy = [...list]; const out = []; while (copy.length && out.length < count) out.push(copy.splice(Math.floor(random() * copy.length), 1)[0]); return out; };
const amounts = (text) => [...new Set((text.match(/\d[\d,]*(?:\.\d+)?\s*(?:만\s*)?(?:천원|백만원|만원|원)/g) ?? []).map((value) => value.replace(/\s+/g, "")))].slice(0, 3);
const markers = (text) => ({ exception: /다만|제외|예외|해당하지 않|불가/.test(text), and_or: /및|또는|모두|중 하나|이상/.test(text) });
const cases = [];
const add = (domain, tool, args, gold, criteria) => cases.push({ id: "V2-" + String(cases.length + 1).padStart(3, "0"), domain, tool, args, gold, criteria });

const faq = JSON.parse(readFileSync("data/faq129/faq129.json", "utf8")).items.filter((item) => item.answer.length > 80 && item.answer.length < 1500);
for (const item of pick(faq, 20)) {
  const mark = markers(item.answer);
  add("129 FAQ", "search_faq", { query: item.question.replace(/^\([^)]*\)\s*/, ""), limit: 5 }, { faq_id: "faq129:" + item.faq_id, amounts: amounts(item.answer), ...mark },
    ["검색 적합성", "원문 인용 정확도", ...(amounts(item.answer).length ? ["금액·단위"] : []), ...(mark.exception ? ["예외사항"] : []), ...(mark.and_or ? ["AND/OR"] : []), "기간·적용연도"]);
}
const manual = JSON.parse(readFileSync("quality/manual_faq_20261013.json", "utf8")).items.filter((item) => item.acceptable_documents?.length && item.reference_answer?.length > 60);
for (const item of pick(manual, 15)) {
  add("복지 매뉴얼", "search_manuals", { query: item.raw_question, limit: 5 }, { documents: item.acceptable_documents.map((name) => name.replace(/\.md$/, "")), expected_year: item.expected_year ?? null, amounts: amounts(item.reference_answer), ...markers(item.reference_answer) },
    ["검색 적합성", "원문 인용 정확도", "기간·적용연도", ...(amounts(item.reference_answer).length ? ["금액·단위"] : []), "대상자 조건"]);
}
const seed = readMohwSeed();
const services = seed.documents.flatMap((entry) => entry.services.map((service) => ({ ...service, title: entry.document.title }))).filter((service) => service.name.length >= 4 && service.sigungu && service.sigungu !== service.sido);
for (const service of pick(services, 15)) {
  add("통합돌봄 사업", "find_programs", { query: service.name, region_id: "region:" + (service.sido === "광주광역시" || service.sido === "전라남도" ? "전남광주통합특별시" : service.sido) + "|" + service.sigungu, limit: 10 }, { title: service.name, service_id: service.serviceId }, ["검색 적합성", "대상자 조건"]);
}
const jeju = seed.documents.find((entry) => entry.document.province === "제주특별자치도");
for (const service of pick(jeju?.services ?? [], 3)) add("통합돌봄 사업", "find_programs", { query: service.name, region_id: "region:제주특별자치도", limit: 10 }, { title: service.name }, ["검색 적합성"]);
const catalog = JSON.parse(readFileSync("public/data/welfare100/index-lite.json", "utf8"));
const nameIndex = catalog.fields.indexOf("n");
const catalogRows = catalog.items.map((row) => String(row[nameIndex] ?? "")).filter((name) => name.length >= 4 && name.length <= 30);
for (const name of pick(catalogRows, 15)) add("복지제도100", "search_welfare_services", { query: name, limit: 10 }, { title: name }, ["검색 적합성", "대상자 조건"]);
for (const dataset of pick(STATISTICS_DATASETS.filter((entry) => entry.title.length >= 4), 15)) {
  add("복지통계", "search_statistics", { query: dataset.title, limit: 10 }, { title: dataset.title, statistics_id: dataset.id, unit: dataset.original_unit ?? null, periods: dataset.periods?.slice(-1) ?? [] }, ["검색 적합성", "금액·단위", "기간·적용연도"]);
}
const SGW = "region:제주특별자치도|서귀포시";
for (const [query, extra] of [["통합돌봄", {}], ["노인 맞춤 돌봄", {}], ["장애인 활동지원", {}], ["기초연금", {}], ["치매", {}], ["돌봄", { region_ids: [SGW] }], ["복지", { date_from: "2026-09-01" }], ["긴급복지", {}], ["아동수당", {}], ["의료급여", {}]]) {
  add("공식 보도자료", "search_news", { query, limit: 5, ...extra }, { title_contains: query.split(" ")[0] }, ["검색 적합성", "기간·적용연도"]);
}
for (const [args, title] of [[{ fiscal_year: 2026, mode: "integrated_care", region_id: "region:제주특별자치도", query: "통합돌봄", limit: 5 }, "통합돌봄"], [{ fiscal_year: 2026, mode: "integrated_care", region_id: SGW, limit: 5 }, ""], [{ fiscal_year: 2026, mode: "integrated_care", region_id: "region:서울특별시|중랑구", limit: 5 }, ""], [{ fiscal_year: 2026, mode: "integrated_care", region_id: "region:부산광역시|해운대구", limit: 5 }, ""], [{ fiscal_year: 2025, mode: "integrated_care", region_id: "region:제주특별자치도", limit: 5 }, ""]]) {
  add("예산·집행액", "find_budget_projects", args, { title_contains: title, safe_amounts: true, explicit_unavailable_ok: !title }, ["검색 적합성", "금액·단위", "기간·적용연도"]);
}
for (const [tool, args] of [
  ["search_faq", { query: "화성 이주민 우주정착 지원금 신청", limit: 5 }], ["search_manuals", { query: "달 기지 거주자 생계급여 특례", limit: 5 }],
  ["find_programs", { query: "존재하지않는우주돌봄사업", region_id: "region:제주특별자치도", limit: 5 }], ["search_welfare_services", { query: "존재하지않는우주여행지원금", limit: 5 }],
  ["search_statistics", { query: "존재하지않는은하계복지지표", limit: 5 }], ["search_news", { query: "존재하지않는우주여행지원금", limit: 5 }],
  ["search_faq", { query: "2031년 기초연금 선정기준액", limit: 5 }], ["find_budget_projects", { fiscal_year: 2031, mode: "integrated_care", region_id: "region:제주특별자치도", limit: 5 }],
  ["search", { query: "2031년 생계급여 4인 가구 금액" }], ["search", { query: "존재하지않는우주돌봄 제도의 신청 기한" }],
]) add("미확인 정보", tool, args, { expect_no_confident_answer: true }, ["미확인 정보"]);
const body = JSON.stringify(cases);
const suite = { version: "mcp-eval-v2-20261014", created_at: "2026-10-14", sha256: createHash("sha256").update(body).digest("hex"), case_count: cases.length,
  layers: { mcp_retrieval: "이 세트가 측정(도구가 올바른 원문을 반환하는지)", ai_answer: "별도(quality/faq-test-suite.json, 129 FAQ 788문항 실제 답변 평가)와 같은 문항 ID로 비교" },
  criteria: ["검색 적합성", "원문 인용 정확도", "대상자 조건", "금액·단위", "기간·적용연도", "AND/OR", "예외사항", "미확인 정보"], cases };
writeFileSync("quality/mcp-eval-v2-20261014.json", JSON.stringify(suite, null, 1) + "\n");
const byDomain = cases.reduce((map, entry) => { map[entry.domain] = (map[entry.domain] ?? 0) + 1; return map; }, {});
console.log(suite.case_count, JSON.stringify(byDomain), suite.sha256.slice(0, 12));

