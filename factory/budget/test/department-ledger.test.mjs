import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { deflateRawSync } from "node:zlib";
import { matchLedger, ledgerRows, outOfScope, xlsxRows, amount, mergeLedger, revtesRows, matchByProjectCode, matchBySpendingProjects } from "../ledger-departments.mjs";
import { budgetDepartmentLabel } from "../../../components/budget/budget-departments.ts";

const profile = JSON.parse(readFileSync(new URL("../configs/department-ledger-2026.json", import.meta.url))).entities[0];
const item = (id, code, name, budget, spent, account = ["100", "일반회계"]) => ({ fiscal_project_id: id, fiscal_year: "2026", reference_date: "2026-10-02", fiscal_entity: { name: "경기포천시" }, department_code: code, account: { code: account[0], name: account[1] }, name, current_budget_krw: budget, public_expenditure_krw: spent });
const row = (dept, name, budget, spent, account = "일반회계") => ({ account_name: account, department_name: dept, name, budget_krw: budget, expenditure_krw: spent });

test("a code is named only by unique, agreeing, amount-corroborated rows", () => {
  const items = [item("a", "1", "노인 일자리", "100", "50"), item("b", "1", "경로당 운영", "200", "70"), item("c", "2", "가족센터", "300", "0"), item("d", "2", "공동육아", "400", "1"), item("e", "3", "기본경비", "5", "5"), item("f", "3", "기본경비", "6", "6")];
  const rows = [row("노인장애인과", "노인일자리", "100", "49"), row("노인장애인과", "경로당  운영", "999", "70"), row("가족여성과", "가족센터", "300", "0"), row("복지정책과", "공동육아", "400", "1"), row("총무과", "기본경비", "5", "5")];
  const r = matchLedger(items, rows, profile, "https://x");
  assert.deepEqual(r.mappings.map((m) => [m.department_code, m.department_name]), [["1", "노인장애인과"]]);
  assert.deepEqual(r.held.map((h) => [h.department_code, h.reason]), [["2", "conflicting_departments"]]);
});

test("one corroborating amount is not enough, and other accounts never pair with 일반회계", () => {
  const items = [item("a", "1", "가", "100", "1"), item("b", "1", "나", "200", "2")];
  assert.equal(matchLedger(items, [row("복지정책과", "가", "100", "0"), row("복지정책과", "나", "7", "8")], profile, "u").held[0].reason, "insufficient_amount_corroboration");
  assert.equal(matchLedger(items, [row("복지정책과", "가", "100", "1", "주차장특별회계"), row("복지정책과", "나", "200", "2", "주차장특별회계")], profile, "u").mappings.length, 0);
});

test("national ledger duplicates are resolved only by distinct exact positive budgets", () => {
  const items = [item("a", "1", "가", "100", "0"), item("b", "1", "나", "200", "0"), item("c", "2", "가", "300", "0"), item("d", "2", "나", "400", "0")];
  const rows = [row("복지정책과", "가", "100", "0"), row("복지정책과", "나", "200", "0"), row("건강증진과", "가", "300", "0"), row("건강증진과", "나", "400", "0")];
  assert.equal(matchLedger(items, rows, profile, "u").mappings.length, 0);
  const exact = { ...profile, exact_budget_key: true };
  assert.deepEqual(matchLedger(items, rows, exact, "u").mappings.map((m) => [m.department_code, m.department_name]), [["1", "복지정책과"], ["2", "건강증진과"]]);
  assert.equal(matchLedger(items, [...rows, row("다른과", "가", "100", "0")], exact, "u").mappings.some((m) => m.department_code === "1"), false);
  assert.equal(matchLedger(items, rows.map((r) => ({ ...r, budget_krw: "0" })), exact, "u").mappings.length, 0);
});

test("rows without an account column join by project name alone", () => {
  const noAccount = (dept, name, budget, spent) => ({ ...row(dept, name, budget, spent), account_name: null });
  const special = ["225", "주차장특별회계"];
  const accountlessItems = [item("a", "4", "가", "100", "10", special), item("b", "4", "나", "200", "20"), item("c", "5", "다", "1", "1"), item("d", "5", "다", "2", "2", special)];
  const accountless = matchLedger(accountlessItems, [noAccount("복지정책과", "가", "100", "10"), noAccount("복지정책과", "나", "200", "20"), noAccount("총무과", "다", "1", "1")], profile, "u");
  assert.deepEqual(accountless.mappings.map((m) => [m.department_code, m.department_name]), [["4", "복지정책과"]], "회계 칸이 없으면 사업명만으로 잇고, 회계가 달라도 같은 이름이 둘이면 쓰지 않는다");
});

