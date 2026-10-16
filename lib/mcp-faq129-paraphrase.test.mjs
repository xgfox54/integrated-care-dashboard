import assert from "node:assert/strict";
import test from "node:test";

import { database, NOW } from "./press-test-support.mjs";
import { searchFaq129 } from "./mcp/faq129.ts";
import { queryConcepts } from "./mcp/faq129-expansion.ts";
import { refineWelfareQuery } from "./mcp/query-refiner.ts";
import { assessAnswerability } from "./mcp/search-support.ts";

const search = (db, query, limit = 5) => searchFaq129(db, refineWelfareQuery(query, { currentYear: 2026 }), { limit, nowMs: NOW * 1000 });

test("everyday wording is stemmed and mapped to administrative terms", () => {
  const stems = queryConcepts("헌혈하러 가려면 남편과 둘 다 신청해야 하나요?").map((concept) => concept.stem);
  assert.ok(stems.includes("헌혈"));
  const spouse = queryConcepts("남편과 제가 둘 다 받으면 깎이나요?").flatMap((concept) => concept.variants);
  assert.ok(spouse.includes("부부") && spouse.includes("감액"));
});

test("a reworded question finds its FAQ through term expansion as a direct match", async (t) => {
  const db = database();
  t.after(() => db.sqlite.close());
  const result = await search(db, "남편과 제가 둘 다 기초연금을 타면 금액이 깎이나요?");
  const hit = result.hits.find((row) => row.id === "faq129:3485");
  assert.ok(hit, JSON.stringify(result.hits.map((row) => row.id)));
  assert.equal(hit.match_quality, "DIRECT");
});

test("similarity-only candidates are labelled related, warned and capped below supported evidence", async (t) => {
  const db = database();
  t.after(() => db.sqlite.close());
  const result = await search(db, "장애 정도를 다시 심사해 달라고 요청할 수 있나요?");
  const related = result.hits.filter((row) => row.match_quality === "RELATED");
  assert.ok(related.length > 0);
  for (const row of related) {
    assert.ok(row.score <= 50);
    assert.ok(row.warnings.some((warning) => warning.startsWith("RELATED_CANDIDATE")));
  }
  const direct = result.hits.findIndex((row) => row.match_quality === "DIRECT");
  const firstRelated = result.hits.findIndex((row) => row.match_quality === "RELATED");
  if (direct >= 0) assert.ok(direct < firstRelated, "direct matches stay ahead of related candidates");
});

test("exact source questions remain first and direct", async (t) => {
  const db = database();
  t.after(() => db.sqlite.close());
  const row = db.sqlite.prepare("SELECT faq_id, question FROM faq_129 ORDER BY faq_id LIMIT 1 OFFSET 100").get();
  const result = await search(db, row.question);
  assert.equal(result.hits[0].id, "faq129:" + row.faq_id);
  assert.equal(result.hits[0].match_quality, "DIRECT");
});

test("unrelated topics and rare unmatched subjects return no FAQ", async (t) => {
  const db = database();
  t.after(() => db.sqlite.close());
  for (const query of ["리눅스 커널 모듈 컴파일 오류", "목성 위성 궤도 계산 프로그램 설치", "운전면허 적성검사 갱신은 어디서 하나요?"]) {
    assert.deepEqual((await search(db, query)).hits.map((row) => row.id), [], query);
  }
});

test("explicit program scope still excludes other programs from related candidates", async (t) => {
  const db = database();
  t.after(() => db.sqlite.close());
  const plan = { ...refineWelfareQuery("기초연금을 방문하지 않고 온라인으로 신청할 수 있을까요?", { currentYear: 2026 }), program_scope_source: "explicit" };
  const result = await searchFaq129(db, plan, { limit: 10, nowMs: NOW * 1000 });
  assert.ok(result.hits.length > 0);
  for (const row of result.hits) assert.ok(row.programs.length === 0 || row.programs.some((program) => plan.program_scope.includes(program)), row.id);
});

test("a single common word does not make an unrelated FAQ a direct match", async (t) => {
  const db = database();
  t.after(() => db.sqlite.close());
  const result = await search(db, "제주 해녀 수당은 얼마나 받을 수 있나요?");
  assert.deepEqual(result.hits.filter((row) => row.match_quality === "DIRECT").map((row) => row.id), []);
});

test("evidence matching only fact words is not enough to support a question about an unknown subject", () => {
  const plan = refineWelfareQuery("가상의 미등록 지원제도 신청 기한은 언제인가요?", { currentYear: 2026 });
  const generic = { entity_type: "manual_section", relevance_score: 90, title: "신청 기한", excerpt: "신청은 사유 발생일부터 30일 이내에 접수합니다." };
  const missing = assessAnswerability({ plan, results: [generic], relaxed: false, legalStatus: "NOT_REQUIRED" });
  assert.notEqual(missing.answerability, "SUPPORTED");
  assert.ok(missing.reason_codes.includes("SUBJECT_NOT_FOUND"));
  const specific = assessAnswerability({ plan, results: [{ ...generic, title: "미등록 지원제도 신청 기한" }], relaxed: false, legalStatus: "NOT_REQUIRED" });
  assert.equal(specific.answerability, "SUPPORTED");
});


