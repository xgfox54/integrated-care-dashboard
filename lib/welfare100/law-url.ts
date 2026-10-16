import type { LegalBasisKind } from "./types.ts";

const LOCAL_PREFIX = /^(서울특별시|부산광역시|대구광역시|인천광역시|광주광역시|대전광역시|울산광역시|세종특별자치시|경기도|강원특별자치도|강원도|충청북도|충청남도|전북특별자치도|전라북도|전라남도|전남광주통합특별시|경상북도|경상남도|제주특별자치도)/;

export function normalizeLawName(law: string): string {
  return law.normalize("NFKC").replace(/[ㆍᆞ‧･]/g, "·").replace(/[「」『』｢｣\[\]]/g, "").replace(/^[^가-힣A-Za-z0-9]+/, "").replace(/[\s(]+$/, "").replace(/\s+/g, " ").trim();
}

export function lawKind(law: string): LegalBasisKind {
  const compact = normalizeLawName(law).replace(/\s/g, "");
  if (compact === "헌법" || compact === "대한민국헌법") return "헌법";
  if (/조례/.test(compact)) return /규칙/.test(compact) ? "조례·규칙" : "조례";
  if (LOCAL_PREFIX.test(compact) && /규칙$/.test(compact)) return "조례·규칙";
  if (compact === "지방자치단체의교육경비보조에관한규정" || /시행령$/.test(compact)) return "대통령령";
  if (/총리령$/.test(compact)) return "총리령";
  if (/규칙$/.test(compact)) return "부령";
  if (/(법|법률)$/.test(compact)) return "법률";
  if (/(지침|고시|훈령|예규|요령|규정|기준|계획|안내|매뉴얼|방침|지시)$/.test(compact)) return "고시·지침";
  return "행정규칙";
}

export function lawUrl(law: string): string | null {
  const compact = normalizeLawName(law).replace(/\s/g, "");
  if (!compact) return null;
  if (/(?:조례|규칙|법률|시행령|기본법)[,，·ㆍ/]|조례(?:제)?및|조례시행규칙및/.test(compact)) return null;
  if (/조례.*규칙$/.test(compact)) return "https://www.law.go.kr/자치법규/" + encodeURIComponent(compact);
  if (/(조례|자치규칙)$/.test(compact)) return "https://www.law.go.kr/자치법규/" + encodeURIComponent(compact);
  if (/규칙$/.test(compact) && !/시행규칙$/.test(compact) && LOCAL_PREFIX.test(compact)) {
    return "https://www.law.go.kr/자치법규/" + encodeURIComponent(compact);
  }
  if (/(훈령|예규|고시)$/.test(compact)) return "https://www.law.go.kr/행정규칙/" + encodeURIComponent(compact);
  if (compact !== "지방자치단체의교육경비보조에관한규정" && !/(법|법률|시행령|시행규칙)$/.test(compact)) return null;
  return "https://www.law.go.kr/법령/" + encodeURIComponent(compact);
}
