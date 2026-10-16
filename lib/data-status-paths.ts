export type DomainId = "official" | "welfare100" | "news" | "fiscal" | "statistics" | "manuals" | "mcp" | "law";
export type DomainState = "정상" | "일부 제공" | "갱신 지연" | "미제공" | "확인 실패";

export interface DomainStatus {
  readonly domain: DomainId;
  readonly label: string;
  readonly state: DomainState;
  readonly sourceAsOf: string | null;
  readonly lastSuccessAt: string | null;
  readonly verification: string;
  readonly available: readonly string[];
  readonly limitations: readonly string[];
}

export interface DataStatusReport {
  readonly checkedAt: string;
  readonly domains: readonly DomainStatus[];
}

export const PATH_DOMAINS: readonly (readonly [string, readonly DomainId[]])[] = [
  ["/welfare100", ["welfare100"]],
  ["/wiki", ["official"]],
  ["/news", ["news"]],
  ["/budget", ["fiscal"]],
  ["/statistics", ["statistics"]],
  ["/welfaremcp", ["mcp", "manuals", "law"]],
  ["/sources", ["official", "welfare100", "news", "fiscal", "statistics", "manuals", "mcp", "law"]],
  ["/", ["official"]],
];

