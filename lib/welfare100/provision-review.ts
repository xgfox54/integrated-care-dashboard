export interface ProvisionReview {
  readonly recipientProvision: readonly string[];
  readonly recipientDescription: string;
  readonly providerSettlement: string | null;
  readonly basis: string;
  readonly checkedAt: string;
  readonly effectivePeriodVerified: false;
}

/** Editorial classification of stored descriptions, NOT a claim that current operational rules were verified. */
const REVIEWS: Readonly<Record<string, ProvisionReview>> = {
  "seogwipo-warm-store": {
    recipientProvision: ["현물지급", "프로그램/서비스"],
    recipientDescription: "교환권·식사쿠폰을 이용한 생필품 또는 식사 제공. 주민에게 현금을 직접 지급하는 유형과 구분합니다.",
    providerSettlement: "저장된 운영계획의 참여 가게 비용 정산은 주민이 받는 지원유형과 별개입니다.",
    basis: "복지제도 대장의 지원내용과 연결 운영계획 발췌를 기준으로 분류를 정정했습니다. 원천 분류와 지원조건·금액은 보존합니다.",
    checkedAt: "2026-10-16", effectivePeriodVerified: false,
  },
  "memorial-cemetery": {
    recipientProvision: ["프로그램/서비스"],
    recipientDescription: "충혼묘지 안장·봉안 및 묘역 관리 서비스. 현금급여와 구분합니다.",
    providerSettlement: null,
    basis: "복지제도 대장의 안장·봉안 지원내용을 기준으로 분류를 정정했습니다. 현행 운영·비용 부담 기준은 별도 확인이 필요합니다.",
    checkedAt: "2026-10-16", effectivePeriodVerified: false,
  },
};

export function provisionReviewFor(slug: string): ProvisionReview | null {
  return Object.hasOwn(REVIEWS, slug) ? REVIEWS[slug] : null;
}

export function recipientProvisionOf(slug: string, original: readonly string[]): string[] {
  return [...(provisionReviewFor(slug)?.recipientProvision ?? original)];
}
