// 복지로 복지서비스(중앙부처·지자체)와 복지톡 DB 매뉴얼을 합쳐 복지제도 대장 정적 데이터를 만든다.
// 실행: node --experimental-strip-types scripts/welfare100/build-catalog.mjs --raw ../bokjiro --manuals ../manuals
// 재연결 점검: --from-items public/data/welfare100/items --out <임시 폴더> 는 복지로 원자료 대신 이미 만든 사업 파일의
// 원자료(raw)로 매뉴얼 매칭부터 검수 판정 적용까지 다시 돌린다. 복지로 원자료가 없는 환경에서 재현성을 확인하는 용도다.
import fs from "node:fs";
import path from "node:path";

import { BOKJIRO_AS_OF, expandBokjiro, toCatalogRow } from "../../lib/welfare100/bokjiro.ts";
import { lawUrl, lawKind } from "../../lib/welfare100/law-url.ts";
import { applyLegalLinkReviews } from "./legal-link-reviews.mjs";
import { HOUSEHOLD_ORDER, LIFECYCLE_ORDER, TOPIC_ORDER, expandRecord } from "../../lib/welfare100/model.ts";
import { writeSplitIndex } from "./split-index.mjs";
import { listRowMismatch, manualLinkAllowed } from "./manual-link-scope.mjs";

const argv = process.argv.slice(2);
const arg = (name, fallback) => {
  const index = argv.indexOf("--" + name);
  return index >= 0 ? argv[index + 1] : fallback;
};
const SITE = process.cwd();
const RAW = path.resolve(SITE, arg("raw", "../bokjiro"));
const MANUALS = path.resolve(SITE, arg("manuals", "../manuals"));
const OUT = path.resolve(SITE, arg("out", "public/data/welfare100"));
const DATA = path.resolve(SITE, "data/welfare100");
const FROM_ITEMS = arg("from-items", "") ? path.resolve(SITE, arg("from-items", "")) : "";
if (FROM_ITEMS && path.resolve(OUT, "items") === FROM_ITEMS) throw new Error("--from-items와 --out이 같은 폴더를 가리킵니다. 출력 폴더는 지우고 다시 만들므로 다른 폴더를 쓰세요.");
const REGISTRY_PATH = OUT === path.resolve(SITE, "public/data/welfare100") ? path.join(DATA, "usage-registry.json") : path.join(OUT, "usage-registry.json");

const readJson = (file) => JSON.parse(fs.readFileSync(file, "utf8").replace(/^\uFEFF/, ""));

// ---------------------------------------------------------------- text helpers
const ENTITIES = { nbsp: " ", ensp: " ", emsp: " ", thinsp: " ", lt: "<", gt: ">", amp: "&", quot: '"', apos: "'", middot: "·", rarr: "→", larr: "←", uarr: "↑", darr: "↓", harr: "↔", rArr: "⇒", sim: "~", times: "×", divide: "÷", plusmn: "±", le: "≤", ge: "≥", ne: "≠", deg: "°", micro: "µ", sup2: "²", sup3: "³", frac12: "½", frac14: "¼", permil: "‰", bull: "•", hellip: "…", ndash: "–", mdash: "—", lsquo: "‘", rsquo: "’", ldquo: "“", rdquo: "”", laquo: "«", raquo: "»", reg: "®", copy: "©", trade: "™", para: "¶", sect: "§", cent: "¢", pound: "£", yen: "¥", won: "₩", lceil: "⌈", rceil: "⌉", lfloor: "⌊", rfloor: "⌋", minus: "−", infin: "∞", check: "✓", cir: "○", square: "□", starf: "★", star: "☆", ordm: "º", ordf: "ª" };
function decodeEntities(text) {
  return text
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(Number(dec)))
    .replace(/&([a-z]+[0-9]*);/gi, (whole, name) => ENTITIES[name] ?? ENTITIES[name.toLowerCase()] ?? whole);
}
function cleanLines(text) {
  return text
    .split("\n")
    .map((line) => line.replace(/[ \t\u00a0\u3000]+/g, " ").trim())
    .filter((line) => line && line !== "•" && line !== "-")
    .join("\n")
    .trim();
}
export function htmlToText(value) {
  if (!value) return "";
  let source = String(value).replace(/\r\n?/g, "\n");
  if (!/<[a-z!\/]/i.test(source)) return cleanLines(decodeEntities(source));
  source = source.replace(/\n/g, " ").replace(/<!--.*?-->/g, "").replace(/<(script|style)[\s\S]*?<\/\1>/gi, "");
  let depth = 0;
  let out = "";
  for (const token of source.split(/(<[^>]+>)/)) {
    if (!token) continue;
    if (token.startsWith("<")) {
      const match = token.match(/^<\s*(\/?)\s*([a-z0-9]+)/i);
      if (!match) continue;
      const closing = match[1] === "/";
      const tag = match[2].toLowerCase();
      if (tag === "ul" || tag === "ol") {
        depth += closing ? -1 : 1;
        out += "\n";
      } else if (tag === "li" && !closing) out += "\n" + (depth >= 3 ? "- " : "• ");
      else if (tag === "br") out += "\n";
      else if (["p", "div", "tr", "h1", "h2", "h3", "h4", "h5", "h6", "table", "dt", "dd"].includes(tag)) out += "\n";
      else if (tag === "td" || tag === "th") out += " ";
    } else out += decodeEntities(token);
  }
  return cleanLines(out);
}
const clip = (value, max) => {
  const text = String(value ?? "").replace(/\s+/g, " ").trim();
  return text.length > max ? text.slice(0, max - 1).trimEnd() + "…" : text;
};
/** 괄호 안 쉼표는 나누지 않는다. 예: 대리인(배우자, 친족, 관계인),본인 */
function splitTop(value) {
  const parts = [];
  let depth = 0;
  let current = "";
  for (const ch of String(value ?? "")) {
    if (ch === "(" || ch === "（") depth++;
    if (ch === ")" || ch === "）") depth = Math.max(0, depth - 1);
    if (ch === "," && depth === 0) {
      parts.push(current.trim());
      current = "";
    } else current += ch;
  }
  parts.push(current.trim());
  return parts.filter(Boolean);
}
function parseTags(...sources) {
  const tags = {};
  for (const source of sources) {
    if (!source) continue;
    for (const part of String(source).split(";")) {
      const at = part.indexOf(":");
      if (at < 0) continue;
      const key = part.slice(0, at).trim();
      if (tags[key]) continue;
      tags[key] = splitTop(part.slice(at + 1)).filter((item) => !/^해당없음/.test(item));
    }
  }
  return tags;
}
const ymd = (value) => (/^\d{8}$/.test(value ?? "") && !/^(19700101|99991231|00000000)$/.test(value) ? value.slice(0, 4) + "-" + value.slice(4, 6) + "-" + value.slice(6) : undefined);

