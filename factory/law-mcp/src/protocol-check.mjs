// initialize·tools/list 실제 응답을 기록한다(인증값 없이도 실행된다). 도구 호출은 하지 않는다.
// 결과: factory/law-mcp/docs/protocol-<버전>.json — 서버 정보, 프로토콜 버전, 도구별 입력 스키마와 해시.
import { createHash } from "node:crypto";
import { writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { installedVersion, openLawSession } from "./session.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const session = await openLawSession({ lawOc: "" });
try {
  const { client } = session;
  const { tools } = await client.listTools();
  const record = {
    checked_at: new Date().toISOString(),
    package: "korean-law-mcp@" + installedVersion(),
    server: client.getServerVersion(),
    protocol_version: client.getNegotiatedProtocolVersion?.() ?? null,
    capabilities: client.getServerCapabilities(),
    tools: tools.map((tool) => ({
      name: tool.name,
      required: tool.inputSchema?.required ?? [],
      properties: Object.keys(tool.inputSchema?.properties ?? {}),
      annotations: tool.annotations ?? null,
      schema_sha256: createHash("sha256").update(JSON.stringify(tool.inputSchema ?? {})).digest("hex"),
      description: (tool.description ?? "").slice(0, 300),
    })),
  };
  const target = path.join(here, "..", "docs", "protocol-" + installedVersion() + ".json");
  writeFileSync(target, JSON.stringify(record, null, 1) + "\n");
  console.log(JSON.stringify({ tools: record.tools.length, server: record.server, protocol: record.protocol_version, names: record.tools.map((tool) => tool.name) }));
} finally {
  await session.close();
}
