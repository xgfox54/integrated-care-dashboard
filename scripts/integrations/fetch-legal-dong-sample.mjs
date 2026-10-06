// 행정표준코드관리시스템(code.go.kr) 공개 화면에서 현행 법정동 시·군·구 목록과 지정 지역의 이력(생성일·폐지일)을 받는다.
// 공공데이터포털 법정동코드 API(15077871)의 인증키가 없을 때 쓰는 공식 원문 표본이다. robots.txt는 전체 허용(Allow: /).
// 요청 간격 1.5초, 한 번 실행에 약 30건. 결과는 docs/integrations/samples/ 에 저장한다.
import { writeFileSync } from "node:fs";

const UA = "Mozilla/5.0 (integrated-care-dashboard official-sample)";
const BASE = "https://www.code.go.kr";
const SIDO = ["11","26","27","28","29","30","31","36","41","43","44","46","47","48","50","51","52","12"];
const HISTORY_QUERIES = ["용지동", "제주특별자치도 서귀포시", "제주특별자치도 제주시", "제주도 서귀포시", "군위군", "부천시 원미구", "화성시 동탄구", "전남광주통합특별시", "광주광역시", "전라남도"];
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function post(path, form) {
  const response = await fetch(BASE + path, { method: "POST", body: new URLSearchParams(form), headers: { "content-type": "application/x-www-form-urlencoded", "user-agent": UA } });
  if (!response.ok) throw new Error(path + " HTTP " + response.status);
  return response.text();
}

function listFrom(html, name) {
  const match = new RegExp(name + ' = "([^"]*)"').exec(html);
  return match ? match[1].split(",").filter(Boolean) : [];
}

const sigungu = [];
for (const sido of SIDO) {
  const html = await post("/stdcode/sggCodeIL.do", { sidoCd: sido, searchOk: "0", disuseAt: "0", codeseId: "00002" });
  const names = listFrom(html, "strSggNm");
  const codes = listFrom(html, "strSggCd");
  if (names.length !== codes.length) throw new Error("sido " + sido + " 이름·코드 수 불일치");
  names.forEach((nm, index) => sigungu.push({ sido_cd: sido, sgg_cd: codes[index], code: sido + codes[index] + "00000", name: nm }));
  await wait(1500);
}

const history = {};
for (const query of HISTORY_QUERIES) {
  const html = await post("/stdcode/regCodeL.do", { cPage: "1", searchOk: "0", codeseId: "00002", pageSize: "100", regionCd: "", locataddNm: query, sidoCd: "*", sggCd: "*", umdCd: "*", riCd: "*", disuseAt: "ALL", chkWantCnt: "3", chkHigh: "0", chkCrtDt: "0", chkClsDt: "0" });
  const rows = html.split(/<tr>/).slice(1)
    .map((segment) => [...segment.split(/<\/tr>/)[0].matchAll(/<td[^>]*>([^<]*)</g)].map((cell) => cell[1].replace(/&nbsp;?/g, "").replace(/\s+/g, " ").trim()))
    .filter((cells) => /^\d{10}$/.test(cells[0] ?? ""))
    .map((cells) => ({ code: cells[0], name: cells[1], parent_code: cells[3] || null, created: cells[4] || null, abolished: cells[5] || null }));
  history[query] = rows.filter((row) => row.code.endsWith("00000") || /동$|읍$|면$/.test(row.name) && row.name.split(" ").length <= 4);
  await wait(1500);
}

const out = {
  source: { title: "행정표준코드관리시스템 법정동코드목록조회", url: BASE + "/stdcode/regCodeL.do", provider: "행정안전부", retrieved_at: new Date().toISOString(), method: "공개 조회 화면(sggCodeIL.do 현행 목록, regCodeL.do 폐지 포함 검색)", robots: "Allow: /" },
  sigungu_current: sigungu,
  history,
};
const target = process.argv[2] ?? "docs/integrations/samples/legal-dong-official-sample.json";
writeFileSync(target, JSON.stringify(out, null, 1) + "\n");
console.log("sigungu", sigungu.length, "history", Object.fromEntries(Object.entries(history).map(([k, v]) => [k, v.length])));

