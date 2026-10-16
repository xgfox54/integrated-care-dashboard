import assert from "node:assert/strict";
import test from "node:test";

import {
  boundedPageCount,
  dataAsOfFromTitle,
  isIntegratedCareRecord,
  municipalityFromTitle,
  parseMohwBoardPage,
  toOfficialService,
} from "./official-source.ts";

test("boundedPageCount covers every API page and rejects an unsafe result", () => {
  assert.equal(boundedPageCount(0, 100, 10), 1);
  assert.equal(boundedPageCount(201, 100, 10), 3);
  assert.throws(() => boundedPageCount(1001, 100, 10), /안전 수집 한도/);
});

test("parseMohwBoardPage reads the official municipality PDF metadata", () => {
  const html = `
    <span class="total">총 게시물 <b>25</b></span>
    <table><tbody><tr>
      <td class="subject" data-label="제목"><a
        href="/board.es?mid=a60601000000&amp;bid=0075&amp;act=view&amp;list_no=1489545&amp;nPage=1"
        class="txt_title">서울특별시 중랑구 통합돌봄 서비스 메뉴판(26년 6월 기준)</a></td>
      <td data-label="등록일">2026-03-20</td>
      <td data-label="첨부파일">
        <span class="file-name">25 중랑구(6월)</span>
        <a href="/boardDownload.es?bid=0075&amp;list_no=1489545&amp;seq=1">다운로드</a>
      </td>
    </tr></tbody></table>`;

  const result = parseMohwBoardPage(
    html,
    "서울특별시",
    "https://www.mohw.go.kr/menu.es?mid=a60601000000",
  );

  assert.equal(result.totalCount, 25);
  assert.deepEqual(result.documents, [
    {
      documentId: "0075:1489545:1",
      province: "서울특별시",
      municipality: "중랑구",
      title: "서울특별시 중랑구 통합돌봄 서비스 메뉴판(26년 6월 기준)",
      publishedAt: "2026-03-20",
      dataAsOf: "2026-06",
      detailUrl:
        "https://www.mohw.go.kr/board.es?mid=a60601000000&bid=0075&act=view&list_no=1489545&nPage=1",
      downloadUrl: "https://www.mohw.go.kr/boardDownload.es?bid=0075&list_no=1489545&seq=1",
      fileName: "25 중랑구(6월)",
    },
  ]);
});

test("dataAsOfFromTitle supports two and four digit years", () => {
  assert.equal(dataAsOfFromTitle("통합돌봄 메뉴판(26년 9월 기준)"), "2026-09");
  assert.equal(dataAsOfFromTitle("통합돌봄 메뉴판(2026년 10월 기준)"), "2026-10");
});

test("municipalityFromTitle handles current province aliases and province-wide documents", () => {
  assert.equal(
    municipalityFromTitle("강원도 양양군 통합돌봄 서비스 메뉴판", "강원특별자치도"),
    "양양군",
  );
  assert.equal(
    municipalityFromTitle("제주특별자치도 통합돌봄 서비스 메뉴판", "제주특별자치도"),
    "제주특별자치도",
  );
});

test("제주 원천문서 제목의 행정시 범위를 보존하고 기존 광역 식별값은 유지한다", () => {
  for (const city of ["서귀포시", "제주시"]) {
    assert.equal(municipalityFromTitle(`제주특별자치도 ${city} 통합돌봄 서비스 메뉴판`, "제주특별자치도"), city);
    assert.equal(municipalityFromTitle(`제주특별자치도(${city}) 통합돌봄 서비스 메뉴판`, "제주특별자치도"), city);
  }
  assert.equal(municipalityFromTitle("제주특별자치도 통합돌봄 서비스 메뉴판", "제주특별자치도"), "제주특별자치도");
  assert.equal(municipalityFromTitle("제주특별자치도 제주시·서귀포시 통합돌봄 메뉴판", "제주특별자치도"), "제주특별자치도");
  assert.equal(municipalityFromTitle("제주특별자치도 제주시장 인사말", "제주특별자치도"), "제주특별자치도");
  assert.equal(municipalityFromTitle("세종특별자치시 통합돌봄 서비스 메뉴판", "세종특별자치시"), "세종특별자치시");
});

test("public API records are filtered and normalized for the dashboard", () => {
  const record = {
    servId: "S-1",
    servNm: "퇴원환자 방문간호 지원",
    jurOrgNm: "서울특별시 중랑구",
    servDgst: "퇴원 후 간호사가 가정을 방문합니다.",
    sidoNm: "서울특별시",
    sggNm: "중랑구",
    sprtTrgt: "퇴원환자",
    aplyMthd: "주민센터 신청",
    servDtlLink: "https://example.test/S-1",
    lastModYmd: "20260901",
  };

  assert.equal(isIntegratedCareRecord(record), true);
  assert.deepEqual(toOfficialService(record), {
    serviceId: "S-1",
    sido: "서울특별시",
    sigungu: "중랑구",
    category: "보건의료",
    subcategory: "방문의료·건강",
    name: "퇴원환자 방문간호 지원",
    description: "퇴원 후 간호사가 가정을 방문합니다.",
    target: "퇴원환자",
    detailTarget: "",
    applicationMethod: "주민센터 신청",
    provider: "서울특별시 중랑구",
    type: "공공 API",
    serial: "S-1",
    detailUrl: "https://example.test/S-1",
    updatedDate: "20260901",
  });
});
