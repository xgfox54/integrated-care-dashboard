import assert from "node:assert/strict";
import test from "node:test";

import { classifyTitle } from "./press/classify.ts";
import { canonicalizeUrl, originIdOf, parsePublicationDate } from "./press/normalize.ts";

const HOSTS = ["www.mohw.go.kr"];

test("허용 호스트의 https 주소만 통과하고 게시물 번호는 보존하며 추적 파라미터만 지운다", () => {
  assert.equal(
    canonicalizeUrl("https://www.mohw.go.kr/board.es?mid=a1&list_no=7&utm_source=x&act=view#top", HOSTS),
    "https://www.mohw.go.kr/board.es?mid=a1&list_no=7&act=view",
  );
  assert.equal(canonicalizeUrl("http://www.mohw.go.kr/nbtnewsBU/1", HOSTS), "https://www.mohw.go.kr/nbtnewsBU/1");
  for (const bad of ["http://www.mohw.go.kr:8080/a", "https://evil.example/a", "https://user:pw@www.mohw.go.kr/a", "https://www.mohw.go.kr:8443/a", "javascript:alert(1)", "not a url", "https://127.0.0.1/a"]) {
    assert.equal(canonicalizeUrl(bad, HOSTS), null, bad);
  }
});

test("원천 식별자는 list_no, GUID, 주소 해시 순으로 정한다", async () => {
  assert.equal(await originIdOf("https://www.mohw.go.kr/b?list_no=123", "g"), "123");
  assert.equal(await originIdOf("https://www.mohw.go.kr/b?x=1", "guid-1"), "guid-1");
  assert.match(await originIdOf("https://www.mohw.go.kr/b?x=1", ""), /^[0-9a-f]{24}$/);
});

test("게시일은 KST 날짜로 바꾸고 읽을 수 없거나 미래인 값은 날짜 미확인으로 둔다", () => {
  const now = Math.floor(Date.UTC(2026, 9, 3) / 1000);
  assert.deepEqual(parsePublicationDate("Fri, 02 Oct 2026 15:30:00 GMT", now), { epoch: Date.UTC(2026, 9, 2, 15, 30) / 1000, date: "2026-10-03", precision: "datetime" });
  for (const raw of ["", "어제", "Fri, 02 Oct 2031 07:50:00 GMT", "Sat, 01 Jan 1990 00:00:00 GMT"]) {
    assert.deepEqual(parsePublicationDate(raw, now), { epoch: null, date: "", precision: "unknown" }, raw);
  }
  assert.deepEqual(parsePublicationDate("2026-10-02", now), { epoch: null, date: "2026-10-02", precision: "date" });
  for (const raw of ["2026-02-30", "2031-01-01", "1990-01-01"]) assert.equal(parsePublicationDate(raw, now).precision, "unknown", raw);
});

test("기관 이름의 '복지'만으로는 분류하지 않고, 약한 단서는 확정 대신 검토로 보류한다", () => {
  assert.equal(classifyTitle("보건복지부, 신규 지원 안내").status, "NEEDS_REVIEW");
  assert.equal(classifyTitle("복지부 장관 해외 출장").status, "NON_WELFARE");
  const care = classifyTitle("복지부, 지역사회 통합돌봄 시범사업 확대");
  assert.equal(care.status, "WELFARE");
  assert.ok(care.categories.includes("integrated_care"));
  assert.equal(care.basis, "title_rule");
  assert.deepEqual(classifyTitle("노인 장기요양 보험 개선").categories.slice(0, 1), ["senior"]);
  assert.equal(classifyTitle("통 합 돌 봄 안내").status, "WELFARE");
});

test("운영자가 뺀 낱말(영농부산물)이 제목에 있으면 어르신 같은 복지 단서가 있어도 비복지로 둔다", () => {
  const residue = classifyTitle("‘영농부산물 태우지 말고 파쇄하세요’ 어르신 힘든 밭 정리, 태안군 파쇄지원단이 뚝딱 해결해 드립니다!");
  assert.deepEqual([residue.status, residue.categories], ["NON_WELFARE", []]);
  assert.equal(classifyTitle("어르신 힘든 밭 정리, 파쇄지원단이 해결").status, "WELFARE");
});

test("간병은 복지로 분류하고, 병원장 취임처럼 정책과 무관한 제목은 분류하지 않는다", () => {
  assert.equal(classifyTitle("국민 간병 부담 완화 위한 입원서비스 정책 로드맵").status, "WELFARE");
  assert.equal(classifyTitle("제13대 국립나주병원장 취임").status, "NON_WELFARE");
});

test("'청소년'만 걸린 제목은 확정하지 않고 검토로 보류하고, 다른 복지어가 함께 있으면 확정한다", () => {
  assert.equal(classifyTitle("울산시립청소년교향악단, 신규 단원 4명 선발").status, "NEEDS_REVIEW");
  assert.equal(classifyTitle("위기 청소년 심리지원 확대").status, "WELFARE");
  assert.equal(classifyTitle("2026년 청년내일저축계좌 최종 선정").status, "WELFARE");
});
