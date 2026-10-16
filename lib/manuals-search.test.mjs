import assert from "node:assert/strict";
import test from "node:test";
import { getManualSection, relatedManualApplicationSections, searchManualSections } from "./manuals/search.ts";
import { activate, document, manualDatabase, pack, section } from "./manuals-test-support.mjs";

test("proxy eligibility includes nearby source documents and online limits without crossing original files", async () => {
  const db = manualDatabase();
  try {
    const rows = [
      section({ section_id: "proxy", title: "대리인 신청", content: "자녀는 대리 신청할 수 있다.", start_line: 100, end_line: 110 }),
      section({ section_id: "documents", ordinal: 1, title: "신청 구비서류", content: "필수 제출서류: 수급희망자와 대리인의 신분증, 위임장", start_line: 130, end_line: 140 }),
      section({ section_id: "online", ordinal: 2, content: "온라인 대리신청은 주소가 같은 자녀로 제한", start_line: 120, end_line: 125 }),
      section({ section_id: "different-original", ordinal: 3, original_name: "2026 다른 제도.pdf", content: "필수 제출서류: 다른 규정", start_line: 115, end_line: 118 }),
      section({ section_id: "distant", ordinal: 4, content: "필수 제출서류: 다른 사업", start_line: 2000, end_line: 2010 }),
      section({ section_id: "other-document", document_id: "other", content: "필수 제출서류: 다른 문서", start_line: 119, end_line: 120 }),
    ];
    await activate(db, pack({ documents: [document({ section_count: 5 }), document({ document_id: "other", source_name: "다른 문서.md", source_path: "source-md/other.md" })], sections: rows }));
    const primary = await getManualSection(db, "manual:fixture-v1:proxy");
    const related = await relatedManualApplicationSections(db, primary);
    assert.deepEqual(related.map((item) => item.section_id), ["documents", "online"]);
    assert.match(related[0].text, /수급희망자와 대리인의 신분증/);
    assert.equal(related[0].sources[0].location.start_line, 130);
    assert.equal(related[0].revision, primary.revision);
    assert.deepEqual(await relatedManualApplicationSections(db, { ...primary, offset: 1 }), []);
    assert.deepEqual(await relatedManualApplicationSections(db, { ...primary, sources: [{ ...primary.sources[0], original_name_basis: "mixed_original_files" }] }), []);
  } finally { db.sqlite.close(); }
});

test("related procedure excerpts remain bounded and allow exact continuation", async () => {
  const db = manualDatabase();
  try {
    const content = "필수 제출서류\n" + "서류💛".repeat(2000);
    const rows = [section({ section_id: "proxy", title: "대리인 신청" }), ...Array.from({ length: 5 }, (_, ordinal) => section({ section_id: "docs-" + ordinal, ordinal: ordinal + 1, content, start_line: 40 + ordinal, end_line: 41 + ordinal }))];
    await activate(db, pack({ documents: [document({ section_count: rows.length })], sections: rows }));
    const primary = await getManualSection(db, "manual:fixture-v1:proxy");
    const related = await relatedManualApplicationSections(db, primary);
    assert.equal(related.length, 3);
    for (const item of related) {
      assert.equal(item.returned_chars, 3000);
      assert.equal(item.truncated, true);
      const rest = await getManualSection(db, item.id, { offset: item.next_offset });
      assert.equal(item.text + rest.text, content);
    }
  } finally { db.sqlite.close(); }
});

test("multiple document sections cannot crowd out a nearby online restriction", async () => {
  const db = manualDatabase();
  try {
    const rows = [section({ section_id: "proxy", title: "대리인 신청" }),
      ...Array.from({ length: 4 }, (_, ordinal) => section({ section_id: "docs-" + ordinal, ordinal: ordinal + 1, content: "필수 제출서류 확인", start_line: 31 + ordinal, end_line: 32 + ordinal })),
      section({ section_id: "online", ordinal: 5, content: "온라인 대리신청 제한", start_line: 40, end_line: 45 })];
    await activate(db, pack({ documents: [document({ section_count: rows.length })], sections: rows }));
    const primary = await getManualSection(db, "manual:fixture-v1:proxy");
    assert.deepEqual((await relatedManualApplicationSections(db, primary)).map((item) => item.section_id), ["docs-0", "online", "docs-1"]);
  } finally { db.sqlite.close(); }
});

