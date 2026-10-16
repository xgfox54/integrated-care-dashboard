import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { DIRECTORY_MANUALS, JEJU_LOCAL_MANUALS, lineFingerprint, listRowMismatch, listRowRegion, manualLinkAllowed, manualLinkReview, manualLinkReviewState } from "../scripts/welfare100/manual-link-scope.mjs";
import { COMBINED_REVISION, combinedManualLines, readCorpus } from "../scripts/welfare100/manual-pages.mjs";
import { assessManualProvenance } from "./manual-link-provenance.ts";

const manualLines = combinedManualLines(readCorpus(fileURLToPath(new URL("../data/manual-corpus/assets/__manual_corpus", import.meta.url)), COMBINED_REVISION));
const lineAt = (key, line) => manualLines.get(key)?.[line - 1];

const itemsDir = new URL("../public/data/welfare100/items/", import.meta.url);
const items = readdirSync(itemsDir).filter((name) => name.endsWith(".json")).map((name) => JSON.parse(readFileSync(new URL(name, itemsDir), "utf8")));
const refsOf = (item) => (item.kind === "curated" ? item.extra.talkRefs : item.raw?.talkRefs) ?? [];
const checks = JSON.parse(readFileSync(new URL("../data/welfare100/ocr-page-checks.json", import.meta.url), "utf8")).checks;

test("서귀포시 업무자료는 제주 사업과 전국 공통 사업에만, 시설 목록은 어느 사업에도 연결하지 않는다", () => {
  assert.equal(manualLinkAllowed("38", "경상남도"), false);
  assert.equal(manualLinkAllowed("38", "제주특별자치도"), true);
  assert.equal(manualLinkAllowed("38", ""), true);
  assert.equal(manualLinkAllowed("39", "제주특별자치도"), false);
  assert.equal(manualLinkAllowed("19", "경상남도"), true);
  assert.equal(manualLinkAllowed("35", "", "WLF00000103", 9857, lineAt("35", 9857)), false, "지나가는 언급으로 확인한 연결은 뺀다");
  assert.equal(manualLinkAllowed("35", "", "WLF00000103", 100, lineAt("35", 100)), true);
  for (const item of items.filter((entry) => entry.kind === "auto")) {
    for (const ref of item.raw.talkRefs) {
      assert.ok(!DIRECTORY_MANUALS.has(ref.key), item.raw.id + " " + ref.key);
      if (JEJU_LOCAL_MANUALS.has(ref.key)) assert.ok(!item.raw.sido || item.raw.sido === "제주특별자치도", item.raw.id + " " + item.raw.sido + " " + ref.key);
    }
  }
});

test("지자체 사업 목록 표의 다른 지역 줄은 같은 이름의 사업 근거로 쓰지 않는다", () => {
  const gongju = "<tr><td>1041</td><td>충청남도</td><td>공주시</td><td>신설</td><td>공주시 신장장애인 의료비 지원 신규시책사업</td><td>협의완료</td></tr>";
  const jejuMain = "<tr><td>1015</td><td>제주특별자치도</td><td>본청</td><td>변경</td><td>중증장애인 상해보험 가입 지원</td><td>협의완료</td></tr>";
  const seoulJunggu = "<tr><td colspan=\"2\">38</td><td>서울특별시 중구</td><td>서울 중구 저소득 중증장애인 교통비 지원</td><td>유형3</td><td colspan=\"4\">2021</td></tr>";
  const nameFirst = "<tr><td>161</td><td>제주형 아이돌봄지원사업 본인부담금 지원</td><td colspan=\"4\">제주특별자치도</td></tr>";
  const gwangju = "<tr><td>12</td><td>광주광역시</td><td>북구</td><td>신설</td><td>출산축하금</td><td>협의완료</td></tr>";
  assert.deepEqual(listRowRegion(gongju), { sido: "충청남도", sigungu: "공주시" });
  assert.deepEqual(listRowRegion(jejuMain), { sido: "제주특별자치도", sigungu: "" });
  assert.deepEqual(listRowRegion(seoulJunggu), { sido: "서울특별시", sigungu: "중구" });
  assert.deepEqual(listRowRegion(nameFirst), { sido: "제주특별자치도", sigungu: "" });
  assert.equal(listRowMismatch("29", gongju, "제주특별자치도", "제주시"), true);
  assert.equal(listRowMismatch("29", gongju, "충청남도", "공주시"), false);
  assert.equal(listRowMismatch("29", jejuMain, "제주특별자치도", "서귀포시"), false, "도 본청 줄은 도내 시 사업에도 쓴다");
  assert.equal(listRowMismatch("02", seoulJunggu, "충청남도", "예산군"), true);
  assert.equal(listRowMismatch("02", seoulJunggu, "", ""), true, "전국 사업에 지자체 줄을 붙이지 않는다");
  assert.equal(listRowMismatch("02", nameFirst, "제주특별자치도", "제주시"), false);
  assert.equal(listRowMismatch("29", gwangju, "전남광주통합특별시", "북구"), false, "통합 전 시도명도 같은 지역으로 본다");
  assert.equal(listRowMismatch("11", gongju, "제주특별자치도", "제주시"), false, "목록 매뉴얼에만 적용한다");
  for (const item of items.filter((entry) => entry.kind === "auto")) {
    for (const ref of item.raw.talkRefs) assert.ok(!(ref.key === "29" && ref.excerpt?.includes("· 공주시 ·") && item.raw.sido === "제주특별자치도"), item.raw.id);
  }
});

