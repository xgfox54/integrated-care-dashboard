import { readFile, writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

export function projectDepartmentLabels(mappings) {
  const entries = new Map();
  for (const entry of mappings) {
    if (entry.status !== "verified_exact") continue;
    const key = entry.fiscal_entity_name + "|" + entry.department_code;
    const state = entries.get(key) ?? { names: new Set(), subunits: [], display: null };
    state.names.add(entry.department_name);
    if (entry.sub_departments?.length) state.subunits = entry.sub_departments;
    if (entry.display_name) state.display = entry.display_name;
    entries.set(key, state);
  }
  return Object.fromEntries([...entries].flatMap(([key, entry]) => {
    if (entry.names.size !== 1) return [];
    const name = entry.display ?? [...entry.names][0];
    return [[key, name + (entry.subunits.length ? "(" + entry.subunits.join("·") + ")" : "")]];
  }));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const source = await readFile(new URL("../components/budget/budget-department-names.json", import.meta.url), "utf8");
  const output = new URL("../components/budget/budget-department-labels.json", import.meta.url);
  const generated = JSON.stringify(projectDepartmentLabels(JSON.parse(source).mappings)) + "\n";
  if (process.argv.includes("--verify")) {
    if (await readFile(output, "utf8") !== generated) throw new Error("Department labels are stale; run node scripts/build-budget-department-labels.mjs");
  } else {
    await writeFile(output, generated);
  }
  console.log(JSON.stringify({ verified: process.argv.includes("--verify"), sourceBytes: Buffer.byteLength(source), projectedBytes: Buffer.byteLength(generated) }));
}
