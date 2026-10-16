import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

import { normalizeForMatch } from "./manual-pages.mjs";

// 서귀포시 업무자료는 제주 사업과 전국 공통 사업의 근거로만 연결한다. 이름이 비슷한 다른 지역 사업에 붙이면
// 그 지역 담당자가 서귀포시 기준을 자기 사업 조건으로 오해할 수 있다. 시설 목록은 사업 설명이 아니어서 연결하지 않는다.
export const JEJU_LOCAL_MANUALS = new Set(["35", "36", "37", "38"]);
export const DIRECTORY_MANUALS = new Set(["39"]);
const JEJU = "제주특별자치도";

// 원문 줄을 사람이 읽고 내린 연결 판정(data/welfare100/manual-link-reviews.json). 사업 ID는 자동 사업이면 WLF 번호,
// 주요 제도면 slug다. to_key·to_line이 있으면 목차·지나가는 언급에서 그 제도를 다루는 절로 연결을 옮긴다.
// 판정은 줄 번호로 찾지만, 검수한 줄의 내용 지문(line_sha256·to_line_sha256)이 지금 줄과 같을 때만 적용한다.
// 매뉴얼을 다시 파싱하거나 개정판으로 바꿔 줄이 밀리면 지문이 달라져 판정이 엉뚱한 줄에 붙지 않는다.
export const MANUAL_LINK_REVIEWS = JSON.parse(readFileSync(new URL("../../data/welfare100/manual-link-reviews.json", import.meta.url), "utf8"));
const reviewKey = (itemId, key, line) => String(itemId).replace(/^curated:/, "") + "#" + key + "#" + line;
const reviews = new Map();
for (const decision of MANUAL_LINK_REVIEWS.decisions) {
  reviews.set(reviewKey(decision.item, decision.key, decision.line), decision);
  if (decision.to_line) reviews.set(reviewKey(decision.item, decision.to_key, decision.to_line), { ...decision, key: decision.to_key, line: decision.to_line, line_sha256: decision.to_line_sha256, to_key: undefined, to_line: undefined, to_line_sha256: undefined });
}

export function lineFingerprint(text) {
  return createHash("sha256").update(normalizeForMatch(text ?? "")).digest("hex").slice(0, 16);
}

export function manualLinkReview(itemId, key, line) {
  return itemId ? reviews.get(reviewKey(itemId, key, line)) ?? null : null;
}

/** 판정이 지금 원문에 그대로 맞는지. 지문이 없거나 다르면 적용하지 않는다(옮김 판정은 옮길 줄도 확인한다). */
export function manualLinkReviewState(review, lineText, targetText) {
  if (!review.line_sha256 || (review.to_line && !review.to_line_sha256)) return "UNSTAMPED";
  if (lineText === undefined || lineFingerprint(lineText) !== review.line_sha256) return "STALE";
  if (review.to_line && (targetText === undefined || lineFingerprint(targetText) !== review.to_line_sha256)) return "STALE";
  return "OK";
}

export function manualLinkAllowed(key, sido, itemId, line, lineText) {
  if (DIRECTORY_MANUALS.has(key)) return false;
  const review = manualLinkReview(itemId, key, line);
  if (review?.decision === "EXCLUDE" && manualLinkReviewState(review, lineText) === "OK") return false;
  return !JEJU_LOCAL_MANUALS.has(key) || !sido || sido === JEJU;
}

// 02(사회보장급여 공통업무 안내)과 29(사회보장제도 신설변경 협의 지침)에는 전국 지자체 사업을 한 줄씩 나열한 표가 있다.
// 이름이 같아도 다른 지자체의 줄은 그 사업의 근거가 아니다. 예: 제주 신장장애인 의료비 지원 ↔ 공주시 줄.
export const REGION_LIST_MANUALS = new Set(["02", "29"]);
const SIDO = new Map([
  ...["서울특별시", "부산광역시", "대구광역시", "인천광역시", "대전광역시", "울산광역시", "세종특별자치시", "경기도", "강원특별자치도", "충청북도", "충청남도", "전북특별자치도", "전남광주통합특별시", "경상북도", "경상남도", "제주특별자치도"].map((name) => [name, name]),
  ["광주광역시", "전남광주통합특별시"], ["전라남도", "전남광주통합특별시"], ["강원도", "강원특별자치도"], ["전라북도", "전북특별자치도"], ["제주도", "제주특별자치도"],
]);
const SIGUNGU = /^\S+[시군구](?: \S+구)?$/;

export function listRowRegion(line) {
  if (!line?.startsWith("<tr>")) return null;
  const cells = [...line.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((match) => match[1].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim());
  for (const [index, cell] of cells.entries()) {
    const [head, ...rest] = cell.split(" ");
    const sido = SIDO.get(head);
    if (!sido) continue;
    const tail = rest.join(" ");
    if (tail && !SIGUNGU.test(tail)) continue;
    const next = cells[index + 1] ?? "";
    return { sido, sigungu: tail || (SIGUNGU.test(next) ? next : "") };
  }
  return null;
}

export function listRowMismatch(key, line, sido, sigungu) {
  if (!REGION_LIST_MANUALS.has(key)) return false;
  const row = listRowRegion(line);
  if (!row) return false;
  if (!sido || row.sido !== (SIDO.get(sido) ?? sido)) return true;
  if (!row.sigungu) return false;
  return !sigungu || !(row.sigungu.startsWith(sigungu) || sigungu.startsWith(row.sigungu));
}

export function talkSourceKeys(raw) {
  const keys = new Set(raw.talkRefs.map((ref) => ref.key));
  for (const source of raw.edit?.sources ?? []) {
    const match = /^\[(\d{2})\]/.exec(source.label ?? "");
    if (match) keys.add(match[1]);
  }
  return keys.size;
}