test("a blank department name in the export never names a code", () => {
  const items = [item("a", "7", "가", "100", "10"), item("b", "7", "나", "200", "20")];
  const r = matchLedger(items, [row("", "가", "100", "10"), row("", "나", "200", "20")], profile, "u");
  assert.equal(r.mappings.length, 0);
  assert.equal(r.held[0].reason, "missing_department_name");
});

test("disclosure rows join by project and account code, and one disagreeing department code holds the code", () => {
  const coded = (id, code, project, budget, spent, account = ["100", "일반회계"]) => ({ ...item(id, code, "사업" + id, budget, spent, account), source_project_code: project });
  const listRow = (deptCd, deptNm, dbizCd, bgt, expd, fisFgCd = "100") => ({ fisFgCd, fisFgNm: "일반회계", deptCd, deptNm, dbizCd, dbizNm: "사업", bgtCurrAmt: bgt, expdAmt: expd });
  const rows = revtesRows([{ dataList: [listRow("1", "복지정책과", "P1", 100, 10), listRow("1", "복지정책과", "P2", 7, 8), listRow("2", "노인복지과", "P3", 300, 0), listRow("9", "가족과", "P4", 400, 4), listRow("3", "건강증진과", "P5", 1, 1, "225")] }]);
  const items = [coded("a", "1", "P1", "100", "10"), coded("b", "1", "P2", "70", "80"), coded("c", "2", "P3", "999", "5"), coded("d", "2", "P4", "400", "4"), coded("e", "3", "P5", "1", "1")];
  const r = matchByProjectCode(items, rows, "u");
  assert.deepEqual(r.mappings.map((m) => [m.department_code, m.department_name]), [["1", "복지정책과"]]);
  assert.deepEqual(r.held.map((h) => [h.department_code, h.reason]), [["2", "department_code_mismatch"]]);
  assert.throws(() => matchByProjectCode(items, rows.concat(rows[0]), "u"), /REVTES_DUPLICATE_PROJECT/u);
});


test("spending rows name a code by the payer present in every project or the only non-district payer", () => {
  const coded = (id, code, project) => ({ ...item(id, code, "사업" + id, "1", "1"), source_project_code: project });
  const pay = (dept, project) => ({ account_name: "일반회계", department_name: dept, project_code: project });
  const items = [coded("a", "1", "P1"), coded("b", "1", "P2"), coded("c", "2", "P3"), coded("d", "2", "P4"), coded("e", "3", "P5"), coded("f", "3", "P6")];
  const rows = [pay("사회복지과", "P1"), pay("의창구사회복지과", "P1"), pay("의창구동읍", "P2"), pay("사회복지과", "P2"), pay("자치행정과", "P3"), pay("축산과", "P4"), pay("의창구가정복지과", "P5"), pay("의창구가정복지과", "P6"), pay("의창구북면", "P6")];
  const r = matchBySpendingProjects(items, rows, "u", ["의창구"]);
  assert.deepEqual(r.mappings.map((m) => [m.department_code, m.department_name]), [["1", "사회복지과"], ["3", "의창구가정복지과"]]);
  assert.deepEqual(r.held.map((h) => [h.department_code, h.reason]), [["2", "conflicting_departments"]]);
});

test("the same project name in two accounts counts as one project", () => {
  const items = [item("a", "1", "기본경비", "100", "10"), item("b", "1", "기본경비", "200", "20", ["225", "주차장특별회계"])];
  const rows = [row("복지정책과", "기본경비", "100", "10"), row("복지정책과", "기본경비", "200", "20", "주차장특별회계")];
  const r = matchLedger(items, rows, profile, "u");
  assert.equal(r.mappings.length, 0);
  assert.equal(r.held[0].reason, "insufficient_independent_projects");
});

test("읍·면·동, council, health branch offices and libraries are out of scope; main health centres are in scope", () => {
  for (const name of ["소흘읍", "군내면", "포천동", "의회사무과", "상동도서관", "미사보건센터", "덕산보건지소", "분당구보건소판교보건지소", "장호원읍행정복지센터", "창전동행정복지센터", "신둔면사무소", "총무과", "회계과", "체육진흥과", "서귀포시총무과"]) assert.equal(outOfScope(name), true);
  for (const name of ["보건소", "소사보건소", "평택보건소", "보건정책과", "건강증진과", "서귀포보건소건강증진과", "도서관정책과", "노인장애인과", "AI정책담당관"]) assert.equal(outOfScope(name), false);
  const items = [item("a", "9", "가", "1", "1"), item("b", "9", "나", "2", "2")];
  assert.equal(matchLedger(items, [row("소흘읍", "가", "1", "1"), row("소흘읍", "나", "2", "2")], profile, "u").held[0].reason, "out_of_scope_unit");
});

