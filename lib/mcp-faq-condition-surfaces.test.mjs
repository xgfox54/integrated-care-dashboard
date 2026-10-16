import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { database } from "./press-test-support.mjs";
import { McpData } from "./mcp/data.ts";
import { handleMcpRequest } from "./mcp/server.ts";
const hash = value => createHash("sha256").update(value).digest("hex");

async function call(db, name, args) {
  const response = await handleMcpRequest(new Request("https://dashboard.example/mcp", {
    method: "POST", headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }),
  }), new McpData(db, async () => new Map()), (error) => { throw error; }, { includeLaw: false });
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.ok(body.result, JSON.stringify(body));
  return body.result;
}
const search = async (db, query) => {
  const result = await call(db, "search", { query });
  assert.equal(result.isError, undefined, JSON.stringify(result.structuredContent ?? result.content));
  return result.structuredContent;
};
const conditionEvidence = text => {
  const prefix = 'FAQ_CONDITION_EVIDENCE: ';
  const line = text.split('\n').find(line => line.startsWith(prefix));
  assert.ok(line);
  return JSON.parse(line.slice(prefix.length));
};

test('MCP search finds the corrected spelling while preserving the official FAQ title', async () => {
  // Given
  const db = database();
  const source = db.sqlite.prepare("SELECT question FROM faq_129 WHERE faq_id='16740'").get();
  try {
    // When
    const result = await search(db, source.question.replace('긴급셍계지원', '긴급생계지원'));
    // Then
    const hit = result.results.find(item => item.id === 'faq129:16740');
    assert.ok(hit);
    assert.ok(hit.title.includes(source.question));
  } finally { db.sqlite.close(); }
});

for (const [faqId, missingCondition] of [
  ["7170", /정액검사•배란기능•자궁강 및 난관검사 결과 의학적 소견상 모두 정상/],
  ["14238", /아포스티유 또는 영사확인을 거친 후 필요시 공증 및 번역/],
  ["13140", /ABR을 안전하게 시행할 수 있고, 2\)연령에 맞는 언어발달 검사와 언어치료가 모두 가능한/],
  ["10734", /실제 생계가 곤란하여 필요하다고 시군구청장이 인정하는 경우/],
  ["14013", /실제 생계곤란하여 보호가 필요하다고 시군구청장이 인정하는 경우/],
  ["6334", /활동지원서비스를 우선 활용\(만 65세 미만의 의료급여 수급자 중 장기입원 사례관리 퇴원자 제외\)/],
]) {
  test("FAQ text and structured evidence agree through all MCP tools: " + faqId, async () => {
    const db = database();
    const original = db.sqlite.prepare("SELECT question, answer, content_sha256 FROM faq_129 WHERE faq_id = ?").get(faqId);
    const id = "faq129:" + faqId;
    const detail = (await call(db, "get_faq", { id })).structuredContent;
    const fetched = (await call(db, "fetch", { id })).structuredContent;
    const direct = (await call(db, "search_faq", { query: original.question })).structuredContent.results.find((hit) => hit.id === id);
    const unified = (await search(db, original.question)).results.find((hit) => hit.id === id);
    for (const [surface, payload] of [["get_faq", detail], ["fetch", fetched.metadata], ["search_faq", direct], ["search", unified]]) {
      assert.ok(payload, surface + " must return the source FAQ");
      assert.ok(payload.condition_checklist?.length, surface + " drops the source condition checklist");
      assert.deepEqual(payload.condition_checklist.map((block) => block.text), original.answer.split(/\r?\n[\t ]*\r?\n+/).filter((block) => block.trim()));
      assert.deepEqual(payload.structured_conditions, detail.structured_conditions);
      assert.deepEqual(payload.answer_criteria.scope_constraints, detail.structured_conditions.scope_constraints);
      assert.deepEqual(payload.answer_criteria.warning_markers, detail.structured_conditions.warning_markers);
      assert.equal(payload.answer_criteria.citation_footer.source_url, detail.url);
      assert.equal(payload.answer_criteria.citation_footer.written_date, detail.written_date);
      assert.match(payload.condition_checklist.map((block) => block.text).join("\n\n"), missingCondition);
    }
    assert.equal(detail.answer, original.answer);
    assert.equal(detail.content_sha256, original.content_sha256);
    assert.equal(fetched.metadata.content_sha256, original.content_sha256);
    for (const text of [detail.text, fetched.text]) {
      const evidence = conditionEvidence(text);
      assert.equal(evidence.source_content_sha256, original.content_sha256);
      const citationLine = text.split('\n').find(line => line.startsWith('ANSWER_SOURCE_CITATION: '));
      assert.ok(citationLine);
      assert.deepEqual(JSON.parse(citationLine.slice('ANSWER_SOURCE_CITATION: '.length)), detail.answer_criteria.citation_footer);
      assert.equal(evidence.verification_status, 'SOURCE_REVIEWED');
      assert.deepEqual(evidence.rules, detail.structured_conditions.rules.map(({ source_quote, ...rule }) => rule));
      assert.deepEqual(evidence.scope_constraints, detail.structured_conditions.scope_constraints.map(({ source_quote, ...scope }) => scope));
      assert.deepEqual(evidence.warning_markers, detail.structured_conditions.warning_markers);
    }
  });
}

test('FAQ text removes stale reviewed assertions', async () => {
  // Given
  const db = database();
  const answer = '새로운 안내: A, B가 적용되지 아니한 경우\n\n| 구분 | 기준 |';
  db.sqlite.prepare("UPDATE faq_129 SET answer=?, content_sha256=? WHERE faq_id='7170'").run(answer, hash(answer));
  try {
    // When
    const responses = await Promise.all(['get_faq', 'fetch'].map(name => call(db, name, { id: 'faq129:7170' })));
    // Then
    for (const response of responses) {
      const detail = response.structuredContent;
      const evidence = conditionEvidence(detail.text);
      assert.equal(evidence.verification_status, 'UNREVIEWED');
      assert.equal(evidence.source_content_sha256, hash(answer));
      assert.deepEqual(evidence.rules, []);
      assert.deepEqual(evidence.scope_constraints, []);
      assert.deepEqual(evidence.warning_markers.map(warning => warning.code), ['CONDITION_REVIEW_STALE']);
      assert.ok(detail.text.includes(answer));
    }
  } finally { db.sqlite.close(); }
});