// ---------------------------------------------------------------- classification
const FINANCE = /(융자|대출|이자|적금|저축|통장|계좌|자산형성|채무|신용회복|금융|대부|자금 ?대여|기금 ?(융자|대여)|적립)/;
const TOPIC_RULES = [
  ["임신·출산", /(임신|출산|산모|산후|신생아|난임|임산부|출생|분만|태아|산부인과)/],
  ["입양·위탁", /(입양|가정위탁|위탁아동|위탁가정|자립준비청년|보호종료|보호대상아동)/],
  ["보육", /(보육|어린이집|유치원|양육수당|아이돌봄|육아|영유아|아이 돌봄)/],
  ["정신건강", /(정신|심리|자살|우울|트라우마|중독|마음|치매)/],
  ["에너지", /(에너지|전기요금|가스|난방|연료|연탄|냉방|등유|보일러|전력|냉·난방)/],
  ["주거", /(주거|주택|월세|전세|전월세|임대|집수리|주택개량|보금자리|거처|이사|집 수리)/],
  ["일자리", /(일자리|취업|구직|고용|창업|직업|근로|인턴|공공근로|면접|자격증|일경험|채용|취창업)/],
  ["교육", /(교육|학습|장학|학비|학교|학생|교재|진학|입학|수업|방과후|멘토|강좌|수강|학원)/],
  ["법률", /(법률|소송|변호|후견|법원|법무)/],
  ["서민금융", FINANCE],
  ["안전·위기", /(긴급|위기|재난|재해|피해|폭력|학대|안전|구호|범죄|사고|화재|장례|장제|무연고|행려|노숙)/],
  ["신체건강", /(의료|진료|치료|건강|검진|예방접종|접종|치과|수술|재활|보청기|틀니|임플란트|안경|병원|질환|암환자|암 |당뇨|결핵|한방|보건|검사|의약|난청)/],
  ["보호·돌봄", /(돌봄|요양|간병|활동지원|보호|재가|주간보호|쉼터|장기요양|도시락|급식|밑반찬|목욕|이미용|안부)/],
  ["문화·여가", /(문화|여가|체육|스포츠|관광|여행|공연|도서|레저|나들이)/],
];
/** 제도명에는 생활지원 키워드까지 적용한다. */
const NAME_RULES = [...TOPIC_RULES, ["생활지원", /(생계|기초생활|생활안정|수당|위문|명절|효도|장수|축하금|생활비|교통비|상품권|생활용품|물품|급여)/]];
/** 개요 문장은 흔히 섞여 쓰이는 약한 단어를 빼고 점수로 판단한다. */
const SUMMARY_RULES = [
  ["임신·출산", /(임신|출산|산모|산후|신생아|난임|임산부|분만)/g],
  ["입양·위탁", /(입양|가정위탁|위탁아동|자립준비청년|보호종료아동)/g],
  ["보육", /(보육|어린이집|유치원|양육수당|아이돌봄|영유아)/g],
  ["정신건강", /(정신건강|심리|자살|우울|트라우마|중독|치매)/g],
  ["에너지", /(에너지|난방비|연료비|연탄|냉방비|등유|보일러|전기요금|가스요금)/g],
  ["주거", /(주거|주택|월세|전세|임대주택|집수리|주택개량)/g],
  ["일자리", /(일자리|취업|구직|고용|창업|직업훈련|근로|공공근로|채용)/g],
  ["교육", /(교육비|학습|장학|학비|학교|학생|교재|진학|입학|방과후|수강)/g],
  ["법률", /(법률|소송|변호|후견)/g],
  ["서민금융", /(융자|대출|이자|적금|저축|자산형성|채무|신용회복|금융)/g],
  ["안전·위기", /(긴급지원|위기가구|재난|재해|피해자|폭력|학대|구호|범죄|화재|장례|장제|무연고|행려|노숙)/g],
  ["신체건강", /(의료비|진료|치료|건강검진|검진|예방접종|접종|치과|수술|재활|보청기|틀니|질환|병원)/g],
  ["보호·돌봄", /(돌봄|요양|간병|활동지원|재가|주간보호|쉼터|장기요양|도시락|급식|밑반찬|목욕|이미용|안부)/g],
  ["문화·여가", /(문화|여가|체육|스포츠|관광|여행|공연|레저)/g],
];
function inferTopic(text, rules = NAME_RULES) {
  for (const [topic, pattern] of rules) if (pattern.test(text)) return topic;
  return null;
}
function inferFromSummary(text) {
  let best = null;
  let bestScore = 0;
  for (const [topic, pattern] of SUMMARY_RULES) {
    const score = new Set([...String(text).matchAll(pattern)].map((match) => match[0])).size;
    if (score > bestScore) {
      best = topic;
      bestScore = score;
    }
  }
  return best;
}
const normTopic = (value) => value.replace(/\s*[·ㆍ]\s*/g, "·").trim();
function classify(name, summary, rawTopics, provision) {
  const tags = [...new Set(rawTopics.map(normTopic).filter((topic) => TOPIC_ORDER.includes(topic)))];
  const fromName = inferTopic(name);
  const financial = FINANCE.test(name + " " + summary) || provision.some((item) => /융자/.test(item));
  let source = "복지로";
  let topics = tags;
  if (tags.includes("서민금융")) {
    // 복지로 지자체 자료는 현금지급 사업 상당수에 '서민금융'이 붙어 있어 실제 금융 사업에만 남긴다.
    if (!financial) topics = tags.filter((topic) => topic !== "서민금융");
    if (fromName && fromName !== "서민금융" && !topics.includes(fromName)) topics = [fromName, ...topics];
    if (topics.join() !== tags.join()) source = "보정";
  }
  if (topics.length === 0) {
    topics = [fromName ?? inferFromSummary(summary) ?? "생활지원"];
    source = tags.length > 0 ? "보정" : "추정";
  }
  const primary = fromName && topics.includes(fromName) ? fromName : topics[0];
  topics = [primary, ...topics.filter((topic) => topic !== primary)];
  return { topics, source };
}
const ordered = (values, order) => {
  const list = [...new Set(values.map(normTopic))];
  return list.filter((value) => order.includes(value)).sort((a, b) => order.indexOf(a) - order.indexOf(b));
};
const PROVISION_LABEL = { "전자바우처(바우처)": "전자바우처", "프로그램/서비스(서비스)": "프로그램/서비스" };