test("filler verb forms do not create direct matches and a rare everyday term ranks its FAQ", async (t) => {
  const db = database();
  t.after(() => db.sqlite.close());
  const abroad = await search(db, "해외에 살고 있는데 기초연금 신청을 할 수 있나요?");
  assert.ok(abroad.hits.every((row) => !row.matched_terms.includes("있는데")), JSON.stringify(abroad.hits.map((row) => row.matched_terms)));
  assert.ok(abroad.hits.slice(0, 2).some((row) => row.id === "faq129:1579"), JSON.stringify(abroad.hits.map((row) => row.id)));
  const passport = await search(db, "여권을 잃어버렸는데 재발급 비용이 얼마인가요?");
  assert.ok(passport.hits.every((row) => row.match_quality === "RELATED"), JSON.stringify(passport.hits.map((row) => [row.id, row.match_quality])));
});


test('알려진 제도명이 있어도 질문의 세부 주제가 없는 근거를 충분하다고 표시하지 않는다', () => {
  const plan = refineWelfareQuery('달 기지 거주자 생계급여 특례', { currentYear: 2026 });
  const generic = { entity_type: 'manual_section', relevance_score: 90, title: '생계급여 특례', excerpt: '생계급여 수급권자의 선정기준과 대상자 특례를 안내합니다.' };
  const missing = assessAnswerability({ plan, results: [generic], relaxed: false, legalStatus: 'NOT_REQUIRED' });
  assert.equal(missing.answerability, 'PARTIAL');
  assert.ok(missing.reason_codes.includes('INSUFFICIENT_DETAIL_EVIDENCE'));
  assert.ok(missing.coverage.unmatched_detail_terms.includes('기지'));
  const partial = assessAnswerability({ plan, results: [{ ...generic, title: '생계급여 거주자 특례' }], relaxed: false, legalStatus: 'NOT_REQUIRED' });
  assert.equal(partial.answerability, 'PARTIAL');
  assert.ok(partial.reason_codes.includes('INSUFFICIENT_DETAIL_EVIDENCE'));
  assert.ok(partial.coverage.matched_detail_terms.includes('거주자'));
  const numeric = assessAnswerability({ plan: { ...plan, detail_terms: ['40만원', '만65세'] }, results: [generic], relaxed: false, legalStatus: 'NOT_REQUIRED' });
  assert.ok(!numeric.reason_codes.includes('INSUFFICIENT_DETAIL_EVIDENCE'));
});

test('답변 본문에 있는 사실혼 진단서 예외를 제목이 일반적인 FAQ에서도 찾는다', async (t) => {
  const db = database(); t.after(() => db.sqlite.close());
  const result = await search(db, '난임 시술비 신청 때 사실혼 부부는 진단서가 없어도 되나요?');
  const hit = result.hits.find(row => row.id === 'faq129:14238');
  assert.ok(hit, JSON.stringify(result.hits.map(row => row.id)));
  assert.ok(hit.condition_checklist.some(row => row.text.includes('비용청구 전까지 진단서 별도 제출')));
});

test('급여와 연금을 함께 물으면 소득 산정에 대한 FAQ를 찾는다', async (t) => {
  const db = database(); t.after(() => db.sqlite.close());
  const result = await search(db, '생계급여를 받고 있는데 기초연금 소득 계산에 그 돈도 들어가나요?');
  assert.ok(result.hits.some(row => row.id === 'faq129:1588'), JSON.stringify(result.hits.map(row => row.id)));
});


const previouslyMissedParaphrases = [
  {
    "query": "스케일링 건강보험 적용 대상인지 어디서 확인하나요?",
    "id": "faq129:8032"
  },
  {
    "query": "가사간병 도우미로 제 남동생이 와도 되나요?",
    "id": "faq129:11697"
  },
  {
    "query": "장애인 등록을 동사무소 안 가고 인터넷으로 할 수 있나요?",
    "id": "faq129:14801"
  },
  {
    "query": "예순다섯 생일 전에 기초연금 신청서를 미리 낼 수 있나요?",
    "id": "faq129:11215"
  },
  {
    "query": "부모님 기초연금을 자녀가 대신 신청해도 되나요?",
    "id": "faq129:11394"
  },
  {
    "query": "장벽 없는 키오스크를 안 갖추면 벌금 같은 게 있나요?",
    "id": "faq129:17260"
  },
  {
    "query": "기초연금이 어떤 제도인지 설명해 주세요",
    "id": "faq129:13927"
  },
  {
    "query": "긴급생계지원 받을 때 청약통장도 금융재산에 들어가나요?",
    "id": "faq129:913"
  },
  {
    "query": "가족이 활동지원사를 하면 지원 시간이 줄어드나요?",
    "id": "faq129:14802"
  }
];

test("일상어·본문 조건·사업 별칭으로 표현한 질문에서도 해당 원문을 찾는다", async (t) => {
  const db = database(); t.after(() => db.sqlite.close());
  for (const c of previouslyMissedParaphrases) await t.test(c.query, async () => {
    const result = await search(db, c.query);
    const hit = result.hits.find(row => row.id === c.id);
    assert.ok(hit, JSON.stringify(result.hits.map(row => ({ id: row.id, title: row.title }))));
    const original = db.sqlite.prepare("SELECT answer, written_date, source_url FROM faq_129 WHERE faq_id = ?").get(c.id.slice(7));
    assert.equal(hit.condition_checklist.map(block => block.text).join("\n\n").replace(/\r\n/g, "\n"), original.answer.replace(/\r\n/g, "\n"));
    assert.equal(hit.written_date, original.written_date);
    assert.equal(hit.url, original.source_url);
    if (hit.match_quality === "RELATED") {
      assert.ok(hit.score <= 50);
      assert.ok(hit.warnings.some(warning => warning.startsWith("RELATED_CANDIDATE")));
    }
  });
});
