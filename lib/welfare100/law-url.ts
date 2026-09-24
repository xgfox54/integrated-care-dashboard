/** 법령·자치법규 이름으로 국가법령정보센터 바로가기 주소를 만든다. */
const LOCAL_PREFIX = /^(서울특별시|부산광역시|대구광역시|인천광역시|광주광역시|대전광역시|울산광역시|세종특별자치시|경기도|강원특별자치도|강원도|충청북도|충청남도|전북특별자치도|전라북도|전라남도|전남광주통합특별시|경상북도|경상남도|제주특별자치도)/;

export function lawUrl(law: string): string | null {
  const compact = law.replace(/\s/g, "");
  if (!compact) return null;
  // "○○ 조례, 시행규칙"처럼 조례와 규칙을 함께 적은 경우 조례 이름으로 잇는다.
  const ordinance = compact.match(/^(.*?조례)(?=[,·및]|$)/);
  if (ordinance) return "https://www.law.go.kr/자치법규/" + encodeURIComponent(ordinance[1]);
  if (/(조례|자치규칙)$/.test(compact)) return "https://www.law.go.kr/자치법규/" + encodeURIComponent(compact);
  if (/규칙$/.test(compact) && !/시행규칙$/.test(compact) && LOCAL_PREFIX.test(compact)) {
    return "https://www.law.go.kr/자치법규/" + encodeURIComponent(compact);
  }
  if (!/(법|령|규칙)$/.test(compact)) return null;
  return "https://www.law.go.kr/법령/" + encodeURIComponent(compact);
}
