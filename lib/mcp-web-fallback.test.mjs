import assert from "node:assert/strict";
import test from "node:test";
import { refineWelfareQuery } from "./mcp/query-refiner.ts";
import { webSearchFallback } from "./mcp/search-support.ts";

test("missing evidence routes to official web search while preserving region and excluded years", () => {
  const plan = refineWelfareQuery("2025년 자료는 빼고 2026년 서귀포시 온정가게 지원대상을 알려줘", { currentYear: 2026 });
  const result = webSearchFallback(plan, { answerability: "INSUFFICIENT", reason_codes: ["COVERAGE_GAP"] });
  assert.equal(result.next_action, "WEB_SEARCH_OFFICIAL");
  assert.equal(result.constraints.region_id, "region:제주특별자치도|서귀포시");
  assert.deepEqual(result.constraints.excluded_years, [2025]);
  assert.deepEqual(result.constraints.requested_years, [2026]);
  assert.ok(result.queries.some(query => query.includes("서귀포시") && query.endsWith("site:go.kr")));
  assert.equal(result.performed_by, "HOST_ASSISTANT");
  assert.equal(result.database_write, false);
});

test("partial candidates require details before falling back to the web", () => {
  const plan = refineWelfareQuery("기초연금 신청서류", { currentYear: 2026 });
  const result = webSearchFallback(plan, { answerability: "PARTIAL", reason_codes: ["MISSING_DOCUMENT"] });
  assert.equal(result.next_action, "READ_MCP_DETAILS_THEN_WEB_IF_NEEDED");
});

test("supported candidates retain the MCP detail reading path", () => {
  const result = webSearchFallback(refineWelfareQuery("기초연금 신청서류"), { answerability: "SUPPORTED", reason_codes: [] });
  assert.equal(result.next_action, "READ_MCP_DETAILS");
});

test("empty or contradictory questions require clarification instead of fabricated web queries", () => {
  for (const [query, codes] of [["알려주세요", ["NO_USABLE_SEARCH_TERMS"]], ["2026년 기초연금", ["CONFLICTING_CONSTRAINTS"]]]) {
    const result = webSearchFallback(refineWelfareQuery(query), { answerability: "INSUFFICIENT", reason_codes: codes });
    assert.equal(result.next_action, "CLARIFY_QUERY");
    assert.deepEqual(result.queries, []);
  }
});

test("legal gaps provide an official source without requiring withheld MCP law tools", () => {
  const result = webSearchFallback(refineWelfareQuery("노인복지법 요양보호사 결격사유"), { answerability: "PARTIAL", reason_codes: ["LEGAL_SOURCE_DISABLED"] });
  assert.ok(result.queries.some(query => query.endsWith("site:law.go.kr")));
  assert.ok(result.preferred_sources.some(source => source.url === "https://www.law.go.kr"));
});

test("a region-only catalog gap can search the local government without another question", () => {
  const result = webSearchFallback(refineWelfareQuery("서귀포시"), { answerability: "INSUFFICIENT", reason_codes: ["COVERAGE_GAP"] });
  assert.equal(result.next_action, "WEB_SEARCH_OFFICIAL");
  assert.ok(result.queries.some(query => query.includes("서귀포시") && query.endsWith("site:go.kr")));
});
