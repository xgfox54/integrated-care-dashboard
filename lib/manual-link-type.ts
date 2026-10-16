import type { TalkRef } from "./welfare100/catalog-types.ts";
import { assessManualProvenance } from "./manual-link-provenance.ts";
import type { ManualLinkProvenance } from "./manual-link-provenance.ts";

export type ManualLinkType = "A" | "B" | "C" | "CANDIDATE";

export interface ManualLinkAssessment {
  readonly type: ManualLinkType;
  readonly label: "전용 매뉴얼" | "본문 직접 설명" | "종합안내서 설명" | "연결 후보";
  readonly confirmed: boolean;
  readonly basis: string;
  readonly titleYear: number | null;
  readonly yearNote: string | null;
  readonly provenance: ManualLinkProvenance;
}

export const COMPREHENSIVE_MANUAL_KEYS: ReadonlySet<string> = new Set(["02", "07", "08", "11", "12", "13", "29", "33", "38"]);

const normalize = (value: string) => value.normalize("NFKC").replace(/[\s·ㆍ()[\]「」『』<>\-_.,]/g, "").toLowerCase();

const HEADING_NUMBER = /^\s*(?:제\s*\d+\s*[장절편부]|\d+(?:\s*[-.]\s*\d+)*[.)]?|[가-하][.)]|[IVX]+[.)]|[①-⑳])\s+/i;
const HEADING_SUFFIX = /(?:사업\s*운영\s*안내|사업\s*안내|운영\s*안내|안내)\s*$/;
const headingText = (heading: string) => heading.normalize("NFKC").replace(/^\s*#{1,6}\s*/, "").replace(/^\s*(?:\d+[.)]|[가-하][.)]|[IVX]+[.)])\s*/i, "").replace(HEADING_NUMBER, "");
const headingIdentities = (heading: string) => [normalize(headingText(heading)), normalize(headingText(heading).replace(HEADING_SUFFIX, ""))];
const manualTitleCore = (title: string) => title.replace(/^\s*\[[^\]]*\]\s*/, "").replace(/^20\d{2}\s*년?도?\s*/, "").replace(/[★☆]/g, "").replace(/\(개정\)\s*$/, "");
const MANUAL_SUFFIX = /\s*(?:사업안내서|사업안내|운영안내|안내서|안내|매뉴얼)\s*$/;
const manualIdentities = (title: string) => {
  const core = manualTitleCore(title).replace(MANUAL_SUFFIX, "");
  return [normalize(core), normalize(core.replace(/\s*사업\s*$/, ""))];
};

export function manualTitleYear(title: string): number | null {
  const match = title.match(/(20\d{2})\s*년/);
  return match ? Number(match[1]) : null;
}

export function assessManualLink(ref: Pick<TalkRef, "key" | "title" | "heading" | "match" | "original" | "review">, programName: string, programYear: number | null = null): ManualLinkAssessment {
  const name = normalize(programName);
  const titleYear = manualTitleYear(ref.title);
  const yearNote = titleYear === null
    ? null
    : programYear !== null && programYear !== titleYear
      ? "연도 불일치: 매뉴얼 제목 " + titleYear + "년, 제도 자료 " + programYear + "년"
      : "매뉴얼 제목의 " + titleYear + "년은 자료 판본 표기이며 제도 적용연도 확정값이 아닙니다.";
  const provenance = assessManualProvenance(ref.original);
  const candidate = (basis: string): ManualLinkAssessment => ({ type: "CANDIDATE", label: "연결 후보", confirmed: false, basis, titleYear, yearNote, provenance });
  if (provenance.status === "INVALID") return candidate("원본 위치 정보 오류: " + provenance.issues.join(", "));
  if (ref.review?.decision === "RECHECK") return candidate("원문이 검수 때와 달라져 검수 판정을 적용하지 않았습니다. 재검수가 필요합니다.");
  if (ref.review?.decision === "LIST_ENTRY") return candidate("사업 목록 표의 언급입니다. 지원 조건을 직접 설명하는 근거로 사용할 수 없습니다.");
  if (ref.review?.decision === "SAME_NAME_OTHER_CITY") return candidate("다른 지역의 같은 이름 사업입니다. 이 사업의 지원 조건으로 사용할 수 없습니다.");
  if (ref.review?.decision === "GENERAL_STANDARD") return candidate("전국 공통 상담·지원 기준의 설명입니다. 이 지역 사업의 독립된 지원 조건은 확인되지 않았습니다.");
  if (ref.review?.decision === "EXCLUSION_LIST") return candidate("중복 참여 제한·다른 사업의 나열 구간입니다. 이 사업의 직접 설명이 아닙니다.");
  if (ref.review?.decision === "CONTENTS") return candidate("표지·목차의 사업명입니다. 실제 본문 설명 절은 추가 확인이 필요합니다.");
  if (ref.review?.decision === "PENDING") return candidate("연결 범위와 해당 사업의 동일성을 추가 확인해야 합니다. 확정 근거로 사용할 수 없습니다.");
  const headingNamed = name.length >= 3 && headingIdentities(ref.heading ?? "").includes(name);
  const exactName = ref.match === "제도명 일치";
  if (name.length >= 3 && !ref.title.includes("합본") && manualIdentities(ref.title).includes(name)) {
    return { type: "A", label: "전용 매뉴얼", confirmed: true, basis: "판본·안내 표기를 제외한 매뉴얼 제목이 제도명과 일치합니다. 개별 쪽·인용문 검증과는 별개입니다.", titleYear, yearNote, provenance };
  }
  if (ref.review?.decision === "DIRECT" && provenance.status === "DOCUMENT") {
    return { type: "A", label: "전용 매뉴얼", confirmed: true, basis: "원문 검수(" + ref.review.checkedAt + ")에서 합본에 묶인 이 원본 파일이 제도 전용 안내서임을 확인했습니다. 개별 쪽·인용문 검증과는 별개입니다.", titleYear, yearNote, provenance };
  }
  if (ref.original && provenance.status !== "PAGE_QUOTE") return candidate("원본 파일은 연결되어 있으나 직접 설명하는 쪽과 발췌문은 추가 확인이 필요합니다.");
  if (ref.review?.decision === "DIRECT") {
    const comprehensive = COMPREHENSIVE_MANUAL_KEYS.has(ref.key);
    return { type: comprehensive ? "C" : "B", label: comprehensive ? "종합안내서 설명" : "본문 직접 설명", confirmed: true, basis: "원문 검수(" + ref.review.checkedAt + ")에서 이 절이 제도를 직접 설명하는 것을 확인했습니다. 원본 인용 검증과는 별개입니다.", titleYear, yearNote, provenance };
  }
  if (exactName && headingNamed && COMPREHENSIVE_MANUAL_KEYS.has(ref.key)) {
    return { type: "C", label: "종합안내서 설명", confirmed: true, basis: "종합 안내서의 절 제목이 제도명과 일치합니다. 원본 인용 검증과는 별개입니다.", titleYear, yearNote, provenance };
  }
  if (exactName && headingNamed) {
    return { type: "B", label: "본문 직접 설명", confirmed: true, basis: "매뉴얼의 절 제목이 제도명과 일치합니다. 원본 인용 검증과는 별개입니다.", titleYear, yearNote, provenance };
  }
  return candidate(exactName ? "본문에 제도명이 나오지만 그 제도를 다루는 절인지 확인되지 않았습니다." : "관련 단어가 언급된 구간입니다. 같은 제도인지 확인되지 않았습니다.");
}

