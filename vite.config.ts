import { fileURLToPath } from "node:url";
import vinext from "vinext";
import { defineConfig } from "vite";
import hostingConfig from "./.openai/hosting.json" with { type: "json" };
import { computeBuildVersions } from "./scripts/data-versions.mjs";
import { readExecutionProfile } from "./scripts/execution-profile.mjs";
import { sites } from "./build/sites-vite-plugin.ts";

const SITE_CREATOR_PLACEHOLDER_DATABASE_ID =
  "00000000-0000-4000-8000-000000000000";

const { d1, r2 } = hostingConfig;

// macOS Seatbelt blocks FSEvents, so Codex previews need polling for HMR.
const isCodexSeatbeltSandbox = process.env.CODEX_SANDBOX === "seatbelt";
const managedLinux = readExecutionProfile() === "managed-linux";

const NO_LAW_ANTIBOT_MODULE = fileURLToPath(new URL("./lib/law/no-antibot.ts", import.meta.url));
const LAW_WORKER_CACHE_MODULE = fileURLToPath(new URL("./lib/law/worker-cache.ts", import.meta.url));

// korean-law-mcp를 Worker 런타임에 맞춘다.
// 1) NOTICE가 별도 허락을 권고한 JS 안티봇 우회 구현은 번들에서 제외한다.
// 2) 모듈 전역 setInterval 캐시는 요청 시 지연 정리 방식으로 교체한다.
const koreanLawWorkerCompatPlugin = {
  name: "korean-law-worker-compat",
  enforce: "pre" as const,
  resolveId(source: string, importer?: string) {
    const normalized = importer?.replaceAll("\\", "/");
    if (!normalized?.includes("/node_modules/korean-law-mcp/build/")) return null;
    if (source === "./law-antibot.js" && normalized.endsWith("/lib/fetch-with-retry.js")) {
      return NO_LAW_ANTIBOT_MODULE;
    }
    if ((source === "./cache.js" || source === "../lib/cache.js")) {
      return LAW_WORKER_CACHE_MODULE;
    }
    return null;
  },
};

const localBindingConfig = {
  main: "./worker/index.ts",
  // 도구 버전을 올려도 Worker 동작이 바뀌지 않도록 호환 날짜를 고정한다.
  compatibility_date: "2026-05-15",
  compatibility_flags: ["nodejs_compat"],
  d1_databases: d1
    ? [
        {
          binding: d1,
          database_name: "site-creator-d1",
          database_id: SITE_CREATOR_PLACEHOLDER_DATABASE_ID,
        },
      ]
    : [],
  r2_buckets: r2
    ? [
        {
          binding: r2,
          bucket_name: "site-creator-r2",
        },
      ]
    : [],
  triggers: { crons: ["0 * * * *"] },
  // 요청 단위 자동 로그(invocation logs)는 요청 주소의 검색어·접속 IP·쿠키·로그인 사용자 헤더를 그대로 남기므로 끈다(작업지시서 v5 T22).
  // 앱이 직접 남기는 오류 로그(경로·코드·요청 ID)는 Workers Logs에 그대로 남는다.
  observability: { enabled: true, logs: { enabled: true, invocation_logs: false } },
};

export default defineConfig(async () => {
  // Use Miniflare's local Request.cf placeholder unless fetching is requested.
  process.env.CLOUDFLARE_CF_FETCH_ENABLED ??= "false";
  process.env.WRANGLER_SEND_METRICS ??= "false";

  // Keep Wrangler and Miniflare state project-local. These are non-secret tool
  // settings; application environment belongs in ignored `.env*` files.
  process.env.WRANGLER_WRITE_LOGS ??= "false";
  process.env.WRANGLER_LOG_PATH ??= ".wrangler/logs";
  process.env.WRANGLER_REGISTRY_PATH ??= ".wrangler/dev-registry";
  process.env.MINIFLARE_REGISTRY_PATH ??= ".wrangler/registry";

  // Wrangler snapshots its log path while the Cloudflare plugin is imported.
  const { cloudflare } = await import("@cloudflare/vite-plugin");
  const versions = computeBuildVersions(process.cwd());

  return {
    define: {
      __DATASET_CACHE_VERSION__: JSON.stringify(versions.datasetCache),
      __DATA_VERSIONS__: JSON.stringify(versions.data),
    },
    server: {
      ...(managedLinux ? { host: "0.0.0.0", allowedHosts: ["terminal.local"] } : {}),
      ...(isCodexSeatbeltSandbox ? { watch: { useFsEvents: false, usePolling: true } } : {}),
    },
    plugins: [
      koreanLawWorkerCompatPlugin,
      vinext(),
      sites({ mockAuth: !managedLinux }),
      cloudflare({
        viteEnvironment: { name: "rsc", childEnvironments: ["ssr"] },
        inspectorPort: false,
        config: localBindingConfig,
      }),
    ],
  };
});