function parseLaw(row) {
  const text = String(row.nm ?? "").replace(/\s+/g, " ").trim();
  if (!text) return null;
  const match = text.match(/^(.*?)\s*(제\s*\d+\s*조.*)$/);
  const name = (match ? match[1] : text).replace(/[,，]\s*$/, "").trim();
  const article = match ? match[2].trim() : undefined;
  const url = lawUrl(name) ?? (/^https?:/.test(row.cn ?? "") ? row.cn : undefined);
  return { name: name || text, article, kind: lawKind(name || text), url: url ?? undefined };
}
const NAMED_STEPS = { 신청접수: "001", 조사: "002", 결정: "003", 이의신청: "004", 급여지급: "005", 사후관리: "006" };
function stepCode(row) {
  const name = String(row.nm ?? "").trim();
  if (NAMED_STEPS[name]) return NAMED_STEPS[name];
  if (/^00[1-6]$/.test(name)) return name;
  if (/^\d{3}$/.test(name) && row.ord >= 1 && row.ord <= 6) return "00" + row.ord;
  return null;
}
function splitAddr(addr, org) {
  if (org === "중앙부처") return { sido: "", sigungu: "" };
  const tokens = String(addr ?? "").trim().split(/\s+/).filter(Boolean);
  const sido = tokens[0] ?? "";
  let sigungu = tokens.slice(1).join(" ");
  if (/교육청$/.test(sigungu) || sigungu === sido) sigungu = "";
  return { sido, sigungu };
}

