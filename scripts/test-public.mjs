import { existsSync, readdirSync } from "node:fs";
import { spawnSync } from "node:child_process";

const corpusTests = new Set([
  "manuals-amount-ranking.test.mjs", "manuals-corpus-fidelity.test.mjs", "manuals-assets.test.mjs",
  "mcp-faq129.test.mjs", "mcp-manuals.test.mjs", "welfare100-manual-link-scope.test.mjs",
]);
const hasCorpus = process.env.WELFARE_TEST_PRIVATE_CORPUS === "1" && existsSync("data/manual-corpus/assets");
const tests = readdirSync("lib").filter((file) => file.endsWith(".test.mjs")).filter((file) => {
  if (hasCorpus || !corpusTests.has(file)) return true;
  console.log(`SKIP private original-corpus integration: lib/${file}`);
  return false;
}).map((file) => `lib/${file}`);
const result = spawnSync(process.execPath, ["--test", "--test-concurrency=4", "--test-timeout=30000", ...tests], { stdio: "inherit" });
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
