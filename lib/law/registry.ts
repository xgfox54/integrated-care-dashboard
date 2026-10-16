/** The same immutable index drives discovery and execution; no global upstream registry. */
export interface RegistryEntry<Client, Output> {
  readonly name: string;
  readonly description: string;
  readonly schema: { parse(input: unknown): unknown; readonly shape?: Record<string, unknown> };
  readonly handler: (client: Client, input: never) => Promise<Output>;
}
const RESERVED = new Set(["discover_tools", "execute_tool"]);

export function createReadOnlyRegistry<Client, Output>(entries: readonly RegistryEntry<Client, Output>[]) {
  const index = new Map<string, RegistryEntry<Client, Output>>();
  for (const entry of entries) {
    if (RESERVED.has(entry.name) || index.has(entry.name)) throw new Error("Invalid or duplicate registered tool name");
    index.set(entry.name, Object.freeze({ ...entry }));
  }
  const names = Object.freeze([...index.keys()]);
  return Object.freeze({
    names,
    discover(intent: string): string {
      const tokens = intent.toLowerCase().split(/[\s,;()]+/).filter((token) => token.length > 1).slice(0, 40);
      const ranked = [...index.values()].map((entry) => ({
        entry,
        score: tokens.reduce((score, token) => score + (entry.name === token ? 100 : (entry.name + " " + entry.description).toLowerCase().includes(token) ? 1 : 0), 0),
      })).sort((a, b) => b.score - a.score || a.entry.name.localeCompare(b.entry.name));
      const matched = ranked.filter((item) => item.score > 0);
      const selected = (matched.length ? matched : ranked).slice(0, 20);
      const lines = selected.map(({entry}) => {
        const parameters = Object.keys(entry.schema.shape ?? {}).filter((key) => !/^(apiKey|oc|law_oc)$/i.test(key));
        return "- " + entry.name + ": " + entry.description + (parameters.length ? "\n  입력 필드: " + parameters.join(", ") : "");
      });
      return "현재 실행 가능한 읽기 전용 법령 도구:\n\n" + lines.join("\n") + "\n\n목록의 도구만 execute_tool(tool_name, params)로 실행할 수 있습니다. 필수 입력과 형식은 실행 시 검증합니다.";
    },
    async execute(client: Client, name: string, params: unknown): Promise<Output> {
      if (RESERVED.has(name)) throw new Error("메타 도구는 execute_tool로 재귀 실행할 수 없습니다.");
      const entry = index.get(name);
      if (!entry) throw new Error("등록되지 않은 법령 도구입니다. discover_tools에서 현재 실행 가능한 목록을 확인하세요.");
      const parsed = entry.schema.parse(params);
      return entry.handler(client, parsed as never);
    },
  });
}