// ---------------------------------------------------------------- load 복지로
const listItems = new Map();
for (const file of FROM_ITEMS ? [] : fs.readdirSync(path.join(RAW, "list")).sort()) {
  const page = readJson(path.join(RAW, "list", file));
  for (const item of page.c) if (!listItems.has(item.WLFARE_INFO_ID)) listItems.set(item.WLFARE_INFO_ID, { ...item, org: "중앙부처" });
  for (const item of page.l) if (!listItems.has(item.WLFARE_INFO_ID)) listItems.set(item.WLFARE_INFO_ID, { ...item, org: "지자체" });
}
const missing = [];
const rawById = new Map();
for (const [id, item] of listItems) {
  const file = path.join(RAW, "detail", id + ".json");
  if (!fs.existsSync(file)) {
    missing.push(id);
    continue;
  }
  const detail = readJson(file);
  const info = detail.info ?? {};
  const tags = parseTags(info.cmmCdNm, item.RETURN_STR);
  const provision = [...new Set((tags.WLBZSL_TCD ?? splitTop(info.wlbzslTcdnm)).map((value) => PROVISION_LABEL[value] ?? value))];
  const name = String(info.wlfareInfoNm ?? item.WLFARE_INFO_NM).replace(/\s+/g, " ").trim();
  const summary = htmlToText(info.wlfareInfoOutlCn ?? item.WLFARE_INFO_OUTL_CN);
  const { topics, source } = classify(name, summary, tags.INTRS_THEMA_CD ?? [], provision);
  const dept = String(info.bizChrDeptNm ?? item.BIZ_CHR_INST_NM ?? "").replace(/\s+/g, " ").trim();
  // 목록 주소와 상세 주소 중 시도부터 적힌 더 완전한 쪽을 쓴다.
  const addrText =
    [item.ADDR, info.addr]
      .map((value) => String(value ?? "").replace(/\s+/g, " ").trim())
      .filter(Boolean)
      .sort((a, b) => Number(LOCAL_PREFIX.test(b) || /교육청$/.test(b.split(" ")[0])) - Number(LOCAL_PREFIX.test(a) || /교육청$/.test(a.split(" ")[0])) || b.split(" ").length - a.split(" ").length)[0] ?? "";
  let { sido, sigungu } = splitAddr(addrText, item.org);
  if (item.org === "지자체") {
    if (/교육청$/.test(sido)) {
      sido = sido.replace(/교육청$/, "");
      if (sido === "광주광역시" || sido === "전라남도") sido = "전남광주통합특별시";
    }
    const deptTokens = dept.split(" ");
    if (!sido && LOCAL_PREFIX.test(dept)) sido = deptTokens[0];
    // 주소가 시도까지만 있으면 담당부서 이름의 시군구를 쓴다. 예: 전남광주통합특별시 순천시 시민복지국
    if (!sigungu && deptTokens.length > 2 && /^[가-힣]{1,5}(시|군|구)$/.test(deptTokens[1])) sigungu = deptTokens[1];
  }
  const contacts = [];
  for (const row of detail.dtl.filter((entry) => entry.cd === "010")) {
    const value = String(row.cn ?? "").trim();
    if (value && !contacts.some((entry) => entry.value === value)) contacts.push({ name: String(row.nm ?? "").trim(), value });
  }
  const main = String(info.rprsCtadr ?? item.RPRS_CTADR ?? "").trim();
  if (main && !contacts.some((entry) => entry.value.replace(/\D/g, "") === main.replace(/\D/g, ""))) contacts.unshift({ name: "대표문의", value: main });
  const websites = detail.dtl
    .filter((entry) => entry.cd === "020" && /^https?:/i.test(String(entry.cn ?? "").trim()))
    .map((entry) => ({ name: String(entry.nm ?? "").trim() || "관련 웹사이트", url: String(entry.cn).trim() }));
  // 복지로는 서식이 없을 때 「첨부파일없음.hwp」 같은 빈 자리 파일을 올려 두므로 서식으로 치지 않는다.
  const forms = [
    ...new Set(
      detail.dtl
        .filter((entry) => entry.cd === "040")
        .map((entry) => String(entry.nm ?? entry.file ?? "").trim())
        .filter((name) => name && !/^(첨부\s*파일|서식|해당)?\s*없음(\.[a-z0-9]+)?$/i.test(name)),
    ),
  ];
  const laws = [];
  for (const row of detail.dtl.filter((entry) => entry.cd === "030")) {
    const law = parseLaw(row);
    if (law && !laws.some((entry) => entry.name === law.name && entry.article === law.article)) laws.push(law);
  }
  const steps = [];
  for (const row of detail.dtl.filter((entry) => entry.cd === "070").sort((a, b) => (a.ord ?? 0) - (b.ord ?? 0))) {
    const code = stepCode(row);
    const org = String(row.cn ?? "").trim();
    if (code && org) steps.push({ code, org });
  }
  const ages = info.wlfareInfoAggrpCdnm || (tags.WLFARE_INFO_AGGRP_CD ?? []).join(", ");
  rawById.set(id, {
    id,
    name,
    summary,
    org: item.org,
    sido,
    sigungu,
    inst: item.org === "중앙부처" ? String(info.bizChrInstNm ?? "").trim() || undefined : undefined,
    dept: dept || undefined,
    provision,
    cycle: tags.CYC_CD ?? [],
    applyMethods: tags.APLY_MTD_DCD ?? splitTop(info.aplyMtdDcdnm),
    applicants: tags.WLFBZ_APLCNT_TCD ?? [],
    changeEvents: tags.FLCTN_TRGT_TCD ?? [],
    ages: ages || undefined,
    online: info.onapPsbltYn === "Y",
    updatedAt: /^\d{4}-\d{2}-\d{2}$/.test(info.lastChgPtm ?? "") ? info.lastChgPtm : undefined,
    startDate: ymd(item.ENFC_BGNG_YMD),
    endDate: ymd(item.ENFC_END_YMD),
    target: htmlToText(info.wlfareSprtTrgtCn) || undefined,
    selection: htmlToText(info.wlfareSprtTrgtSlcrCn) || undefined,
    benefit: htmlToText(info.wlfareSprtBnftCn) || undefined,
    applyText: htmlToText(info.aplyMtdDc) || undefined,
    contacts,
    websites,
    forms,
    laws,
    steps,
    topics,
    topicSource: source,
    lifecycle: ordered(tags.BKJR_LFTM_CYC_CD ?? [], LIFECYCLE_ORDER),
    household: ordered(tags.FMLY_CIRC_CD ?? [], HOUSEHOLD_ORDER),
    talkRefs: [],
    priority: 0,
  });
}
if (missing.length > 0) console.warn("상세 미수집", missing.length, missing.slice(0, 10).join(","));
const mergedNames = new Map();
if (FROM_ITEMS) {
  for (const file of fs.readdirSync(FROM_ITEMS).filter((name) => name.endsWith(".json")).sort()) {
    const payload = readJson(path.join(FROM_ITEMS, file));
    if (payload.kind === "auto") rawById.set(payload.raw.id, { ...payload.raw, talkRefs: [], priority: 0 });
    else if (payload.kind === "curated" && payload.extra.bokjiro) rawById.set(payload.extra.bokjiroIds[0], { ...payload.extra.bokjiro, talkRefs: [], priority: 0 });
    else if (payload.kind === "alias" && payload.name) mergedNames.set(file.replace(/\.json$/, ""), payload.name);
  }
}

