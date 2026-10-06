// 보도자료 기관 레지스트리 시드 SQL을 만든다: node scripts/press/build-registry-seed.mjs
// 기관 목록은 대시보드 자료(public/data/summary.json)의 광역·시군구 이름이며 공식 행정기관 코드 목록이 아니다.
// 그래서 코드는 비워 두고 seed_origin으로 출처를 남긴다. 보도자료 게시판 주소는 만들어 넣지 않는다.
import { readFileSync, writeFileSync } from "node:fs";

const SEED_VERSION = "seed-dataset-2026-10-03";
const MOHW_VERIFIED_AT = Math.floor(Date.UTC(2026, 9, 3, 13, 8, 52) / 1000);
const MOHW_RSS = "https://www.mohw.go.kr/rss/board.es?mid=a10503000000&bid=0027&info";
const ADMINISTRATIVE_CITIES = new Set(["제주시", "서귀포시"]);
// 작업지시서 26.3의 일반구 이름 표(Seed). 공식 코드·효력은 아직 확인하지 않았다. 화성시 4개 구는 개편 주장 자체를 검증하지 못해 대상 집계에서 뺀다.
const GENERAL_DISTRICTS = {
  경기도: { 수원시: ["장안구", "권선구", "팔달구", "영통구"], 성남시: ["수정구", "중원구", "분당구"], 안양시: ["만안구", "동안구"], 부천시: ["원미구", "소사구", "오정구"], 안산시: ["상록구", "단원구"], 고양시: ["덕양구", "일산동구", "일산서구"], 용인시: ["처인구", "기흥구", "수지구"], 화성시: ["만세구", "효행구", "병점구", "동탄구"] },
  충청북도: { 청주시: ["상당구", "서원구", "흥덕구", "청원구"] },
  충청남도: { 천안시: ["동남구", "서북구"] },
  전북특별자치도: { 전주시: ["완산구", "덕진구"] },
  경상북도: { 포항시: ["남구", "북구"] },
  경상남도: { 창원시: ["의창구", "성산구", "마산합포구", "마산회원구", "진해구"] },
};
// 화성시 일반구(만세·효행·병점·동탄)는 2026-10-05 시 누리집 첫 화면의 구청 링크(hscity.go.kr/manse/ 등)와
// 지방재정365 세출의 구 부서(만세구 2003·효행구 2004·병점구 2005·동탄구 2006)로 실재를 확인해 미검증 목록에서 뺐다.
const UNVERIFIED_CITIES = new Set([]);

const summary = JSON.parse(readFileSync(new URL("../../public/data/summary.json", import.meta.url), "utf8")).summary;
const quote = (value) => (value === null ? "NULL" : typeof value === "number" ? String(value) : `'${String(value).replaceAll("'", "''")}'`);

function districtType(sido, name) {
  if (ADMINISTRATIVE_CITIES.has(name)) return "ADMINISTRATIVE_CITY";
  if (name.endsWith("군")) return "BASIC_COUNTY";
  if (name.endsWith("구") && /(광역시|특별시|통합특별시)$/.test(sido)) return "AUTONOMOUS_DISTRICT";
  return "BASIC_CITY";
}

const organizations = [{ id: "org:mohw", name: "보건복지부", type: "CENTRAL", sido: "", sigungu: "", parent: null, origin: "manual_verified", lifecycle: "ACTIVE" }];
for (const sido of Object.keys(summary.sigunguBySido).sort((a, b) => a.localeCompare(b, "ko"))) {
  organizations.push({ id: `org:${sido}`, name: sido, type: "METROPOLITAN", sido, sigungu: "", parent: null, origin: "dashboard_dataset", lifecycle: "ACTIVE" });
  const names = new Set(summary.sigunguBySido[sido]);
  if (sido === "제주특별자치도") for (const city of ADMINISTRATIVE_CITIES) names.add(city);
  for (const name of [...names].filter((value) => value !== sido).sort((a, b) => a.localeCompare(b, "ko"))) {
    const origin = sido === "제주특별자치도" ? "work_order_v5_23_1" : "dashboard_dataset";
    organizations.push({ id: `org:${sido}:${name}`, name, type: districtType(sido, name), sido, sigungu: name, parent: `org:${sido}`, origin, lifecycle: "ACTIVE" });
    for (const district of GENERAL_DISTRICTS[sido]?.[name] ?? []) {
      organizations.push({ id: `org:${sido}:${name}:${district}`, name: district, type: "GENERAL_DISTRICT", sido, sigungu: `${name} ${district}`, parent: `org:${sido}:${name}`, origin: "work_order_v5_26_3", lifecycle: UNVERIFIED_CITIES.has(name) ? "SEED_UNVERIFIED" : "ACTIVE" });
    }
  }
}

const lines = ["-- 자동 생성: scripts/press/build-registry-seed.mjs (수정하지 말고 스크립트를 고쳐 다시 만든다)"];
for (const org of organizations) {
  lines.push(`INSERT INTO press_organization (organization_id, name, org_type, sido, sigungu, parent_id, lifecycle_status, seed_origin, registry_version) VALUES (${[org.id, org.name, org.type, org.sido, org.sigungu, org.parent, org.lifecycle, org.origin, SEED_VERSION].map(quote).join(", ")});`, "--> statement-breakpoint");
}
const note = "2026-10-03 RSS 2.0 응답과 item 파싱을 직접 확인했고, robots.txt가 이 RSS 경로를 명시적으로 Allow한다. 보건복지부 정보구독 페이지(menu.es?mid=a10807000000)가 같은 주소를 안내한다.";
const basis = "robots.txt Allow와 공식 RSS 안내만 확인했다. 공공누리 유형 등 개별 이용조건과 공개 표시 권한은 운영자 확인 전이라 승인 대기 상태다.";
lines.push(`INSERT INTO press_source (source_id, organization_id, method, adapter, homepage_url, endpoint_url, allowed_hosts, interval_minutes, verification_status, verification_note, endpoint_verified_at, policy_basis, registry_version) VALUES (${["src:mohw:press-rss", "org:mohw", "RSS", "RSSAdapter", "https://www.mohw.go.kr", MOHW_RSS, JSON.stringify(["www.mohw.go.kr"]), 60, "ENDPOINT_VERIFIED", note, MOHW_VERIFIED_AT, basis, SEED_VERSION].map(quote).join(", ")});`);
lines.push("");
writeFileSync(new URL("../../drizzle/0021_press_registry_seed.sql", import.meta.url), lines.join("\n"));
console.log(JSON.stringify({ organizations: organizations.length, types: Object.fromEntries([...new Set(organizations.map((o) => o.type))].map((t) => [t, organizations.filter((o) => o.type === t).length])) }));
