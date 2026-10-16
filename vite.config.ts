import { fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";
import vinext from "vinext";
import { defineConfig, type Plugin } from "vite";
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
const KORDOC_VERSION = JSON.parse(readFileSync(new URL("./node_modules/kordoc/package.json", import.meta.url), "utf8")).version;
const KORDOC_NATIVE_FEATURES = new Set(["onnxruntime-node", "@huggingface/transformers", "@hyzyla/pdfium", "sharp", "puppeteer-core"]);

// korean-law-mcp를 Worker 런타임에 맞춘다.
// 1) NOTICE가 별도 허락을 권고한 JS 안티봇 우회 구현은 번들에서 제외한다.
// 2) 모듈 전역 setInterval 캐시는 요청 시 지연 정리 방식으로 교체한다.
// 3) 별표 파서의 순수 JS 추출은 유지하고, ocr:false 경로에 필요 없는 네이티브 기능은 로드하지 않는다.
export const koreanLawWorkerCompatPlugin: Plugin = {
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
  transform(original: string, id: string) {
    const normalized = id.replaceAll("\\", "/").split("?")[0];
    if (!normalized.includes("/node_modules/kordoc/dist/") || !normalized.endsWith(".js")) return null;
    if (KORDOC_VERSION !== "4.18.2") this.error("kordoc Worker 호환 변환은 검증한 4.18.2에서만 지원합니다.");
    let code = original;
    if (normalized.endsWith("/dist/index.js")) {
      const parser = 'var require2 = createRequire(import.meta.url);\nvar CFB = require2("cfb");';
      const writer = 'var require3 = createRequire2(import.meta.url);\nvar CFB2 = require3("cfb");';
      if (!code.includes(parser) || !code.includes(writer)) this.error("kordoc CFB 로더가 바뀌었습니다. Worker 번들 호환성을 확인하세요.");
      code = code
        .replace('import { createRequire } from "module";\n', "")
        .replace('import { createRequire as createRequire2 } from "module";\n', "")
        .replace(parser, 'import CFB from "cfb";')
        .replace(writer, 'var CFB2 = CFB;');
    }
    // Promise 거절을 원래 동적 import 위치에 남겨, 사용하지 않는 기능의 실패가 모듈 초기화로 번지지 않게 한다.
    code = code.replace(/import\((["'])([^"']+)\1\)/g, (expression, _quote: string, source: string) => {
      if (!KORDOC_NATIVE_FEATURES.has(source) && !/^\.\/image-ocr-[\w-]+\.js$/.test(source)) return expression;
      return 'Promise.reject(new Error("KORDOC_WORKER_UNSUPPORTED: OCR and native rendering are unavailable. Use the official attachment for image-only content."))';
    });
    return code === original ? null : { code, map: null };
  },
  generateBundle() {
    // 향후 패키지 내부 import가 바뀌어도 제외 대상이 배포 번들에 들어가면 빌드를 중단한다.
    for (const id of this.getModuleIds()) {
      if (/\/node_modules\/korean-law-mcp\/build\/lib\/(?:law-antibot|cache)\.js(?:\?|$)/.test(id.replaceAll("\\", "/"))) {
        this.error("법령 Worker 번들에 제외 대상 모듈이 포함되었습니다. 안티봇·전역 타이머 캐시 치환을 확인하세요.");
      }
    }
  },
};

const localBindingConfig = {
  main: "./worker/index.ts",
  // 운영 호스팅은 static 우선이다. 원문 대신 암호문만 public에 배치한다.
  assets: { binding: "ASSETS" },
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
      __MCP_CACHE_VERSION__: JSON.stringify(versions.mcpCache),
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