// ---------------------------------------------------------------- 최신 자료 반영(data/welfare100/bokjiro-edits.json)
// 복지로 원자료가 지난 내용일 때 확인한 최신 자료로 고치거나 지운다. 복지로 자료를 다시 받아도 이 파일이 다시 적용된다.
// 재연결 점검의 사업 파일에는 이미 반영돼 있으므로 다시 적용하지 않는다.
const EDITABLE_FIELDS = new Set(["name", "summary", "target", "selection", "benefit", "applyText", "contacts", "websites", "forms", "applyMethods", "startDate", "endDate", "steps", "household"]);
const bokjiroEdits = FROM_ITEMS ? {} : readJson(path.join(DATA, "bokjiro-edits.json"));
for (const entry of bokjiroEdits.remove ?? []) {
  if (!rawById.delete(entry.id)) console.warn("삭제 대상이 복지로 목록에 없음", entry.id, entry.name);
}
for (const [id, entry] of Object.entries(bokjiroEdits.edit ?? {})) {
  const raw = rawById.get(id);
  if (!raw) {
    console.warn("수정 대상이 복지로 목록에 없음", id);
    continue;
  }
  if (!entry.checkedAt || !entry.note || !Array.isArray(entry.sources) || entry.sources.length === 0) {
    throw new Error("bokjiro-edits.json " + id + ": checkedAt·note·sources가 필요합니다.");
  }
  const previousName = raw.name;
  for (const [key, value] of Object.entries(entry.set ?? {})) {
    if (!EDITABLE_FIELDS.has(key)) throw new Error("bokjiro-edits.json " + id + ": 고칠 수 없는 필드 " + key);
    raw[key] = value;
  }
  raw.edit = {
    checkedAt: entry.checkedAt,
    ...(raw.name !== previousName ? { previousName } : {}),
    note: entry.note,
    fields: Object.keys(entry.set ?? {}),
    sources: entry.sources.map((source) => ({ label: String(source.label), url: String(source.url) })),
    ...(entry.verify?.length ? { verify: entry.verify } : {}),
  };
}

// ---------------------------------------------------------------- curated 100
for (const raw of rawById.values()) raw.laws = applyLegalLinkReviews(raw.id, raw.laws);
const manualTitles = readJson(path.join(DATA, "manuals.json"));
const programs = readJson(path.join(DATA, "programs.json"));
const records = new Map();
for (const file of fs.readdirSync(DATA).filter((name) => /^records-\d+\.json$/.test(name)).sort()) for (const record of readJson(path.join(DATA, file))) records.set(record.s, record);
const curatedMap = readJson(path.join(DATA, "curated-bokjiro.json"));
const CURATED_LOCAL = {
  "jeju-value-care": ["제주특별자치도", ""],
  "jeju-citizen-safety-insurance": ["제주특별자치도", ""],
  "seogwipo-warm-store": ["제주특별자치도", "서귀포시"],
  "vulnerable-fire-support": ["제주특별자치도", "서귀포시"],
  "memorial-cemetery": ["제주특별자치도", "서귀포시"],
};
const aliasOf = new Map();
for (const [slug, entry] of Object.entries(curatedMap)) for (const id of entry.merge) aliasOf.set(id, slug);

