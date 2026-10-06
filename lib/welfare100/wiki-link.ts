// 통합돌봄 WIKI 사업과 같은 복지제도100 제도를 찾는다.
// 공백·문장부호를 뺀 사업명이 정확히 같고, 지역이 맞는 제도만 잇는다.
// - 중앙부처 제도는 어느 지역 사업과도 잇는다.
// - 지자체 제도는 같은 시·도(시·군·구가 적혀 있으면 같은 시·군·구) 사업과만 잇는다.
// 후보가 여럿이면 사업구분이 '전국'인 사업은 중앙부처 제도를, 그 밖의 사업은 가장 좁은 지역의 제도를 고른다.

export interface WelfareLinkCandidate {
  readonly slug: string;
  readonly name: string;
  readonly org: "중앙부처" | "지자체";
  readonly sido: string;
  readonly sigungu: string;
}

export interface WikiProgramRef {
  readonly name: string;
  readonly sido: string;
  readonly sigungu: string;
  readonly type: string;
}

export function welfareNameKey(value: string): string {
  return value.normalize("NFKC").replace(/[^0-9A-Za-z\uAC00-\uD7A3]/g, "").toLowerCase();
}

export function indexWelfareByName(entries: Iterable<WelfareLinkCandidate>): Map<string, WelfareLinkCandidate[]> {
  const index = new Map<string, WelfareLinkCandidate[]>();
  for (const entry of entries) {
    const key = welfareNameKey(entry.name);
    if (!key) continue;
    const list = index.get(key);
    if (list) list.push(entry);
    else index.set(key, [entry]);
  }
  return index;
}

function regionRank(entry: WelfareLinkCandidate, program: WikiProgramRef): number {
  if (entry.org === "중앙부처") return program.type === "전국" ? 3 : 0;
  if (entry.sido !== program.sido) return -1;
  if (!entry.sigungu) return 1;
  return entry.sigungu === program.sigungu ? 2 : -1;
}

export function pickWelfareLink(
  index: ReadonlyMap<string, readonly WelfareLinkCandidate[]>,
  program: WikiProgramRef,
): WelfareLinkCandidate | null {
  const candidates = index.get(welfareNameKey(program.name)) ?? [];
  let best: WelfareLinkCandidate | null = null;
  let bestRank = -1;
  for (const entry of candidates) {
    const rank = regionRank(entry, program);
    if (rank > bestRank) {
      best = entry;
      bestRank = rank;
    }
  }
  return best;
}