test("the export header is pinned and the xlsx reader keeps shared strings and empty cells", () => {
  const zip = (files) => {
    const parts = [], dir = []; let offset = 0;
    for (const [name, text] of Object.entries(files)) {
      const raw = Buffer.from(text), data = deflateRawSync(raw), n = Buffer.from(name);
      const local = Buffer.alloc(30); local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(8, 8); local.writeUInt32LE(data.length, 18); local.writeUInt32LE(raw.length, 22); local.writeUInt16LE(n.length, 26);
      const central = Buffer.alloc(46); central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(8, 10); central.writeUInt32LE(data.length, 20); central.writeUInt32LE(raw.length, 24); central.writeUInt16LE(n.length, 28); central.writeUInt32LE(offset, 42);
      parts.push(local, n, data); dir.push(central, n); offset += 30 + n.length + data.length;
    }
    const size = dir.reduce((s, b) => s + b.length, 0), end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(dir.length / 2, 10); end.writeUInt32LE(size, 12); end.writeUInt32LE(offset, 16);
    return Buffer.concat([...parts, ...dir, end]);
  };
  const header = profile.export_header;
  const shared = "<sst>" + header.map((h) => "<si><t>" + h + "</t></si>").join("") + "<si><t>일반회계</t></si><si><t>복지정책과</t></si><si><t>긴급복지 &amp; 지원</t></si></sst>";
  const cols = "ABCDEFGHIJKLMNOP".split("");
  const sheet = "<sheetData><row>" + cols.map((c, i) => '<c r="' + c + '1" t="s"><v>' + i + "</v></c>").join("") + '</row><row><c r="A2"><v>1</v></c><c r="B2" t="s"><v>16</v></c><c r="C2" t="s"><v>17</v></c><c r="D2" t="s"><v>18</v></c><c r="F2"><v>1,000</v></c><c r="N2"><v>200</v></c></row></sheetData>';
  const rows = xlsxRows(zip({ "xl/sharedStrings.xml": shared, "xl/worksheets/sheet1.xml": sheet }));
  const parsed = ledgerRows(rows.map((r) => r.map((v) => v === "" ? "0" : v)), profile);
  assert.deepEqual(parsed, [{ account_name: "일반회계", department_name: "복지정책과", name: "긴급복지 & 지원", budget_krw: "1000", expenditure_krw: "200" }]);
  assert.throws(() => ledgerRows([header.slice(1)], profile));
});

