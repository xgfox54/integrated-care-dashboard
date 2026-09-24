import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const SITE_URL =
  process.env.DASHBOARD_SNAPSHOT_SITE_URL ??
  "https://integrated-care-national-dashboard.xgfox54.chatgpt.site";

const response = await fetch(new URL("/api/dataset", SITE_URL));
if (!response.ok) {
  throw new Error(`운영 사업 데이터를 내려받지 못했습니다: HTTP ${response.status}`);
}

const payload = await response.text();
const sourcePath = join(mkdtempSync(join(tmpdir(), "care-snapshot-")), "dataset.json");
writeFileSync(sourcePath, payload);

const build = spawnSync(
  process.execPath,
  [
    "--experimental-strip-types",
    fileURLToPath(new URL("./build-dashboard-snapshot.mjs", import.meta.url)),
  ],
  { stdio: "inherit", env: { ...process.env, DASHBOARD_SNAPSHOT_SOURCE: sourcePath } },
);

if (build.error) throw build.error;
process.exit(build.status ?? 1);
