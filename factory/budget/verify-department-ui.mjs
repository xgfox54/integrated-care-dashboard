import { readFileSync, writeFileSync, mkdtempSync, rmSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import assert from "node:assert/strict";
import { createServer } from "vite";
import react from "@vitejs/plugin-react";

const root = path.resolve(process.argv[2] ?? ".omo/evidence/budget-departments-20261006");
const read = (file) => JSON.parse(readFileSync(path.join(root, file), "utf8").replace(/^\uFEFF/, ""));
const data = read("api-social_welfare.json"), filters = read("jeju-filters.json");
const requests = [];
const { loadOmowright } = await import(pathToFileURL("C:/Users/USER/.codex/plugins/cache/sisyphuslabs/omo/5.1.8/skills/browser/scripts/omowright.mjs"));
const { omowright } = await loadOmowright();
const profile = mkdtempSync(path.join(root, "browser-profile-"));
const server = await createServer({ configFile: false, root: process.cwd(), cacheDir: path.join(root, "vite-cache"), resolve: { alias: { "@": process.cwd() } }, server: { host: "127.0.0.1", port: 0, watch: null }, plugins: [react(), {
  name: "budget-department-evidence-harness",
  configureServer(vite) { vite.middlewares.use(async (req, res, next) => {
    const url = new URL(req.url, "http://localhost");
    if (url.pathname === "/") {
      res.setHeader("content-type", "text/html");
      res.end(await vite.transformIndexHtml("/", '<!doctype html><html lang="ko"><head><meta charset="UTF-8"></head><body><div id="root">Loading QA</div><script>window.__qaErrors=[];window.addEventListener("error",e=>window.__qaErrors.push(String(e.message)));window.addEventListener("unhandledrejection",e=>window.__qaErrors.push(String(e.reason)))</script><script type="module" src="/__department_entry.jsx"></script></body></html>')); return;
    }
    if (!url.pathname.startsWith("/api/")) return next();
    res.setHeader("content-type", "application/json");
    if (url.pathname !== "/api/budget") { res.end(JSON.stringify({ revisions: [], documents: [], items: [] })); return; }
    requests.push(Object.fromEntries(url.searchParams));
    if (url.searchParams.get("view") === "filters") { res.end(JSON.stringify(filters)); return; }
    const department = url.searchParams.get("department");
    const items = data.items.filter((item) => !department || item.department_code === department);
    const sum = (key) => items.reduce((value, item) => value + BigInt(item[key] ?? "0"), 0n).toString();
    res.end(JSON.stringify({ mode: "social_welfare", modes: [{ id: "social_welfare", label: "사회복지", available: true }], notes: [], snapshot: { ...data.pages[0].snapshot, requested_reference_date: "2026-10-05" }, unavailable: null, fallback_used: false, items: items.slice(0, 20), total: items.length, size: 20, regions_summary: [], summary: { matching_rows: items.length, included_rows: items.length, excluded_rows: 0, fiscal_entities: 1, current_budget_krw: sum("current_budget_krw"), public_expenditure_krw: sum("public_expenditure_krw"), unspent_difference_krw: sum("unspent_difference_krw"), execution_rate_pct: null } }));
  }); },
  resolveId(id) { if (id === "/__department_entry.jsx") return "\0department-entry"; },
  load(id) { if (id === "\0department-entry") return 'import React from "react"; import {createRoot} from "react-dom/client"; import {BudgetBrowser} from "/components/budget/budget-browser.tsx"; createRoot(document.getElementById("root")).render(React.createElement(BudgetBrowser));'; },
}] });
let browser;
try {
  await server.listen();
  browser = await omowright.connectPipe({ browserPath: "C:/Users/USER/AppData/Local/ms-playwright/chromium_headless_shell-1243/chrome-headless-shell-win64/chrome-headless-shell.exe", browserArgs: ["--headless", "--no-first-run", "--disable-gpu", `--user-data-dir=${profile}`], storageRoot: profile });
  const page = await browser.newTab(server.resolvedUrls.local[0] + "?region=4900000&department=4005100");
  async function waitForText(value, selector = "body") {
    const deadline = Date.now() + 30000;
    while (Date.now() < deadline) { const text = await page.evaluate(`document.querySelector(${JSON.stringify(selector)})?.innerText ?? ""`); if (text.includes(value)) return text; await new Promise((resolve) => setTimeout(resolve, 150)); }
    writeFileSync(path.join(root, "ui-failure-tree.txt"), omowright.compactSnapshot(await page.snapshot()));
    writeFileSync(path.join(root, "ui-failure-errors.json"), JSON.stringify(await page.evaluate("({errors:window.__qaErrors,body:document.body.innerText,modules:performance.getEntriesByType('resource').map(x=>x.name)})"), null, 2));
    throw Error("UI_TEXT_MISSING:" + value);
  }
  await waitForText("조회 조건");
  await waitForText("서귀포시노인복지과 (4005100)", "#budget-department");
  writeFileSync(path.join(root, "ui-initial-tree.txt"), omowright.compactSnapshot(await page.snapshot()));
  await page.locator("#budget-department").selectOption("4005100");
  writeFileSync(path.join(root, "ui-before-mapped-submit-tree.txt"), omowright.compactSnapshot(await page.snapshot()));
  await page.locator('button[type="submit"]').click();
  await waitForText("서귀포시노인복지과 (4005100)", "tbody");
  const firstTree = omowright.compactSnapshot(await page.snapshot());
  writeFileSync(path.join(root, "ui-mapped-tree.txt"), firstTree);
  assert.ok(await page.evaluate('document.querySelector("tbody")?.innerText.includes("서귀포시노인복지과 (4005100)")'));
  assert.ok(await page.evaluate('document.querySelector("#budget-department option:checked")?.textContent.includes("서귀포시노인복지과")'));
  writeFileSync(path.join(root, "ui-mapped.png"), await page.screenshot({ fullPage: true }));
  await page.locator("#budget-department").selectOption("1027001");
  writeFileSync(path.join(root, "ui-before-submit-tree.txt"), omowright.compactSnapshot(await page.snapshot()));
  await page.locator('button[type="submit"]').click();
  await waitForText("노동감독 운영");
  assert.ok(await page.evaluate('document.querySelector("tbody")?.innerText.includes("부서코드 1027001 (명칭 미확인)")'));
  assert.ok(requests.some((r) => r.department === "1027001"));
  writeFileSync(path.join(root, "ui-unknown-tree.txt"), omowright.compactSnapshot(await page.snapshot()));
  writeFileSync(path.join(root, "ui-unknown.png"), await page.screenshot({ fullPage: true }));
  writeFileSync(path.join(root, "ui-result.json"), JSON.stringify({ pass: true, scenario: "Actual BudgetBrowser, isolated Vite + Chromium, replay of captured public Jeju API rows; no deployed/UI backend claim", verified_code: "4005100", unresolved_code: "1027001", checks: { mapped_table: true, mapped_option: true, unknown_table: true, original_code_filter_request: true }, requests }, null, 2));
  console.log("PASS: mapped and unknown department labels; original filter code preserved");
} finally {
  if (browser) await browser.close();
  await server.close();
  if (!profile.startsWith(root + path.sep)) throw Error("UNSAFE_PROFILE_PATH");
  rmSync(profile, { recursive: true, force: true });
}