// ---------------------------------------------------------------- 복지톡 DB matching
const norm = (value) => String(value ?? "").normalize("NFC").replace(/[\s·ㆍ･・.,()\[\]「」『』<>〈〉《》"'‘’“”\-–—_/:;!?※*#~+&%]/g, "").toLowerCase();
const regionWords = new Set();
for (const raw of rawById.values()) for (const token of [raw.sido, ...(raw.sigungu ?? "").split(" ")].filter(Boolean)) {
  regionWords.add(token);
  const short = token.replace(/(특별자치도|특별자치시|통합특별시|광역시|특별시|도|시|군|구)$/, "");
  if (short.length >= 2) regionWords.add(short);
}
function variants(name) {
  const out = [];
  const full = norm(name);
  if (full.length >= 4) out.push([full, 0]);
  let tokens = String(name).trim().split(/\s+/);
  while (tokens.length > 1 && (/^\(?\d{2,4}년?\)?$/.test(tokens[0]) || regionWords.has(tokens[0]) || regionWords.has(tokens[0].replace(/(형|시|군|구)$/, "")))) tokens = tokens.slice(1);
  const core = norm(tokens.join(" ").replace(/^[\[(【][^\])】]*[\])】]\s*/, ""));
  if (core !== full && core.length >= 5) out.push([core, 1]);
  const bare = core.replace(/(지원사업|사업|지원|지급|운영)$/, "");
  if (bare !== core && bare.length >= 5) out.push([bare, 2]);
  return out;
}
class AhoCorasick {
  constructor() {
    this.next = [new Map()];
    this.fail = [0];
    this.out = [[]];
  }
  add(word, payload) {
    let state = 0;
    for (const ch of word) {
      let target = this.next[state].get(ch);
      if (target === undefined) {
        target = this.next.length;
        this.next.push(new Map());
        this.fail.push(0);
        this.out.push([]);
        this.next[state].set(ch, target);
      }
      state = target;
    }
    this.out[state].push(payload);
  }
  build() {
    const queue = [...this.next[0].values()];
    while (queue.length) {
      const state = queue.shift();
      for (const [ch, target] of this.next[state]) {
        queue.push(target);
        let fallback = this.fail[state];
        while (fallback && !this.next[fallback].has(ch)) fallback = this.fail[fallback];
        const candidate = this.next[fallback].get(ch);
        this.fail[target] = candidate !== undefined && candidate !== target ? candidate : 0;
        this.out[target] = this.out[target].concat(this.out[this.fail[target]]);
      }
    }
  }
}
const matchNames = new Map();
// 복지톡 DB 원문은 최신 이름과 복지로에 등록된 원래 이름 모두로 찾는다.
for (const raw of rawById.values()) matchNames.set(raw.id, raw.edit?.previousName ? [raw.name, raw.edit.previousName] : [raw.name]);
for (const program of programs) {
  const names = [program.name];
  for (const id of curatedMap[program.slug]?.merge ?? []) {
    const name = rawById.get(id)?.name ?? mergedNames.get(id);
    if (name) names.push(name);
    else if (FROM_ITEMS) console.warn("재연결 점검: 합쳐진 복지로 사업 이름 없음", program.slug, id);
  }
  matchNames.set("curated:" + program.slug, names);
}
const automaton = new AhoCorasick();
const patternOwners = new Map();
for (const [owner, names] of matchNames) {
  for (const name of names) {
    for (const [pattern, level] of variants(name)) {
      if (!patternOwners.has(pattern)) {
        patternOwners.set(pattern, []);
        automaton.add([...pattern], pattern);
      }
      patternOwners.get(pattern).push([owner, level]);
    }
  }
}
automaton.build();
const manualLines = new Map();
const matches = new Map();
for (const file of fs.readdirSync(MANUALS).filter((name) => /^\d{2}\.md$/.test(name)).sort()) {
  const key = file.slice(0, 2);
  const lines = fs.readFileSync(path.join(MANUALS, file), "utf8").split(/\r?\n/);
  manualLines.set(key, lines);
  for (let index = 0; index < lines.length; index++) {
    const heading = /^#{1,6}\s/.test(lines[index]);
    let state = 0;
    for (const ch of norm(lines[index])) {
      while (state && !automaton.next[state].has(ch)) state = automaton.fail[state];
      state = automaton.next[state].get(ch) ?? 0;
      for (const pattern of automaton.out[state]) {
        for (const [owner, level] of patternOwners.get(pattern)) {
          let byManual = matches.get(owner);
          if (!byManual) matches.set(owner, (byManual = new Map()));
          let hit = byManual.get(key);
          if (!hit) byManual.set(key, (hit = { count: 0, line: index + 1, level, pattern, headingLine: 0, headingLevel: 9 }));
          hit.count++;
          if (level < hit.level) {
            hit.level = level;
            hit.line = index + 1;
            hit.pattern = pattern;
          }
          if (heading && (!hit.headingLine || level < hit.headingLevel)) {
            hit.headingLine = index + 1;
            hit.headingLevel = level;
          }
        }
      }
    }
  }
}
const BROAD_MANUALS = new Set(["02", "07", "08", "12", "13", "29", "33"]);
const cleanManualLine = (line) =>
  line
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<\/t[dh]>/gi, " · ")
    .replace(/<\/tr>/gi, " / ")
    .replace(/<[^>]+>/g, "")
    .replace(/^#{1,6}\s*/, "")
    .replace(/\*\*/g, "")
    .replace(/\|/g, " · ")
    .replace(/(\s·\s)+/g, " · ")
    .replace(/^[\s·]+|[\s·]+$/g, "")
    .replace(/\s+/g, " ")
    .trim();
const isNoise = (line) => !line || /^[-:|\s·]+$/.test(line) || /^\d+$/.test(line);
/** 긴 줄(표 등)에서는 제도명이 나온 위치 앞뒤만 잘라 온다. */
function windowAround(text, pattern) {
  if (!pattern || text.length <= 420) return text;
  const map = [];
  let normalized = "";
  for (let index = 0; index < text.length; index++) {
    const piece = norm(text[index]);
    for (const ch of piece) {
      normalized += ch;
      map.push(index);
    }
  }
  const at = normalized.indexOf(pattern);
  if (at < 0) return text.slice(0, 420);
  const start = Math.max(0, map[at] - 140);
  const end = Math.min(text.length, map[at] + 300);
  return (start > 0 ? "… " : "") + text.slice(start, end).trim() + (end < text.length ? " …" : "");
}
function excerptAt(key, line, isHeading, pattern) {
  const lines = manualLines.get(key);
  let heading;
  const parts = [];
  if (isHeading) {
    heading = cleanManualLine(lines[line - 1]);
    for (let index = line; index < lines.length && index < line + 40; index++) {
      if (/^#{1,6}\s/.test(lines[index]) && parts.join(" ").length > 80) break;
      const text = cleanManualLine(lines[index]);
      if (!isNoise(text)) parts.push(text);
      if (parts.join(" ").length > 560) break;
    }
  } else {
    for (let index = line - 1; index >= Math.max(0, line - 80); index--) {
      if (/^#{1,6}\s/.test(lines[index])) {
        heading = cleanManualLine(lines[index]);
        break;
      }
    }
    for (let index = Math.max(0, line - 2); index < Math.min(lines.length, line + 4); index++) {
      let text = cleanManualLine(lines[index]);
      if (index === line - 1) text = windowAround(text, pattern);
      else if (text.length > 420) continue;
      if (!isNoise(text)) parts.push(text);
    }
  }
  return { heading: heading ? clip(heading, 80) : undefined, excerpt: clip(parts.join(" "), 560) };
}
function talkRefsFor(owner, limit = 3) {
  const byManual = matches.get(owner);
  if (!byManual) return [];
  const sido = rawById.get(owner)?.sido ?? "";
  const sigungu = rawById.get(owner)?.sigungu ?? "";
  const refLine = (hit) => hit.headingLine || hit.line;
  // 점수 상위 limit개를 먼저 고른 뒤 범위 규칙·검수 제외를 적용한다. 제외한 자리를 다음 순위 연결이 채우면
  // 다시 만들 때마다 검수하지 않은 연결이 새로 생기므로, 빈자리는 비워 둔다.
  return [...byManual]
    .map(([key, hit]) => {
      let score = (hit.headingLine ? 100 : 0) + (hit.level === 0 ? 40 : hit.level === 1 ? 20 : 0) + Math.min(hit.count, 30);
      if (BROAD_MANUALS.has(key)) score -= 25;
      return { key, hit, score };
    })
    .sort((a, b) => b.score - a.score || a.key.localeCompare(b.key))
    .slice(0, limit)
    .filter(({ key, hit }) => manualLinkAllowed(key, sido, owner, refLine(hit), manualLines.get(key)?.[refLine(hit) - 1]) && !listRowMismatch(key, manualLines.get(key)?.[refLine(hit) - 1], sido, sigungu))
    .map(({ key, hit }) => {
      const useHeading = Boolean(hit.headingLine);
      const line = useHeading ? hit.headingLine : hit.line;
      const { heading, excerpt } = excerptAt(key, line, useHeading, hit.pattern);
      return {
        key,
        title: manualTitles[key] ?? "복지톡 DB",
        line,
        heading,
        match: (useHeading ? hit.headingLevel : hit.level) === 0 ? "제도명 일치" : "관련 언급",
        count: hit.count,
        excerpt,
      };
    })
    .filter((ref) => ref.excerpt.length > 0);
}
for (const raw of rawById.values()) raw.talkRefs = talkRefsFor(raw.id);

// ---------------------------------------------------------------- priority and payloads
const ko = (a, b) => a.localeCompare(b, "ko");
let priority = 100;
const central = [...rawById.values()].filter((raw) => raw.org === "중앙부처" && !aliasOf.has(raw.id)).sort((a, b) => ko(a.name, b.name) || ko(a.id, b.id));
const local = [...rawById.values()]
  .filter((raw) => raw.org === "지자체" && !aliasOf.has(raw.id))
  .sort((a, b) => ko(a.sido, b.sido) || ko(a.sigungu ?? "", b.sigungu ?? "") || ko(a.name, b.name) || ko(a.id, b.id));
for (const raw of [...central, ...local]) raw.priority = ++priority;

fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(path.join(OUT, "items"), { recursive: true });
const rows = [];
let bytes = 0;
const writeItem = (slug, payload) => {
  const json = JSON.stringify(payload);
  bytes += Buffer.byteLength(json);
  fs.writeFileSync(path.join(OUT, "items", slug + ".json"), json);
};
const serviceName = (id) => (aliasOf.has(id) ? programs.find((program) => program.slug === aliasOf.get(id))?.name : rawById.get(id)?.name);
const problems = [];
/** 업무구조도가 화면에서 깨지지 않도록 노드·레인·단계·연결을 점검한다. */
function validate(institution) {
  const process = institution.process;
  const issues = [];
  if (!process || process.nodes.length < 2) issues.push("노드 부족");
  else {
    const ids = new Set(process.nodes.map((node) => node.id));
    for (const node of process.nodes) {
      if (!process.lanes.includes(node.lane)) issues.push(node.id + " 레인 없음");
      if (!process.stages.includes(node.stage)) issues.push(node.id + " 단계 없음");
    }
    for (const edge of process.edges) if (!ids.has(edge.source) || !ids.has(edge.target)) issues.push(edge.id + " 연결 끊김");
  }
  if (!institution.name) issues.push("이름 없음");
  if (issues.length > 0) problems.push(institution.slug + ": " + issues.join(", "));
}

for (const meta of [...programs].sort((a, b) => a.no - b.no)) {
  const record = records.get(meta.slug);
  if (!record) continue;
  const entry = curatedMap[meta.slug] ?? { merge: [], related: [] };
  const merged = entry.merge.map((id) => rawById.get(id)).filter(Boolean);
  const primary = merged[0];
  const [sido, sigungu] = CURATED_LOCAL[meta.slug] ?? [primary?.sido ?? "", primary?.sigungu ?? ""];
  const extra = {
    org: CURATED_LOCAL[meta.slug] ? "지자체" : primary?.org ?? "중앙부처",
    sido,
    sigungu,
    bokjiro: primary ? { ...primary, talkRefs: [], priority: meta.no } : undefined,
    bokjiroIds: entry.merge.filter((id) => rawById.has(id) || mergedNames.has(id)),
    talkRefs: talkRefsFor("curated:" + meta.slug),
    relatedServices: entry.related
      .filter((id) => rawById.has(id))
      .map((id) => ({ slug: aliasOf.get(id) ?? id, name: serviceName(id) ?? id })),
  };
  const institution = expandRecord(meta, record, manualTitles, extra);
  validate(institution);
  rows.push(toCatalogRow(institution));
  writeItem(meta.slug, { kind: "curated", meta, record, extra });
  for (const id of entry.merge) {
    const name = rawById.get(id)?.name ?? mergedNames.get(id);
    writeItem(id, { kind: "alias", slug: meta.slug, ...(name ? { name } : {}) });
  }
}
for (const raw of [...central, ...local]) {
  const institution = expandBokjiro(raw);
  validate(institution);
  rows.push(toCatalogRow(institution));
  writeItem(raw.id, { kind: "auto", raw });
}
rows.sort((a, b) => a.no - b.no);
const index = {
  asOf: BOKJIRO_AS_OF,
  source: "복지로 복지서비스(중앙부처·지자체) + 복지톡 DB 사업안내 매뉴얼",
  total: rows.length,
  items: rows,
};
const indexJson = JSON.stringify(index);
fs.writeFileSync(path.join(OUT, "index.json"), indexJson);
const splitBytes = writeSplitIndex(OUT, index, REGISTRY_PATH);

const count = (predicate) => rows.filter(predicate).length;
if (problems.length > 0) {
  console.error("업무구조도 점검 실패", problems.length, problems.slice(0, 20));
  process.exitCode = 1;
}
console.log(
  JSON.stringify(
    {
      total: rows.length,
      curated: count((row) => row.a === 1),
      central: count((row) => row.g === 0),
      local: count((row) => row.g === 1),
      withTalk: count((row) => row.k > 0),
      topicSources: [...rawById.values()].reduce((acc, raw) => ((acc[raw.topicSource] = (acc[raw.topicSource] ?? 0) + 1), acc), {}),
      indexBytes: Buffer.byteLength(indexJson),
      ...splitBytes,
      itemBytes: bytes,
      missingDetails: missing.length,
    },
    null,
    1,
  ),
);

// 복지톡 DB 연결(합본 Markdown 줄)에 원본 파일·PDF 쪽·원문 발췌를 붙인다. 화면은 줄 번호 대신 이 값을 보여 준다.
await import("./attach-manual-pages.mjs");