test("OCR 쪽은 원본 화면 대조 기록이 있을 때만 대조일을 표시하고 검토 대상에서 뺀다", () => {
  const recorded = new Set(checks.map((check) => check.file + "#" + check.page));
  let checked = 0;
  for (const item of items) for (const ref of refsOf(item)) {
    const original = ref.original;
    if (!original?.ocrCheckedAt) continue;
    checked += 1;
    assert.equal(original.ocr, true);
    assert.ok(recorded.has(original.file + "#" + original.page), original.file + " " + original.page);
    assert.notEqual(assessManualProvenance(original).status, "OCR_REVIEW");
  }
  assert.ok(checks.length > 0);
  assert.ok(checked <= checks.length);
  const base = { file: "a.pdf", format: "PDF", page: 1, pages: 2, basis: "line", quote: "원문" };
  assert.equal(assessManualProvenance({ ...base, ocr: true }).status, "OCR_REVIEW");
  assert.equal(assessManualProvenance({ ...base, ocr: true, ocrCheckedAt: "2026-10-15" }).status, "PAGE_QUOTE");
  assert.equal(assessManualProvenance({ ...base, ocr: false, ocrCheckedAt: "2026-10-15" }).status, "INVALID");
});

test("원문 검수 판정은 사업 데이터에 빠짐없이 남는다", () => {
  const reviews = JSON.parse(readFileSync(new URL("../data/welfare100/manual-link-reviews.json", import.meta.url), "utf8")).decisions;
  const byId = new Map(items.map((item) => [item.kind === "curated" ? item.meta.slug : item.raw?.id, item]));
  assert.ok(reviews.length >= 290);
  for (const decision of reviews) {
    const item = byId.get(decision.item);
    assert.ok(item, decision.item);
    const refs = refsOf(item).filter((ref) => !ref.curatedSource);
    if (decision.decision === "EXCLUDE") {
      assert.ok(!refs.some((ref) => ref.key === decision.key && ref.line === decision.line), decision.item + " " + decision.key);
      continue;
    }
    const target = refs.find((ref) => ref.key === (decision.to_key ?? decision.key) && ref.line === (decision.to_line ?? decision.line));
    assert.equal(target?.review?.decision, decision.decision, decision.item + " " + decision.key);
  }
  assert.equal(manualLinkReview("curated:adoption", "17", 40431)?.decision, "DIRECT");
  assert.equal(manualLinkReview("WLF00005450", "32", 4887)?.decision, "DIRECT", "옮긴 줄로도 같은 판정을 찾는다");
  assert.equal(manualLinkAllowed("16", "", "dementia-public-guardianship", 100, lineAt("16", 100)), false);
});

test("판정은 검수한 원문 줄의 내용 지문이 지금 줄과 같을 때만 적용한다", () => {
  assert.equal(lineFingerprint("## 40. 노인  생활안전사고 예방 지원"), lineFingerprint("40. 노인 생활안전사고 예방 지원"), "띄어쓰기·제목 기호는 무시한다");
  assert.notEqual(lineFingerprint("40. 노인 생활안전사고 예방 지원"), lineFingerprint("41. 국가보훈처 재가복지서비스"));
  const review = { decision: "EXCLUDE", line_sha256: lineFingerprint("소득 산정 조항") };
  assert.equal(manualLinkReviewState(review, "소득 산정 조항"), "OK");
  assert.equal(manualLinkReviewState(review, "줄이 밀려 들어온 다른 문장"), "STALE");
  assert.equal(manualLinkReviewState(review, undefined), "STALE");
  assert.equal(manualLinkReviewState({ decision: "EXCLUDE" }, "소득 산정 조항"), "UNSTAMPED");
  const moved = { decision: "DIRECT", line_sha256: lineFingerprint("목차 줄"), to_line: 9, to_line_sha256: lineFingerprint("본문 절 제목") };
  assert.equal(manualLinkReviewState(moved, "목차 줄", "본문 절 제목"), "OK");
  assert.equal(manualLinkReviewState(moved, "목차 줄", "다른 절"), "STALE", "옮길 줄도 바뀌면 옮기지 않는다");
  assert.equal(manualLinkAllowed("35", "", "WLF00000103", 9857, "줄이 밀려 들어온 다른 문장"), true, "지문이 다르면 제외 판정을 적용하지 않는다");
});

test("모든 검수 판정은 지금 매뉴얼 원문과 지문이 맞다", () => {
  const reviews = JSON.parse(readFileSync(new URL("../data/welfare100/manual-link-reviews.json", import.meta.url), "utf8"));
  assert.equal(reviews.corpus_revision, COMBINED_REVISION);
  for (const decision of reviews.decisions) {
    const target = decision.to_line ? lineAt(decision.to_key, decision.to_line) : undefined;
    assert.equal(manualLinkReviewState(decision, lineAt(decision.key, decision.line), target), "OK", decision.item + " " + decision.key + ":" + decision.line);
  }
});