test("an explicit other-city query excludes Seogwipo manuals while national sources remain", async () => {
  const db = manualDatabase();
  const docs = [document({ jurisdiction: "seogwipo", section_count: 1 }), document({ document_id: "national", source_name: "2026 전국 기초연금.md", source_path: "source-md/national.md", jurisdiction: "national" })];
  const rows = [section({ title: "온정가게 운영", original_name: "2026 온정가게.pdf", content: "온정가게는 지역의 참여 업체에서 서비스를 제공합니다." }), section({ document_id: "national", section_id: "national", title: "기초연금 신청", content: "기초연금 신청은 주민센터에서 안내받을 수 있습니다." })];
  await activate(db, pack({ documents: docs, sections: rows }));
  assert.equal((await searchManualSections(db, "서귀포시 온정가게")).length, 1);
  assert.deepEqual(await searchManualSections(db, "제주시 온정가게"), []);
  assert.deepEqual(await searchManualSections(db, "제주시만 온정가게"), []);
  assert.deepEqual(await searchManualSections(db, "부산 온정가게"), []);
  assert.equal((await searchManualSections(db, "제주시 기초연금")).some((hit) => hit.section_id === "national"), true);
  db.sqlite.close();
});

test("excluded short section years override newer filenames without discarding mixed-year or timeless sections", async () => {
  const db = manualDatabase();
  const titles = ["☐ 25년 국민기초생활보장 사업안내에 따른 최저생계비(생계급여) 기준", "2025년 생계급여 기준", "2026년 생계급여 금액", "2025년과 2026년 생계급여 금액 비교", "생계급여 신청 방법"];
  const rows = titles.map((title, ordinal) => section({ ordinal, section_id: "year-" + ordinal, start_line: 20 + ordinal * 20, end_line: 30 + ordinal * 20, title, heading_path: title, original_name: "2026 국민기초생활보장 안내.pdf", content: title + "\n생계급여 기준 금액과 신청 방법을 확인합니다." }));
  await activate(db, pack({ documents: [document({ section_count: rows.length })], sections: rows }));
  const hits = await searchManualSections(db, "2025년 자료는 제외하고 2026년 생계급여 금액");
  assert.deepEqual(hits.map((hit) => hit.section_id).sort(), ["year-2", "year-3", "year-4"]);
  db.sqlite.close();
});

