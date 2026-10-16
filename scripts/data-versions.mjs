import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

// 빌드 때 정적 자료와 서버 자료 코드의 내용 지문을 만든다(vite.config.ts의 define).
// 자료 파일 이름은 그대로 두고 주소 뒤에 ?v=지문을 붙여, 브라우저·서비스 워커가
// 오래 보관해도 자료가 바뀌면 곧바로 새 파일을 받는다.

function listFiles(directory, accept) {
  if (!existsSync(directory)) return [];
  const files = [];
  for (const name of readdirSync(directory).sort()) {
    const full = path.join(directory, name);
    if (statSync(full).isDirectory()) files.push(...listFiles(full, accept));
    else if (accept(full)) files.push(full);
  }
  return files;
}

function hashFiles(root, files) {
  const hash = createHash("sha256");
  for (const file of files) {
    hash.update(path.relative(root, file).replaceAll("\\", "/"));
    hash.update("\0");
    hash.update(readFileSync(file));
    hash.update("\0");
  }
  return hash.digest("hex").slice(0, 12);
}

export function computeBuildVersions(root) {
  const at = (...parts) => path.join(root, ...parts);
  const file = (...parts) => (existsSync(at(...parts)) ? [at(...parts)] : []);
  const isJson = (name) => name.endsWith(".json");
  const serverSource = (name) => /\.(ts|mts|mjs|json)$/.test(name) && !/\.test\.mjs$/.test(name);
  const bundledData = (name) => isJson(name) && !/[\\/]manual-corpus[\\/]assets[\\/]/.test(name);
  const data = {
    welfare100Lite: hashFiles(root, file("public", "data", "welfare100", "index-lite.json")),
    welfare100Extra: hashFiles(root, file("public", "data", "welfare100", "index-extra.json")),
    welfare100Items: hashFiles(root, listFiles(at("public", "data", "welfare100", "items"), isJson)),
    geoBoundaries: hashFiles(root, file("public", "data", "geo", "sido-boundaries.json")),
    dashboardSummary: hashFiles(root, file("public", "data", "summary.json")),
  };
  const mcpSources = hashFiles(root, [
    ...listFiles(at("lib"), serverSource),
    ...listFiles(at("worker"), serverSource),
    ...listFiles(at("drizzle"), (name) => name.endsWith(".sql")),
    ...listFiles(at("data"), bundledData),
  ]);
  return {
    datasetCache: hashFiles(root, [
      ...listFiles(at("lib"), serverSource),
      ...file("data", "official-spacing-corrections.json"),
      ...file("data", "source-classification-restorations.json"),
    ]),
    mcpCache: createHash("sha256").update(mcpSources + JSON.stringify(data)).digest("hex").slice(0, 12),
    data,
  };
}
