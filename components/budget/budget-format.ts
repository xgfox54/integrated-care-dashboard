// 복지예산 화면 공용 금액 표시.
const NUMBER_FORMAT = new Intl.NumberFormat("ko-KR");

/**
 * 지표 카드·지역 순위용 「1,234조 1,234억 원」 표시. 억 단위에서 반올림하고, 1억 원 미만은 만 원 단위로 쓴다.
 * 정확한 원 단위 값은 title과 결과표에 그대로 둔다.
 */
export function formatJoEok(value: string | null): string {
  if (value === null) return "확인 불가";
  const amount = BigInt(value);
  const negative = amount < BigInt(0);
  const absolute = negative ? -amount : amount;
  const sign = negative ? "-" : "";
  const EOK = BigInt(100_000_000);
  if (absolute < EOK) {
    const man = (absolute + BigInt(5_000)) / BigInt(10_000);
    return man === BigInt(0) ? "0원" : sign + NUMBER_FORMAT.format(Number(man)) + "만 원";
  }
  const eokTotal = (absolute + EOK / BigInt(2)) / EOK;
  const jo = eokTotal / BigInt(10_000);
  const eok = eokTotal % BigInt(10_000);
  const parts = [jo > BigInt(0) ? NUMBER_FORMAT.format(Number(jo)) + "조" : "", eok > BigInt(0) ? NUMBER_FORMAT.format(Number(eok)) + "억" : ""].filter(Boolean);
  return sign + parts.join(" ") + " 원";
}
