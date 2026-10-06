// 일반구 공용 게시판 확인(작업지시서 v5 §23 일반구청: 독립 홈페이지가 없어도 기관을 등록하고 상위 시 공용 게시판 관계를 확인).
// 상위 시 누리집에서 구청 누리집 링크를 찾고, 그 화면(첫 화면·사이트맵 링크)에 보도자료류 메뉴가 있는지 본다.
// 보도자료 메뉴가 없고 상위 시 보도자료 게시판이 endpoint 확인 상태면 SHARED_PARENT_BOARD, 메뉴가 있으면 OWN_BOARD_CANDIDATE(따로 검증 필요).
//   node scripts/press/general-districts.mjs [기준일]
import { readdirSync, readFileSync, writeFileSync } from "node:fs";

import { links, organizations, politeFetch, robotsFor } from "./discover.mjs";

const asOf = process.argv[2] ?? new Date().toISOString().slice(0, 10);
const PRESS = /보도\s*자료|보도\s*[·ㆍ\/,]?\s*해명/;
// 같은 기준일의 가장 최근 개정 registry(-rN이 가장 큰 것)에서 상위 시 상태를 읽는다.
const registryDir = new URL("../../docs/press/registry/", import.meta.url);
const revisionOf = (name) => Number(/-r(\d+)\.json$/.exec(name)?.[1] ?? 0);
const latest = readdirSync(registryDir).filter((name) => name.startsWith("registry-" + asOf) && name.endsWith(".json")).sort((a, b) => revisionOf(a) - revisionOf(b)).pop();
if (!latest) throw new Error("기준일 registry가 없습니다: " + asOf);
const registryFile = new URL(latest, registryDir);
const registry = JSON.parse(readFileSync(registryFile, "utf8"));
const byId = Object.fromEntries(registry.organizations.map((row) => [row.organization_id, row]));
const districts = organizations().filter((org) => org.type === "GENERAL_DISTRICT" && org.lifecycle !== "SEED_UNVERIFIED");
const results = {};
// 상위 시 첫 화면에 '○○구청' 글자 링크가 없어 사람이 찾은 구청 화면(2026-10-05 확인). 근거는 결과 파일의 district_homepage_basis에 남긴다.
const DISTRICT_HOMES = {
  "org:경기도:안양시:만안구": { url: "https://www.anyang.go.kr/manan/index.do", basis: "제목 '만안구청 - 안양시'. 시 첫 화면에는 '만안구 행정복지센터' 등만 있고 '만안구청' 링크가 없음" },
  "org:경상북도:포항시:남구": { url: "https://www.pohang.go.kr/gu/contents.do?mid=0103020000", basis: "시 첫 화면 링크 '남구청 전화번호 안내'가 여는 시 누리집 /gu/ 구청 화면" },
  "org:경상북도:포항시:북구": { url: "https://www.pohang.go.kr/gu/contents.do?mid=0203020000", basis: "시 첫 화면 링크 '북구청 전화번호 안내'가 여는 시 누리집 /gu/ 구청 화면" },
};
// 성남 수정구·분당구, 용인 처인구 누리집은 서버가 중간 인증서를 보내지 않는다. 공개 중간 인증서(scripts/press/ca/intermediates.pem,
// 발급기관 AIA 주소에서 받음)를 NODE_EXTRA_CA_CERTS로 주고 실행하면 정상 인증서 검증으로 열린다.
for (const district of districts) {
  const parent = byId[district.parent];
  const short = district.name.replace(/구$/, "");
  const entry = { organization_id: district.id, parent_id: district.parent, parent_survey: parent?.survey_category ?? null, parent_endpoint: parent?.endpoint_url ?? null, checked_at: new Date().toISOString(), evidence: [] };
  results[district.id] = entry;
  if (!parent?.homepage_url) { entry.verdict = "PARENT_HOMEPAGE_UNKNOWN"; continue; }
  const home = await politeFetch(parent.homepage_url);
  entry.evidence.push({ url: parent.homepage_url, result: home.ok ? "OK" : home.error ?? home.status });
  if (!home.ok) { entry.verdict = "PARENT_UNREACHABLE"; continue; }
  const manual = DISTRICT_HOMES[district.id];
  if (manual) entry.district_homepage_basis = manual.basis;
  const link = manual ? { absolute: manual.url } : links(home.text, home.url).find((item) => item.absolute && /\.kr$/.test(new URL(item.absolute).hostname) && (item.text.replace(/\s/g, "") === district.name || item.text.replace(/\s/g, "") === district.name + "청" || item.text.replace(/\s/g, "") === short + "구청"));
  if (!link) { entry.verdict = "DISTRICT_SITE_NOT_LINKED"; continue; }
  entry.district_homepage = link.absolute;
  if ((await robotsFor(link.absolute)) === "DISALLOWED") { entry.verdict = "DISTRICT_SITE_ROBOTS"; continue; }
  const site = await politeFetch(link.absolute);
  entry.evidence.push({ url: link.absolute, result: site.ok ? "OK" : site.error ?? site.status });
  if (!site.ok) { entry.verdict = "DISTRICT_SITE_UNREACHABLE"; continue; }
  const pages = [site];
  const map = links(site.text, site.url).find((item) => item.absolute && /(사이트\s*맵|전체\s*메뉴)/.test(item.text) && item.text.length <= 20);
  if (map && (await robotsFor(map.absolute)) !== "DISALLOWED") {
    const mapped = await politeFetch(map.absolute);
    entry.evidence.push({ url: map.absolute, result: mapped.ok ? "OK" : mapped.error ?? mapped.status });
    if (mapped.ok) pages.push(mapped);
  }
  const menus = pages.flatMap((page) => links(page.text, page.url)).filter((item) => item.absolute && PRESS.test(item.text) && item.text.length <= 30);
  entry.press_menus = [...new Map(menus.map((item) => [item.absolute, { text: item.text, url: item.absolute }])).values()].slice(0, 4);
  // 구 독립 게시판: 구청 누리집이 시와 다른 호스트(예: wonmi.bucheon.go.kr)이고 보도자료 메뉴도 그 호스트 안에 있을 때만.
  // 시 누리집 안의 구 화면(같은 호스트)에서 보이는 보도자료 메뉴는 시 게시판(또는 도 게시판) 연결이다(수원·창원·청주·고양·안양에서 확인).
  const districtHost = new URL(site.url).hostname;
  const parentHost = new URL(parent.homepage_url).hostname;
  const own = districtHost !== parentHost ? menus.filter((item) => new URL(item.absolute).hostname === districtHost) : [];
  entry.verdict = own.length ? "OWN_BOARD_CANDIDATE" : parent.survey_category === "endpoint_confirmed" ? "SHARED_PARENT_BOARD" : "SHARED_PARENT_BOARD_UNCONFIRMED";
  console.log(district.id, entry.verdict, entry.district_homepage, JSON.stringify(entry.press_menus));
}
writeFileSync(new URL("../../docs/press/discovery/general-districts-" + asOf + ".json", import.meta.url), JSON.stringify({ checked_at: new Date().toISOString(), rule: "구청 누리집 첫 화면·사이트맵에 보도자료 메뉴가 없고 상위 시 게시판이 확인된 경우만 공용 게시판", results }, null, 1) + "\n");
const counts = Object.values(results).reduce((acc, row) => ({ ...acc, [row.verdict]: (acc[row.verdict] ?? 0) + 1 }), {});
console.log(JSON.stringify(counts));