test("Pocheon labels come from the ledger match; out-of-scope units stay unnamed", () => {
  assert.equal(budgetDepartmentLabel("경기포천시", "1020056"), "복지정책과 (1020056)");
  assert.equal(budgetDepartmentLabel("경기포천시", "1105024"), "건강증진과 (1105024)");
  assert.match(budgetDepartmentLabel("경기포천시", "3005010"), /명칭 미확인/u);
  assert.equal(budgetDepartmentLabel("경기하남시", "1018004"), "노인장애인복지과 (1018004)");
  assert.equal(budgetDepartmentLabel("충북본청", "1800040"), "노인복지과 (1800040)");
  assert.equal(budgetDepartmentLabel("부산본청", "1050035"), "돌봄복지과 (1050035)");
  assert.equal(budgetDepartmentLabel("부산본청", "1050010"), "복지정책과 (1050010)");
  assert.equal(budgetDepartmentLabel("대전본청", "1040250"), "노인복지과 (1040250)");
  assert.equal(budgetDepartmentLabel("서울강남구", "1025052"), "어르신복지과 (1025052)");
  assert.notEqual(budgetDepartmentLabel("서울서초구", "1025052"), "어르신복지과 (1025052)");
  assert.equal(budgetDepartmentLabel("서울본청", "1090001"), "통합돌봄과 (1090001)");
  assert.equal(budgetDepartmentLabel("인천본청", "1054003"), "통합돌봄과 (1054003)");
  assert.equal(budgetDepartmentLabel("부산사상구", "1028001"), "돌봄정책과 (1028001)");
  assert.equal(budgetDepartmentLabel("부산수영구", "1022011"), "기초생활보장과 (1022011)");
  assert.equal(budgetDepartmentLabel("경기성남시", "1025049"), "통합돌봄과 (1025049)");
  assert.equal(budgetDepartmentLabel("경기이천시", "1015030"), "노인장애인과 (1015030)");
  assert.equal(budgetDepartmentLabel("경남창원시", "1049015"), "노인장애인과 (1049015)");
  assert.equal(budgetDepartmentLabel("경기본청", "1070304"), "아동돌봄과 (1070304)");
  assert.equal(budgetDepartmentLabel("경기안산시", "1009004"), "통합돌봄과 (1009004)");
  assert.equal(budgetDepartmentLabel("경기남양주시", "1020010"), "통합돌봄과 (1020010)");
  assert.equal(budgetDepartmentLabel("부산부산진구", "1003002"), "생활보장과 (1003002)");
  assert.equal(budgetDepartmentLabel("전북전주시", "1020010"), "생활복지과 (1020010)");
  assert.equal(budgetDepartmentLabel("대구북구", "1020010"), "복지정책과 (1020010)");
  assert.equal(budgetDepartmentLabel("전남광주본청", "1035011"), "돌봄정책과 (1035011)");
  assert.equal(budgetDepartmentLabel("충남본청", "1007003"), "청년정책과 (1007003)");
  assert.equal(budgetDepartmentLabel("전북본청", "1020042"), "일자리민생경제과 (1020042)");
  assert.equal(budgetDepartmentLabel("충남천안시", "1006002"), "식품안전과 (1006002)");
  assert.equal(budgetDepartmentLabel("인천서해구", "1006002"), "생활보장과 (1006002)", "현재 e호조 예산서의 독립된 사업명·금액 24건이 같은 부서명에 연결된다");
  assert.equal(budgetDepartmentLabel("경남진주시", "1020030"), "기업통상과 (1020030)");
  assert.equal(budgetDepartmentLabel("경기광주시", "1025052"), "주택과 (1025052)");
  assert.match(budgetDepartmentLabel("경기이천시", "3005010"), /명칭 미확인/u, "읍 행정복지센터는 이름을 붙이지 않는다");
  assert.match(budgetDepartmentLabel("경기성남시", "3015010"), /명칭 미확인/u, "동 행정복지센터는 이름을 붙이지 않는다");
  assert.equal(budgetDepartmentLabel("서울본청", "1280010"), "서북병원원무과 (1280010)", "같은 이름 과는 소속 기관명을 남긴다");
  assert.match(budgetDepartmentLabel("경기하남시", "1105017"), /명칭 미확인/u, "보건센터(보건소 분소)는 이름을 붙이지 않는다");
});

test("exported amounts in exponent notation are expanded exactly", () => {
  assert.equal(amount("6.85684E8"), "685684000");
  assert.equal(amount("5.0616E7"), "50616000");
  assert.equal(amount("1,234"), "1234");
  assert.equal(amount("0.0"), "0");
  assert.equal(amount("-1.8E6"), "-1800000");
  assert.throws(() => amount("1.5"), /FRACTIONAL/u);
  assert.throws(() => amount("abc"), /BAD_AMOUNT/u);
});

test("a current ledger name replaces an older book name in place; everything else is untouched", () => {
  const entry = (code, name, extra = {}) => ({ fiscal_year: "2026", reference_date: "2026-10-02", fiscal_entity_name: "경기용인시", department_code: code, department_name: name, status: "verified_exact", evidence_count: 9, source_urls: ["book"], ...extra });
  const ev = (name) => ({ name, document: { department_basis: "official_budget_ledger_export_row", source_url: "ledger" } });
  const ledger = (code, name) => ({ fiscal_year: "2026", reference_date: "2026-10-02", fiscal_entity_name: "경기용인시", department_code: code, department_name: name, status: "verified_exact", basis: "official_budget_ledger_export", evidence: [ev("가"), ev("나")] });
  const baseline = { schema: "s", rule: "r", mappings: [entry("1", "복지정책과"), entry("2", "노인복지과"), { ...entry("3", "다른시"), fiscal_entity_name: "경기수원시" }] };
  const { merged, fresh, superseded } = mergeLedger(baseline, [ledger("1", "통합돌봄과"), ledger("2", "노인복지과"), ledger("4", "회계과")]);
  assert.deepEqual(superseded, [{ department_code: "1", from: "복지정책과", to: "통합돌봄과" }]);
  assert.equal(merged.mappings[0].department_name, "통합돌봄과");
  assert.equal(merged.mappings[0].supersedes.department_name, "복지정책과");
  assert.deepEqual(merged.mappings.slice(1, 3), baseline.mappings.slice(1));
  assert.deepEqual(fresh.map((m) => m.department_code), ["4"]);
  assert.equal(merged.mappings.length, 4);
});

