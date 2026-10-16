export type SensitiveKind = "주민등록번호" | "외국인등록번호" | "여권번호" | "카드번호" | "휴대전화번호" | "이메일";

export interface SensitiveFinding {
  readonly kind: SensitiveKind;
  readonly count: number;
  readonly blocking: boolean;
}

const BLOCKING: ReadonlySet<SensitiveKind> = new Set(["주민등록번호", "외국인등록번호", "여권번호", "카드번호"]);

function validBirthDate(digits: string): boolean {
  const month = Number(digits.slice(2, 4));
  const day = Number(digits.slice(4, 6));
  return month >= 1 && month <= 12 && day >= 1 && day <= 31;
}

function luhn(value: string): boolean {
  let sum = 0;
  for (let index = 0; index < value.length; index += 1) {
    let digit = Number(value[value.length - 1 - index]);
    if (index % 2 === 1) digit = digit * 2 > 9 ? digit * 2 - 9 : digit * 2;
    sum += digit;
  }
  return sum % 10 === 0;
}

export function scanSensitiveText(text: string): SensitiveFinding[] {
  const counts = new Map<SensitiveKind, number>();
  const add = (kind: SensitiveKind) => counts.set(kind, (counts.get(kind) ?? 0) + 1);
  const addAll = (kind: SensitiveKind, pattern: RegExp) => {
    const found = [...text.matchAll(pattern)].length;
    if (found) counts.set(kind, (counts.get(kind) ?? 0) + found);
  };
  for (const match of text.matchAll(/(?<!\d)(\d{6})\s?-\s?([1-8])\d{6}(?!\d)/g)) {
    if (!validBirthDate(match[1])) continue;
    add(Number(match[2]) >= 5 ? "외국인등록번호" : "주민등록번호");
  }
  addAll("여권번호", /(?<![A-Za-z0-9])[MSRODG]\d{8}(?![A-Za-z0-9])/g);
  for (const match of text.matchAll(/(?<!\d)(\d{4})[ -]?(\d{4})[ -]?(\d{4})[ -]?(\d{4})(?!\d)/g)) {
    if (luhn(match.slice(1, 5).join(""))) add("카드번호");
  }
  addAll("휴대전화번호", /(?<!\d)01[016789][ -]?\d{3,4}[ -]?\d{4}(?!\d)/g);
  addAll("이메일", /(?<![A-Za-z0-9._%+-])[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g);
  return [...counts].map(([kind, count]) => ({ kind, count, blocking: BLOCKING.has(kind) }));
}

export function blockingFindings(findings: readonly SensitiveFinding[]): SensitiveFinding[] {
  return findings.filter((finding) => finding.blocking);
}