test("Korean fulltext ignores spacing, promotes explicit subtitles before the candidate limit, and emits source locators", async () => {
  const db = manualDatabase();
  const rows = Array.from({ length: 130 }, (_, ordinal) => section({ ordinal, section_id: "generic-" + ordinal, title: "기초연금 사업 소개", content: "기초연금 소득 조사를 위한 일반 안내입니다." }));
  rows.push(section({ ordinal: 130, section_id: "specific", title: "근로 소득 공제액", heading_path: "기초연금 > 근로 소득 공제액", content: "근로소득 공제액은 본문의 표와 각주를 함께 확인합니다." }));
  await activate(db, pack({ documents: [document({ section_count: rows.length })], sections: rows }));
  const hits = await searchManualSections(db, "기초 연금 근로소득 공제액", { limit: 5 });
  assert.equal(hits[0].section_id, "specific");
  assert.ok(hits[0].score >= 180 && hits[0].score <= 235);
  assert.equal(hits[0].entity_type, "manual_section");
  assert.match(hits[0].id, /^manual:fixture-v1:/);
  assert.match(hits[0].sources[0].url, /\/-\/blob\/a{40}\/source-md\/.*#L20-30$/);
  assert.equal(hits[0].sources[0].url_kind, "repository_parsed_copy");
  assert.ok(Array.from(hits[0].excerpt).length <= 282);
  db.sqlite.close();
});

test("the source question survives the candidate limit ahead of incidental keyword matches", async () => {
  const db = manualDatabase();
  try {
    const question = "기초연금 대리인 신청 때 위임장과 신분증은 어디에 제출하나요?";
    const rows = Array.from({ length: 130 }, (_, ordinal) => section({ ordinal, section_id: "incidental-" + ordinal, title: "기초연금 신청서류", content: "기초연금 대리인 신청 위임장 신분증 제출 안내를 확인합니다." }));
    rows.push(section({ ordinal: 130, section_id: "question", title: "사업 질의응답", content: question + "\n수급희망자와 대리인 서류를 구분해 접수합니다." }));
    await activate(db, pack({ documents: [document({ section_count: rows.length })], sections: rows }));
    const hits = await searchManualSections(db, question, { limit: 5 });
    assert.equal(hits[0]?.section_id, "question");
  } finally { db.sqlite.close(); }
});

test("two-character Korean subjects remain searchable and arbitrary FTS grammar never executes", async () => {
  const db = manualDatabase();
  await activate(db, pack({ documents: [document({ source_name: "2026 자활 사업안내.md" })], sections: [section({ title: "자활 참여", original_name: "2026 자활 지침.pdf", heading_path: "자활 > 참여 기준", service_names: "자활", content: "자활 참여자의 소득 확인" })] }));
  assert.equal((await searchManualSections(db, "자활")).length, 1);
  assert.deepEqual(await searchManualSections(db, '없는가상용어xyz" OR "*'), []);
  assert.deepEqual(await searchManualSections(db, "알려주세요"), []);
  db.sqlite.close();
});

test("free case details survive question endings and user-provided days are never required source facts", async () => {
  const db = manualDatabase();
  const rows = Array.from({ length: 110 }, (_, ordinal) => section({ ordinal, section_id: "ordinary-" + ordinal, title: "생계급여 일반 안내", heading_path: "생계급여", service_names: "생계급여 의료급여", content: "생계급여 의료급여를 안내합니다." }));
  rows.push(section({ ordinal: 110, section_id: "inpatient", title: "장기 입원 수급자의 식비 공제", heading_path: "생계급여 > 입원 식비", service_names: "생계급여", original_name: "2026 국민기초생활보장 안내.pdf", content: "생계급여 장기입원 식비 공제는 의료급여 본문과 함께 확인합니다. 기간은 실제 기록으로 검토합니다." }));
  await activate(db, pack({ documents: [document({ source_name: "2026 생계급여 의료급여 합본.md", section_count: rows.length })], sections: rows }));
  const hits = await searchManualSections(db, "생계급여 의료급여를 함께 받는데 45일 입원했을 때 생계급여 공제 기준", { limit: 5 });
  assert.equal(hits[0].section_id, "inpatient");
  assert.ok(!hits[0].excerpt.includes("45일"));
  db.sqlite.close();
});

test("declarative Korean endings preserve different case nouns without a question-specific alias", async () => {
  const db = manualDatabase();
  const rows = [
    section({ section_id: "ordinary", ordinal: 0, title: "기초연금 소득 재산", content: "기초연금 소득 재산 일반 안내입니다." }),
    section({ section_id: "admission", ordinal: 1, title: "입원 사실 확인", heading_path: "기초연금 > 입원", content: "기초연금 입원 사실은 관련 기록으로 확인합니다." }),
    section({ section_id: "divorce", ordinal: 2, title: "이혼 사실 확인", heading_path: "기초연금 > 이혼", content: "기초연금 이혼 사실은 관련 기록으로 확인합니다." }),
    section({ section_id: "discharge", ordinal: 3, title: "퇴원 사실 확인", heading_path: "기초연금 > 퇴원", content: "기초연금 퇴원 사실은 관련 기록으로 확인합니다." }),
  ];
  await activate(db, pack({ documents: [document({ section_count: rows.length })], sections: rows }));
  for (const [noun, id] of [["입원", "admission"], ["이혼", "divorce"], ["퇴원", "discharge"]]) {
    for (const ending of ["했습니다", "하였습니다", "합니다", "했어요", "하였어요", "했는데요"]) {
      const hits = await searchManualSections(db, `기초연금 수급자가 ${noun}${ending}. 확인할 정보를 알려주세요.`, { limit: 1 });
      assert.equal(hits[0]?.section_id, id, noun + ending);
    }
  }
  const excluded = await searchManualSections(db, "기초연금 입원은 말고 퇴원했습니다. 확인할 정보를 알려주세요.", { limit: 1 });
  assert.equal(excluded[0]?.section_id, "discharge");
  db.sqlite.close();
});

test("numeric scenario conditions cannot affect ranking through raw, refiner, subservice or core inputs", async () => {
  const db = manualDatabase();
  const rows = [
    section({ section_id: "correct", ordinal: 0, title: "생계급여 입원 공제", heading_path: "생계급여 > 입원", content: "생계급여 입원 공제는 기록을 확인합니다." }),
    section({ section_id: "numbers", ordinal: 1, title: "생계급여 3개월 45일 20세 50대 3인가구 100만원 2회 9월 이후", heading_path: "생계급여 > 3개월 > 45일", content: "생계급여 신고 업무는 3개월 45일 20세 50대 3인가구 100만원 2회와 관련한 별도 예시입니다." }),
  ];
  await activate(db, pack({ documents: [document({ source_name: "2026 생계급여 안내.md", section_count: rows.length })], sections: rows }));
  const raw = "생계급여 입원했습니다. 공제 정보를 알려주세요.";
  const base = { raw_query: raw, search_tokens: ["생계급여"], programs: ["생계급여"], search_queries: ["생계급여"] };
  const conditions = ["3개월", "45일", "20세", "50대", "3인가구", "100만원", "2회", "9월이후"];
  const expected = (await searchManualSections(db, base)).map(({ section_id, score }) => ({ section_id, score }));
  assert.equal(expected[0]?.section_id, "correct");
  for (const extras of [
    { raw_query: raw + " " + conditions.join(" ") },
    { detail_terms: conditions },
    { subservices: conditions },
    { search_tokens: ["생계급여", ...conditions], programs: [], search_queries: [] },
  ]) {
    const actual = (await searchManualSections(db, { ...base, ...extras })).map(({ section_id, score }) => ({ section_id, score }));
    assert.deepEqual(actual, expected, JSON.stringify(extras));
  }
  db.sqlite.close();
});

test("a monetary confirmation question promotes amount evidence without requiring the user's assumed amount", async () => {
  const db = manualDatabase();
  const rows = [
    section({ section_id: "cover", ordinal: 0, title: "긴급복지 사업 안내", heading_path: "긴급복지", original_name: "2026 긴급복지 안내.pdf", content: "긴급복지 소개입니다." }),
    section({ section_id: "amount", ordinal: 1, title: "지원금액 지원기준", heading_path: "긴급복지 > 생계지원", original_name: "2026 긴급복지 안내.pdf", content: "생계지원 금액은 가구원수별 지원기준 표에서 확인합니다." }),
  ];
  await activate(db, pack({ documents: [document({ source_name: "2026 긴급복지 안내.md", section_count: rows.length })], sections: rows }));
  for (const query of ["2026년 긴급복지 4인가구가 200만원 맞죠?", "2026년 긴급복지 1인가구가 80만원 맞나요?"]) {
    assert.equal((await searchManualSections(db, query, { limit: 1 }))[0]?.section_id, "amount");
  }
  db.sqlite.close();
});

test("an unregistered rare subject is required before LIMIT while common application words cannot fill results", async () => {
  const db = manualDatabase();
  const rows = Array.from({ length: 130 }, (_, ordinal) => section({ section_id: "unrelated-" + ordinal, ordinal, title: "복지시설 주민센터 접수 안내", content: "복지시설 주민센터 접수에 필요한 일반 안내입니다." }));
  rows.push(section({ section_id: "rare", ordinal: 130, title: "대리 접수", content: "마을돌봄패스 복지시설 주민센터 문의와 접수 방법입니다." }));
  rows.push(section({ section_id: "definition", ordinal: 131, title: "신분 분류", content: "임시체류자는 이 명부에서 구분한 용어입니다." }));
  await activate(db, pack({ documents: [document({ section_count: rows.length })], sections: rows }));
  const hits = await searchManualSections(db, {
    raw_query: "마을돌봄패스에 복지시설에서 주민센터로 접수하려면 안내를 알려주세요.",
    search_tokens: ["마을돌봄패스에", "복지시설에서", "주민센터로"], programs: [],
  }, { limit: 5 });
  assert.deepEqual(hits.map((row) => row.section_id), ["rare"]);
  // A lone subject definition does not establish an unrelated application procedure.
  const absent = await searchManualSections(db, {
    raw_query: "임시체류자 복지시설 주민센터 접수 안내",
    search_tokens: ["임시체류자", "복지시설", "주민센터"], programs: [],
  }, { limit: 5 });
  assert.deepEqual(absent, []);
  db.sqlite.close();
});

test("longer document nouns survive short core words and procedural verbs do not become rare anchors", async () => {
  const db = manualDatabase();
  const rows = [
    section({ section_id: "context", ordinal: 0, title: "공모사업 안내", content: "공모사업 수급 여부를 요구하는 일반 안내입니다." }),
    section({ section_id: "certificate", ordinal: 1, title: "수급자증명서 발급", content: "수급자증명서는 수급 자격을 표시하는 증명서입니다." }),
    section({ section_id: "pass", ordinal: 2, title: "방문출입표지 발급", content: "방문출입표지 발급은 서류를 제출하여 확인합니다." }),
    section({ section_id: "verb", ordinal: 3, title: "다른 문답", content: "이것을 발급받으려면 어디로 제출하나요?" }),
  ];
  await activate(db, pack({ documents: [document({ section_count: rows.length })], sections: rows }));
  const certificate = await searchManualSections(db, {
    raw_query: "공모사업에서 수급 여부를 요구합니다. 수급자증명서를 알려주세요.",
    search_tokens: ["공모사업", "수급", "여부", "요구합니다"], programs: [],
  }, { limit: 1 });
  assert.equal(certificate[0]?.section_id, "certificate");
  const pass = await searchManualSections(db, {
    raw_query: "방문출입표지를 발급받으려면 어디에 어떤 서류를 제출하나요?",
    search_tokens: ["방문출입표지", "발급받으려면", "어디에", "서류", "제출하나요"], programs: [],
  }, { limit: 1 });
  assert.equal(pass[0]?.section_id, "pass");
  db.sqlite.close();
});

test("a lone longer location word never overrides valid two-character Korean subjects", async () => {
  const db = manualDatabase();
  const rows = [
    section({ section_id: "topic", ordinal: 0, title: "장제 급여", content: "장제 급여에 관한 설명입니다." }),
    section({ section_id: "location", ordinal: 1, title: "주민센터 안내", content: "주민센터 민원 발급 안내입니다." }),
  ];
  await activate(db, pack({ documents: [document({ section_count: rows.length })], sections: rows }));
  const hits = await searchManualSections(db, { raw_query: "장제 급여 주민센터 안내", search_tokens: ["장제", "급여", "주민센터"], programs: [] });
  assert.equal(hits[0]?.section_id, "topic");
  db.sqlite.close();
});

test("a rare later sentence fragment stays a ranking signal and cannot replace the original subject", async () => {
  const db = manualDatabase();
  const rows = [
    section({ section_id: "education", ordinal: 0, title: "귀농가구 영농교육", content: "귀농가구 영농교육은 안내 본문에서 확인합니다." }),
    section({ section_id: "fragment", ordinal: 1, title: "다른 업무", content: "귀농가구 관련 다른 사항을 재확인해야 한다고 기록합니다." }),
  ];
  await activate(db, pack({ documents: [document({ section_count: rows.length })], sections: rows }));
  const hits = await searchManualSections(db, {
    raw_query: "귀농가구 영농교육 신청은 재확인해야 하나요?",
    search_tokens: ["귀농가구", "영농교육"], detail_terms: ["재확인해야"], programs: [],
  });
  assert.deepEqual(hits.map((row) => row.section_id), ["education"]);
  db.sqlite.close();
});

test("bounded BM25 relevance beats a small incidental-heading bonus before candidate truncation", async () => {
  const db = manualDatabase();
  const rows = Array.from({ length: 30 }, (_, ordinal) => section({ section_id: "unrelated-bm25-" + ordinal, ordinal, title: "다른 자료", heading_path: "일반 문서", content: "다른 주제에 관한 기록입니다." }));
  rows.push(section({ section_id: "incidental-bm25", ordinal: 30, title: "진행 순서", heading_path: "문서지원 > 주민센터", content: "문서지원 주민센터 온라인 " + "관계없는 분류 목록의 예시입니다. ".repeat(1000) }));
  rows.push(section({ section_id: "focused-bm25", ordinal: 31, title: "진행 순서", heading_path: "문서지원", content: "문서지원은 주민센터 온라인 접수처에서 확인합니다." }));
  await activate(db, pack({ documents: [document({ section_count: rows.length })], sections: rows }));
  const hits = await searchManualSections(db, {
    raw_query: "문서지원 주민센터 온라인 접수처", search_tokens: ["문서지원"], programs: ["문서지원"], search_queries: ["문서지원"],
  }, { limit: 1 });
  assert.equal(hits[0]?.section_id, "focused-bm25");
  db.sqlite.close();
});

test("explicitly excluded source editions are filtered before ranking and do not borrow the umbrella year", async () => {
  const db = manualDatabase();
  const rows = [
    section({ section_id: "old", ordinal: 0, original_name: "2025 긴급복지 QA.pdf", title: "긴급복지 생계지원 금액", content: "긴급복지 생계지원 금액 표" }),
    section({ section_id: "new", ordinal: 1, original_name: "2026 긴급복지 안내.pdf", title: "긴급복지 생계지원", content: "긴급복지 지원 기준 안내" }),
  ];
  await activate(db, pack({ documents: [document({ source_name: "2026 긴급복지 합본.md", section_count: 2 })], sections: rows }));
  const hits = await searchManualSections(db, "2025년은 제외하고 2026년 긴급복지 지원 기준");
  assert.equal(hits.length, 1);
  assert.equal(hits[0].section_id, "new");
  db.sqlite.close();
});

test("facility directories do not outrank benefit manuals for eligibility or amounts", async () => {
  const db = manualDatabase();
  const docs = [document(), document({ document_id: "directory", source_name: "2026 기초연금 시설 현황.md", authority: "index", source_role: "facility_directory" })];
  const rows = [section({ title: "기초연금 소득 금액 기준", content: "기초연금 소득인정액 기준과 금액은 안내 본문에 있습니다." }), section({ section_id: "directory-section", document_id: "directory", title: "기초연금 소득 금액 기준", content: "기초연금 소득 금액 기준 연락처 시설목록" })];
  await activate(db, pack({ documents: docs, sections: rows }));
  const hits = await searchManualSections(db, "기초연금 소득 금액 기준");
  assert.equal(hits[0].section_id, "section-one");
  assert.ok(hits[0].score - hits[1].score >= 50);
  assert.ok(hits[1].warnings.some((warning) => warning.includes("시설·기관 목록")));
  db.sqlite.close();
});

test("the named manual outranks an incidental mention and forms are promoted only when requested", async () => {
  const db = manualDatabase();
  const docs = [document({ section_count: 2 }), document({ document_id: "other", source_name: "2026 다른 복지사업 안내.md" })];
  const content = "기초연금 배우자 소득인정액 관련 기준을 설명합니다.";
  const rows = [
    section({ title: "기초연금 배우자 소득인정액", content }),
    section({ section_id: "form", ordinal: 1, title: "기초연금 배우자 소득인정액 확인서", content }),
    section({ section_id: "incidental", document_id: "other", title: "기초연금 배우자 소득인정액", original_name: "2026 다른 복지사업 안내.pdf", content }),
  ];
  await activate(db, pack({ documents: docs, sections: rows }));
  assert.equal((await searchManualSections(db, "기초연금 배우자 소득인정액"))[0].section_id, "section-one");
  assert.equal((await searchManualSections(db, "기초연금 배우자 소득인정액 확인서"))[0].section_id, "form");
  assert.equal((await searchManualSections(db, "기초연금 확인서는 말고 배우자 소득인정액"))[0].section_id, "section-one");
  db.sqlite.close();
});

test("empty and mismatched revision pins never leak active or staged sections", async () => {
  const db = manualDatabase();
  await activate(db, pack());
  assert.deepEqual(await searchManualSections(db, "기초연금", { revision: "" }), []);
  assert.equal(await getManualSection(db, "manual:fixture-v1:section-one", { revision: "" }), null);
  assert.equal(await getManualSection(db, "manual:fixture-v1:section-one", { revision: "another" }), null);
  assert.equal(await getManualSection(db, "manual:fixture-v1:../section-one"), null);
  assert.equal(await getManualSection(db, "https://example.test/document.md"), null);
  db.sqlite.close();
});

test("long HTML tables preserve all original bytes through Unicode-aware 8000-character pagination", async () => {
  const db = manualDatabase();
  const content = "<table>\r\n" + "<tr><td>가구원 😀</td><td>1,234</td></tr>\r\n".repeat(550) + "</table>\r\n각주: 파싱본 예시입니다.";
  await activate(db, pack({ sections: [section({ content })] }));
  let offset = 0, joined = "", calls = 0;
  do {
    const result = await getManualSection(db, "manual:fixture-v1:section-one", { offset, limit: 100_000 });
    assert.ok(result.returned_chars <= 8000);
    assert.equal(result.returned_chars, Array.from(result.text).length);
    assert.equal(result.image_content_available, false);
    assert.equal(result.sources[0].location.basis, "parsed_markdown_lines");
    joined += result.text;
    offset = result.next_offset;
    calls++;
  } while (offset !== null);
  assert.ok(calls > 1);
  assert.equal(joined, content);
  const after = await getManualSection(db, "manual:fixture-v1:section-one", { offset: Array.from(content).length + 100 });
  assert.equal(after.text, "");
  assert.equal(after.next_offset, null);
  db.sqlite.close();
});
test("excluded-year sections cannot return through adjacent continuation", async () => {
  const db = manualDatabase();
  const rows = [
    section({ section_id: "caption", title: "생계급여 지원금액", heading_path: "생계급여", start_line: 20, end_line: 22, original_name: "2026 생계급여.pdf", content: "[이미지]" }),
    section({ section_id: "old-adjacent", ordinal: 1, title: "25년 생계급여 지원금액", heading_path: "생계급여", start_line: 23, end_line: 30, original_name: "2026 생계급여.pdf", content: "25년 생계급여 지원금액은 765,444원으로 안내합니다. 가구별 산정 기준과 세부적인 신청 절차는 본문에서 함께 확인합니다." }),
  ];
  await activate(db, pack({ documents: [document({ section_count: 2 })], sections: rows }));
  const hits = await searchManualSections(db, "2025년 자료는 제외하고 2026년 생계급여 금액");
  assert.deepEqual(hits.map((hit) => hit.section_id), ["caption"]);
  assert.equal(hits[0].body_available, false);
  db.sqlite.close();
});
