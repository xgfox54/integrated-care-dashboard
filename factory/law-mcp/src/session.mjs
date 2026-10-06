// korean-law-mcp를 자식 프로세스(stdio)로 띄우고 공식 MCP SDK 클라이언트로 연결한다.
// 공개 공용 MCP 서버를 쓰지 않는다. 인증값(LAW_OC)은 환경변수로만 넘기고 기록하지 않는다.
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const here = path.dirname(fileURLToPath(import.meta.url));
export const PACKAGE_ROOT = path.join(here, "..", "node_modules", "korean-law-mcp");
export const PINNED_VERSION = "4.15.5";

export function installedVersion() {
  return JSON.parse(readFileSync(path.join(PACKAGE_ROOT, "package.json"), "utf8")).version;
}

/** 서버 실행 환경. 부모 환경 전체를 넘기지 않고 필요한 값만 넘긴다. */
export function serverEnv(lawOc) {
  const env = { PATH: process.env.PATH ?? "", SYSTEMROOT: process.env.SYSTEMROOT ?? "", NODE_ENV: "production", NO_COLOR: "1" };
  if (lawOc) env.LAW_OC = lawOc;
  return env;
}

export async function openLawSession({ lawOc = process.env.LAW_OC ?? "", onStderr = () => {} } = {}) {
  if (installedVersion() !== PINNED_VERSION) throw new Error("korean-law-mcp 설치 버전이 고정값(" + PINNED_VERSION + ")과 다릅니다: " + installedVersion());
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: ["--import", pathToFileURL(path.join(here, "no-antibot.mjs")).href, path.join(PACKAGE_ROOT, "build", "index.js")],
    env: serverEnv(lawOc),
    stderr: "pipe",
  });
  const blocked = { count: 0 };
  transport.stderr?.on("data", (chunk) => {
    const text = String(chunk);
    if (text.includes("LAW_ANTIBOT_CHALLENGE_BLOCKED")) blocked.count += text.split("LAW_ANTIBOT_CHALLENGE_BLOCKED").length - 1;
    onStderr(text);
  });
  const client = new Client({ name: "welfare-dashboard-law-collector", version: "1.0.0" });
  await client.connect(transport);
  return { client, blocked, close: () => client.close() };
}
